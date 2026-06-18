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

  async ensureCollection(name: string, vectorSize: number = 1536) {
    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some((c) => c.name === name);
      if (!exists) {
        await this.client.createCollection(name, {
          vectors: { size: vectorSize, distance: 'Cosine' },
        });
        this.logger.log(`Created Qdrant collection: ${name}`);
      }
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
  ): Promise<QdrantPoint[]> {
    const result = await this.client.search(collection, {
      vector,
      limit,
      with_payload: true,
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