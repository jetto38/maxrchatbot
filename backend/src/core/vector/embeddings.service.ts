import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';

type Provider = 'cohere' | 'openai';

/**
 * Generates text embeddings for the knowledge base.
 *
 * Prefers Cohere when COHERE_API_KEY is set (this deployment ships a Cohere
 * key), and falls back to OpenAI otherwise. The two providers emit different
 * vector sizes, so {@link dimension} exposes the active size for callers that
 * must create the vector collection to match.
 */
@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);
  private readonly provider: Provider;
  private readonly openai?: OpenAI;
  private readonly cohereKey?: string;
  private readonly cohereModel: string;
  private readonly cohereDim: number;
  private readonly openaiModel: string;

  constructor() {
    this.cohereKey = process.env.COHERE_API_KEY?.trim();
    this.cohereModel = process.env.COHERE_EMBED_MODEL || 'embed-v4.0';
    this.cohereDim = Number(process.env.COHERE_EMBED_DIM) || 1024;
    this.openaiModel = process.env.OPENAI_MODEL_EMBED || 'text-embedding-3-small';

    const openaiKey = process.env.OPENAI_API_KEY?.trim();
    if (this.cohereKey) {
      this.provider = 'cohere';
      this.logger.log(`Embeddings provider: Cohere (${this.cohereModel}, ${this.cohereDim}d)`);
    } else {
      this.provider = 'openai';
      if (!openaiKey) {
        this.logger.warn('No COHERE_API_KEY or OPENAI_API_KEY set — embeddings will fail at runtime');
      }
      this.openai = new OpenAI({ apiKey: openaiKey || 'dummy' });
    }
  }

  /** Vector size produced by the active provider (1024 for Cohere, 1536 for OpenAI small). */
  get dimension(): number {
    return this.provider === 'cohere' ? this.cohereDim : 1536;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const [vector] = await this.embed([text], 'search_query');
    return vector;
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    return this.embed(texts, 'search_document');
  }

  private async embed(
    texts: string[],
    cohereInputType: 'search_query' | 'search_document',
  ): Promise<number[][]> {
    if (this.provider === 'cohere') {
      return this.embedCohere(texts, cohereInputType);
    }
    return this.embedOpenAI(texts);
  }

  private async embedCohere(
    texts: string[],
    inputType: 'search_query' | 'search_document',
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
        input_type: inputType,
        embedding_types: ['float'],
        output_dimension: this.cohereDim,
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

  private async embedOpenAI(texts: string[]): Promise<number[][]> {
    const response = await this.openai!.embeddings.create({
      model: this.openaiModel,
      input: texts,
    });
    if (!response.data?.length) {
      throw new Error('OpenAI embed returned no vectors');
    }
    return response.data.map((d) => d.embedding);
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
