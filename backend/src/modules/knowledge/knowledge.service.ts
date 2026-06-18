import { Injectable, Logger } from '@nestjs/common';
import { v5 as uuidv5 } from 'uuid';
import { QdrantService } from '../../core/vector/qdrant.service';
import { EmbeddingsService } from '../../core/vector/embeddings.service';
import { SupabaseService } from '../../core/database/supabase.service';
import { AIFactory } from '../../core/ai/ai.factory';

// Fixed namespace so chunk point IDs are deterministic: re-indexing an article
// overwrites its existing points instead of creating duplicates.
const POINT_ID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

// Categorize an article from its title/content for intent-routed retrieval.
// Categories: subscription (monthly SaaS plans), project (one-time INR builds),
// contact, general (everything else).
function categorize(title = '', content = ''): string {
  const tl = title.toLowerCase();
  const body = `${title} ${content}`.toLowerCase();
  // Most-specific first; bias on the title so a passing mention of
  // "free consultation" in a pricing doc doesn't mark it as contact.
  if (/\binr\b|lakh|one-time|project pricing/.test(body) || /project pricing/.test(tl))
    return 'project';
  if (/per month|\/mo|subscription|professional rag|enterprise plan/.test(body))
    return 'subscription';
  if (/contact|^.*contact/.test(tl) || /calendly|sales@|support@/.test(body)) return 'contact';
  return 'general';
}

