import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';

export interface QdrantPoint {
  id: string;
  vector: number[];
  payload: Record<string, any>;
}

@Injectable()
export class QdrantService implements OnModuleInit {
  private readonly logger = new Logger(QdrantService.name);
  private client: QdrantClient;

  constructor() {
    const url = process.env.QDRANT_URL || 'http://localhost:6333';
    this.client = new QdrantClient({ url, checkCompatibility: false });
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
        this.logger.log(`Created Qdrant collection: ${name} (size ${vectorSize})`);
        return;
      }

      // If the existing collection's vector size no longer matches the active
      // embedding provider (e.g. switched OpenAI 1536 -> Cohere 1024), inserts
      // would fail. Recreate it when empty; otherwise warn rather than wipe data.
      const info = await this.client.getCollection(name);
      const currentSize = (info.config?.params?.vectors as { size?: number } | undefined)?.size;
      const pointCount = info.points_count ?? 0;
      if (currentSize && currentSize !== vectorSize) {
        if (pointCount === 0) {
          await this.client.deleteCollection(name);
          await this.client.createCollection(name, {
            vectors: { size: vectorSize, distance: 'Cosine' },
          });
          this.logger.log(
            `Recreated Qdrant collection ${name}: size ${currentSize} -> ${vectorSize}`,
          );
        } else {
          this.logger.warn(
            `Qdrant collection ${name} size ${currentSize} != embedding size ${vectorSize}, ` +
              `but it holds ${pointCount} points — leaving as-is. Run a reindex after clearing it.`,
          );
        }
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
      payload: { ...(r.payload as Record<string, any>), score: r.score },
    }));
  }

  async deleteCollection(name: string) {
    await this.client.deleteCollection(name);
  }
}