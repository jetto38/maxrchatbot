import { Module } from '@nestjs/common';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { QdrantService } from '../../core/vector/qdrant.service';
import { EmbeddingsService } from '../../core/vector/embeddings.service';
import { SupabaseService } from '../../core/database/supabase.service';
import { AIFactory } from '../../core/ai/ai.factory';
import { OpenAIProvider } from '../../core/ai/openai.provider';
import { GroqProvider } from '../../core/ai/groq.provider';

@Module({
  controllers: [KnowledgeController],
  providers: [
    KnowledgeService,
    QdrantService,
    EmbeddingsService,
    SupabaseService,
    AIFactory,
    OpenAIProvider,
    GroqProvider,
  ],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}