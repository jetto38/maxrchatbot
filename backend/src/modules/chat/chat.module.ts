import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { AIFactory } from '../../core/ai/ai.factory';
import { OpenAIProvider } from '../../core/ai/openai.provider';
import { GroqProvider } from '../../core/ai/groq.provider';
import { GeminiProvider } from '../../core/ai/gemini.provider';
import { PromptInjectionFilter } from '../../core/security/prompt-injection.filter';
import { SupabaseService } from '../../core/database/supabase.service';
import { KnowledgeModule } from '../knowledge/knowledge.module';

@Module({
  imports: [KnowledgeModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatGateway,
    OpenAIProvider,
    GroqProvider,
    GeminiProvider,
    AIFactory,
    PromptInjectionFilter,
    SupabaseService,
  ],
  exports: [ChatService, ChatGateway],
})
export class ChatModule {}