// Map a user query to an intent, then to the categories worth searching.
// Returns null categories => search everything (no filter).
function routeIntent(query: string): { intent: string; categories: string[] | null } {
  const q = query.toLowerCase();
  const subscription = /subscription|per month|monthly|plan|starter|professional|enterprise|tier/.test(q);
  const project = /\binr\b|rupee|lakh|one-time|project cost|build cost|website cost|app cost|how much.*(website|app|automation)/.test(q);
  if (project && !subscription) return { intent: 'project', categories: ['project', 'general'] };
  if (subscription && !project) return { intent: 'saas', categories: ['subscription', 'general'] };
  return { intent: 'general', categories: null };
}

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);
  private readonly COLLECTION = 'knowledge_chunks';

  constructor(
    private qdrant: QdrantService,
    private embeddings: EmbeddingsService,
    private supabase: SupabaseService,
    private aiFactory: AIFactory,
  ) {}

  async onModuleInit() {
    // Collection dimension must match the embedding model (Cohere embed-v4.0).
    await this.qdrant.ensureCollection(this.COLLECTION, this.embeddings.dimension);
  }

  async upload(content: string, title: string, sourceType?: string) {
    const { data: article, error } = await this.supabase.client
      .from('knowledge_articles')
      .insert({ title, content, source_type: sourceType || 'text' })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await this.indexArticle(article.id, content, {
      title: article.title,
      source: article.source_type,
    });
    return article;
  }

  async indexArticle(
    articleId: string,
    content: string,
    meta?: { title?: string; source?: string },
  ) {
    const chunks = this.embeddings.chunkText(content);
    const embeddings = await this.embeddings.generateEmbeddings(chunks);
    const timestamp = Date.now();
    const category = categorize(meta?.title, content);

    const points = chunks.map((chunk, i) => ({
      // Qdrant requires point IDs to be an unsigned integer or a UUID; the old
      // `${articleId}-${i}` form is rejected. Derive a stable UUID per chunk.
      id: uuidv5(`${articleId}-${i}`, POINT_ID_NAMESPACE),
      vector: embeddings[i],
      payload: {
        text: chunk,
        // Metadata schema for filtering/ordering (doc_id + chunk numbering).
        // article_id/chunk_index kept for backward compatibility.
        article_id: articleId,
        chunk_index: i,
        doc_id: articleId,
        title: meta?.title ?? null,
        source: meta?.source ?? 'text',
        chunk_id: i + 1,
        order: i + 1,
        total_chunks: chunks.length,
        category,
        timestamp,
      },
    }));

    await this.qdrant.upsert(this.COLLECTION, points);

    for (let i = 0; i < chunks.length; i++) {
      await this.supabase.client.from('knowledge_chunks').insert({
        article_id: articleId,
        chunk_text: chunks[i],
        chunk_index: i,
      });
    }
  }

  async search(query: string, limit: number = 5) {
    const { used_chunks } = await this.searchDetailed(query, limit);
    return used_chunks.map((c) => ({
      text: c.text,
      articleId: c.doc_id,
      title: c.title,
      score: c.relevance,
    }));
  }

  /**
   * Intent-routed retrieval with category filtering + Cohere rerank, returning
   * structured citations. Strategy:
   *   1. Classify the query intent (saas | project | general) and map it to the
   *      Qdrant categories worth searching.
   *   2. Vector-search Qdrant filtered to those categories (over-fetch a pool);
   *      fall back to an unfiltered search if the filter returns nothing.
   *   3. Rerank the candidate texts against the query with Cohere.
   *   4. Return the top-N as used_chunks with doc_id/chunk_id/title/category/relevance.
   * Degrades gracefully (returns [] / vector order) if a provider is down.
   */
  async searchDetailed(query: string, limit: number = 5) {
    const { intent, categories } = routeIntent(query);
    const empty = {
      query,
      intent,
      retrieval_strategy: 'vector',
      used_chunks: [] as any[],
    };
    try {
      const pool = Math.max(limit * 4, 12);
      const queryEmbedding = await this.embeddings.generateEmbedding(query);

      const filter = categories
        ? { must: [{ key: 'category', match: { any: categories } }] }
        : undefined;
      let candidates = await this.qdrant.search(this.COLLECTION, queryEmbedding, pool, filter);
      let filtered = !!filter;
      // Fall back to unfiltered if the category filter excluded everything.
      if (candidates.length === 0 && filter) {
        candidates = await this.qdrant.search(this.COLLECTION, queryEmbedding, pool);
        filtered = false;
      }
      if (candidates.length === 0) return empty;

      const ranking = await this.embeddings.rerank(
        query,
        candidates.map((c) => String(c.payload.text ?? '')),
        limit,
      );
      const reranked = ranking.length > 0;

      const used_chunks = ranking.slice(0, limit).map((r) => {
        const c = candidates[r.index];
        return {
          doc_id: c.payload.doc_id ?? c.payload.article_id,
          chunk_id: c.payload.chunk_id ?? (c.payload.chunk_index ?? 0) + 1,
          title: c.payload.title ?? null,
          category: c.payload.category ?? 'general',
          text: String(c.payload.text ?? ''),
          relevance: reranked ? Number(r.relevance.toFixed(4)) : Number((c.score ?? 0).toFixed(4)),
        };
      });

      const strategy =
        (filtered ? 'intent-routed + filtered' : 'vector') + (reranked ? ' + rerank' : '');
      return { query, intent, retrieval_strategy: strategy, used_chunks };
    } catch (err) {
      this.logger.warn(`Knowledge search unavailable: ${err}`);
      return empty;
    }
  }

  /**
   * Full RAG answer: intent-routed retrieval + Cohere rerank, then a grounded
   * Groq completion. Returns the structured shape with final_answer + citations.
   */
  async ask(query: string, limit: number = 4) {
    const retrieval = await this.searchDetailed(query, limit);
    const context = retrieval.used_chunks
      .map((c, i) => `[${i + 1}] ${c.title ? `(${c.title}) ` : ''}${c.text}`)
      .join('\n');

    let final_answer = '';
    try {
      const messages = [
        {
          role: 'system' as const,
          content:
            'You are MAXR Support AI. Answer the user using ONLY the knowledge below. ' +
            'If the knowledge does not contain the answer, say you are not sure and offer to ' +
            'connect them with the team. Be concise and professional.' +
            (context ? `\n\nKnowledge:\n${context}` : ''),
        },
        { role: 'user' as const, content: query },
      ];
      const res = await this.aiFactory.getProvider().generateCompletion(messages, {
        temperature: 0.2,
      });
      final_answer = res.content;
    } catch (err) {
      this.logger.warn(`ask() completion failed: ${err}`);
      final_answer = "I'm having trouble answering right now. Please try again shortly.";
    }

    return {
      query: retrieval.query,
      intent: retrieval.intent,
      retrieval_strategy: retrieval.retrieval_strategy,
      final_answer,
      used_chunks: retrieval.used_chunks.map(({ text, ...c }) => c),
    };
  }

  async reindex() {
    const { data: articles } = await this.supabase.client
      .from('knowledge_articles')
      .select('*');
    if (articles) {
      for (const article of articles) {
        await this.indexArticle(article.id, article.content, {
          title: article.title,
          source: article.source_type,
        });
      }
    }
    return { reindexed: articles?.length || 0 };
  }

  async findAll() {
    const { data } = await this.supabase.client
      .from('knowledge_articles')
      .select('*')
      .order('created_at', { ascending: false });
    return data || [];
  }

  async remove(id: string) {
    await this.supabase.client.from('knowledge_chunks').delete().eq('article_id', id);
    await this.supabase.client.from('knowledge_articles').delete().eq('id', id);
    return { deleted: true };
  }
}