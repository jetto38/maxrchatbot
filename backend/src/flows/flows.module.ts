import { Module } from '@nestjs/common';
import { FlowEngineService } from './flow-engine.service';
import { FlowStoreService } from './flow-store.service';
import { FlowsController } from './flows.controller';
import { StudioController } from '../studio/studio.controller';
import { AIFactory } from '../core/ai/ai.factory';
import { OpenAIProvider } from '../core/ai/openai.provider';
import { GroqProvider } from '../core/ai/groq.provider';
import { GeminiProvider } from '../core/ai/gemini.provider';
import { KnowledgeModule } from '../modules/knowledge/knowledge.module';
import { SupabaseService } from '../core/database/supabase.service';

@Module({
  imports: [KnowledgeModule],
  controllers: [FlowsController, StudioController],
  providers: [
    FlowEngineService,
    FlowStoreService,
    AIFactory,
    OpenAIProvider,
    GroqProvider,
    GeminiProvider,
    SupabaseService,
  ],
  exports: [FlowEngineService, FlowStoreService],
})
export class FlowsModule {}
