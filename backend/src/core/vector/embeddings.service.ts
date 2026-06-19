import { Injectable, Logger } from '@nestjs/common';

type Provider = 'gemini' | 'cohere';

/**
 * Generates text embeddings for the knowledge base.
 *
 * Prefers Google Gemini when GEMINI_API_KEY is set, and falls back to Cohere
 * otherwise. Both are constrained to the same output dimension so vectors stay
 * compatible with an existing collection. {@link dimension} exposes the active
 * size for callers that must create the vector collection to match.
 */
@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);
  private readonly provider: Provider;
  private readonly dim: number;

  private readonly geminiKey?: string;
  private readonly geminiModel: string;

  private readonly cohereKey?: string;
  private readonly cohereModel: string;

  constructor() {
    this.dim = Number(process.env.EMBED_DIM) || Number(process.env.COHERE_EMBED_DIM) || 1024;

    this.geminiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)?.trim();
    this.geminiModel = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';

    this.cohereKey = process.env.COHERE_API_KEY?.trim();
    this.cohereModel = process.env.COHERE_EMBED_MODEL || 'embed-v4.0';

    if (this.geminiKey) {
      this.provider = 'gemini';
      this.logger.log(`Embeddings provider: Gemini (${this.geminiModel}, ${this.dim}d)`);
    } else if (this.cohereKey) {
      this.provider = 'cohere';
      this.logger.log(`Embeddings provider: Cohere (${this.cohereModel}, ${this.dim}d)`);
    } else {
      this.provider = 'gemini';
      this.logger.warn('No GEMINI_API_KEY or COHERE_API_KEY set — embeddings will fail at runtime');
    }
  }

  /** Vector size produced by the active provider. */
  get dimension(): number {
    return this.dim;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const [vector] = await this.embed([text], 'query');
    return vector;
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    return this.embed(texts, 'document');
  }

  private async embed(texts: string[], kind: 'query' | 'document'): Promise<number[][]> {
    if (this.provider === 'gemini') {
      return this.embedGemini(texts, kind);
    }
    return this.embedCohere(texts, kind);
  }

  private async embedGemini(
    texts: string[],
    kind: 'query' | 'document',
  ): Promise<number[][]> {
    // Gemini's native embedContent is single-text; batch them ourselves.
    const taskType = kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT';
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${this.geminiModel}:embedContent?key=${this.geminiKey}`;

    return Promise.all(
      texts.map(async (text) => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: { parts: [{ text }] },
            taskType,
            outputDimensionality: this.dim,
          }),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          throw new Error(`Gemini embed failed (${res.status}): ${detail.slice(0, 200)}`);
        }
        const data = (await res.json()) as { embedding?: { values?: number[] } };
        const values = data.embedding?.values;
        if (!values?.length) {
          throw new Error('Gemini embed returned no vector');
        }
        return values;
      }),
    );
  }

  private async embedCohere(
    texts: string[],
    kind: 'query' | 'document',
  ): Promise<number[][]> {
    const res = await fetch('https://api.cohere.com/v2/embed', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cohereKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.cohereModel,
        texts,
        input_type: kind === 'query' ? 'search_query' : 'search_document',
        embedding_types: ['float'],
        output_dimension: this.dim,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Cohere embed failed (${res.status}): ${detail.slice(0, 200)}`);
    }

    const data = (await res.json()) as { embeddings?: { float?: number[][] } };
    const vectors = data.embeddings?.float;
    if (!vectors?.length) {
      throw new Error('Cohere embed returned no vectors');
    }
    return vectors;
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
