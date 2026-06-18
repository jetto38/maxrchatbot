import { Injectable, Logger } from '@nestjs/common';

/**
 * Cohere-backed embeddings (no OpenAI runtime dependency).
 *
 * Chat/completions use Groq; embeddings use Cohere because Groq has no
 * embeddings API. Calls the Cohere v2 /embed endpoint directly via fetch.
 *
 * Config (env):
 *   COHERE_API_KEY     required
 *   COHERE_EMBED_MODEL default 'embed-v4.0'
 *   COHERE_EMBED_DIM   default 1024 (embed-v4.0 supports 256/512/1024/1536)
 */
@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);
  private readonly apiUrl = 'https://api.cohere.com/v2/embed';
  private readonly model = process.env.COHERE_EMBED_MODEL || 'embed-v4.0';
  // Vector dimension produced by the model; must match the Qdrant collection.
  readonly dimension = Number(process.env.COHERE_EMBED_DIM) || 1024;
  // Cohere allows at most 96 texts per embed call.
  private readonly MAX_BATCH = 96;

  constructor() {
    if (!process.env.COHERE_API_KEY) {
      this.logger.warn('COHERE_API_KEY not set — embeddings will fail at runtime');
    }
  }

  /** Embed a single search query (input_type=search_query). */
  async generateEmbedding(text: string): Promise<number[]> {
    const [vec] = await this.embed([text], 'search_query');
    return vec;
  }

  /** Embed documents for storage (input_type=search_document). */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.MAX_BATCH) {
      const batch = texts.slice(i, i + this.MAX_BATCH);
      out.push(...(await this.embed(batch, 'search_document')));
    }
    return out;
  }

  private async embed(
    texts: string[],
    inputType: 'search_query' | 'search_document',
  ): Promise<number[][]> {
    const apiKey = process.env.COHERE_API_KEY;
    if (!apiKey) throw new Error('COHERE_API_KEY not configured');

    const res = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        texts,
        input_type: inputType,
        embedding_types: ['float'],
        output_dimension: this.dimension,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Cohere embed failed (${res.status}): ${detail.slice(0, 300)}`);
    }

    const data: { embeddings?: { float?: number[][] } } = await res.json();
    const vectors = data.embeddings?.float;
    if (!vectors || vectors.length !== texts.length) {
      throw new Error('Cohere embed returned unexpected payload');
    }
    return vectors;
  }

  /**
   * Rerank documents against a query with Cohere's rerank model. Returns the
   * original indexes with relevance scores, best-first. Falls back to identity
   * order (no scores) if the API is unavailable so retrieval still works.
   */
  async rerank(
    query: string,
    documents: string[],
    topN?: number,
  ): Promise<Array<{ index: number; relevance: number }>> {
    const apiKey = process.env.COHERE_API_KEY;
    if (!apiKey || documents.length === 0) {
      return documents.map((_, index) => ({ index, relevance: 0 }));
    }
    try {
      const res = await fetch('https://api.cohere.com/v2/rerank', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.COHERE_RERANK_MODEL || 'rerank-v3.5',
          query,
          documents,
          top_n: topN ?? documents.length,
        }),
      });
      if (!res.ok) throw new Error(`Cohere rerank ${res.status}`);
      const data: { results?: Array<{ index: number; relevance_score: number }> } =
        await res.json();
      return (data.results ?? []).map((r) => ({ index: r.index, relevance: r.relevance_score }));
    } catch (err) {
      this.logger.warn(`Rerank unavailable, using vector order: ${err}`);
      return documents.map((_, index) => ({ index, relevance: 0 }));
    }
  }

  chunkText(text: string, maxChunkSize: number = 512): string[] {
    const chunks: string[] = [];
    const sentences = text.split(/(?<=[.!?])\s+/);
    let current = '';

    for (const sentence of sentences) {
      if ((current + ' ' + sentence).length > maxChunkSize && current) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current = current ? current + ' ' + sentence : sentence;
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }
}
