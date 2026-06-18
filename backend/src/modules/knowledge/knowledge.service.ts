import { Injectable, Logger } from '@nestjs/common';
import { v5 as uuidv5 } from 'uuid';
import { QdrantService } from '../../core/vector/qdrant.service';
import { EmbeddingsService } from '../../core/vector/embeddings.service';
import { SupabaseService } from '../../core/database/supabase.service';

// Fixed namespace so chunk point IDs are deterministic: re-indexing an article
// overwrites its existing points instead of creating duplicates.
const POINT_ID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);
  private readonly COLLECTION = 'knowledge_chunks';

  constructor(
    private qdrant: QdrantService,
    private embeddings: EmbeddingsService,
    private supabase: SupabaseService,
  ) {}

  async onModuleInit() {
    await this.qdrant.ensureCollection(this.COLLECTION);
  }

  async upload(content: string, title: string, sourceType?: string) {
    const { data: article, error } = await this.supabase.client
      .from('knowledge_articles')
      .insert({ title, content, source_type: sourceType || 'text' })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await this.indexArticle(article.id, content);
    return article;
  }

  async indexArticle(articleId: string, content: string) {
    const chunks = this.embeddings.chunkText(content);
    const embeddings = await this.embeddings.generateEmbeddings(chunks);

    const points = chunks.map((chunk, i) => ({
      // Qdrant requires point IDs to be an unsigned integer or a UUID; the old
      // `${articleId}-${i}` form is rejected. Derive a stable UUID per chunk.
      id: uuidv5(`${articleId}-${i}`, POINT_ID_NAMESPACE),
      vector: embeddings[i],
      payload: { article_id: articleId, text: chunk, chunk_index: i },
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
    // Degrade gracefully: if embeddings or Qdrant are unavailable, RAG returns
    // no results rather than throwing, so the chatbot and the search endpoint
    // keep working (the bot simply answers without knowledge context).
    try {
      const queryEmbedding = await this.embeddings.generateEmbedding(query);
      const results = await this.qdrant.search(this.COLLECTION, queryEmbedding, limit);
      return results.map((r) => ({
        text: r.payload.text,
        articleId: r.payload.article_id,
        score: r.score,
      }));
    } catch (err) {
      this.logger.warn(`Knowledge search unavailable: ${err}`);
      return [];
    }
  }

  async reindex() {
    const { data: articles } = await this.supabase.client
      .from('knowledge_articles')
      .select('*');
    if (articles) {
      for (const article of articles) {
        await this.indexArticle(article.id, article.content);
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