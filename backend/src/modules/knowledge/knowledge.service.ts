import { Injectable, Logger } from '@nestjs/common';
import { v5 as uuidv5 } from 'uuid';
import { QdrantService } from '../../core/vector/qdrant.service';
import { EmbeddingsService } from '../../core/vector/embeddings.service';
import { SupabaseService } from '../../core/database/supabase.service';

// Stable namespace so a given (articleId, chunkIndex) always maps to the same
// Qdrant point id — Qdrant only accepts UUIDs or unsigned ints, not strings
// like `${articleId}-${i}`, and re-indexing should overwrite, not duplicate.
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
    await this.qdrant.ensureCollection(this.COLLECTION, this.embeddings.dimension);
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
    const queryEmbedding = await this.embeddings.generateEmbedding(query);
    const results = await this.qdrant.search(this.COLLECTION, queryEmbedding, limit);
    return results.map((r) => ({
      text: r.payload.text,
      articleId: r.payload.article_id,
      score: r.payload.score,
    }));
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