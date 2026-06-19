import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';

export interface QdrantPoint {
  id: string;
  vector: number[];
  payload: Record<string, any>;
  score?: number;
}

@Injectable()
export class QdrantService implements OnModuleInit {
  private readonly logger = new Logger(QdrantService.name);
  private client: QdrantClient;

  constructor() {
    const url = process.env.QDRANT_URL || 'http://localhost:6333';
    const apiKey = process.env.QDRANT_API_KEY || undefined;
    // apiKey is required to connect to Qdrant Cloud (managed clusters reject
    // unauthenticated requests). It is omitted for local/self-hosted Qdrant.
    this.client = new QdrantClient({ url, apiKey, checkCompatibility: false });
  }

  async onModuleInit() {
    try {
      await this.client.getCollections();
      this.logger.log('Connected to Qdrant');
    } catch (err) {
      this.logger.warn('Qdrant not available yet. Will retry on first use.');
    }
  }

  async ensureCollection(name: string, vectorSize: number = 1024) {
    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some((c) => c.name === name);

      if (exists) {
        // Recreate if the existing collection's vector size doesn't match the
        // current embedding model (e.g. after switching OpenAI 1536 -> Cohere
        // 1024). Mismatched dimensions make every upsert/search fail.
        const info = await this.client.getCollection(name);
        const params: any = info.config?.params?.vectors;
        const currentSize =
          typeof params?.size === 'number' ? params.size : undefined;
        if (currentSize !== undefined && currentSize !== vectorSize) {
          this.logger.warn(
            `Qdrant collection ${name} dimension ${currentSize} != ${vectorSize}; recreating.`,
          );
          await this.client.deleteCollection(name);
        } else {
          return;
        }
      }

      await this.client.createCollection(name, {
        vectors: { size: vectorSize, distance: 'Cosine' },
      });
      this.logger.log(`Created Qdrant collection: ${name} (dim ${vectorSize})`);
    } catch (err) {
      this.logger.warn(`Unable to ensure Qdrant collection ${name}: ${err}`);
    }
  }

  async upsert(collection: string, points: QdrantPoint[]) {
    await this.client.upsert(collection, { points });
  }

  async search(
    collection: string,
    vector: number[],
    limit: number = 5,
    filter?: Record<string, any>,
  ): Promise<QdrantPoint[]> {
    const result = await this.client.search(collection, {
      vector,
      limit,
      with_payload: true,
      ...(filter ? { filter } : {}),
    });
    return result.map((r) => ({
      id: String(r.id),
      vector: [],
      payload: r.payload as Record<string, any>,
      score: r.score,
    }));
  }

  async deleteCollection(name: string) {
    await this.client.deleteCollection(name);
  }
}