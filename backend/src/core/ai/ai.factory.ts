import { Injectable, Logger } from '@nestjs/common';
import { AIProvider } from './ai.interface';
import { OpenAIProvider } from './openai.provider';
import { GroqProvider } from './groq.provider';
import { GeminiProvider } from './gemini.provider';

@Injectable()
export class AIFactory {
  private readonly logger = new Logger(AIFactory.name);
  private providers: Map<string, AIProvider> = new Map();

  constructor(
    openAIProvider: OpenAIProvider,
    groqProvider: GroqProvider,
    geminiProvider: GeminiProvider,
  ) {
    this.providers.set('openai', openAIProvider);
    this.providers.set('groq', groqProvider);
    this.providers.set('gemini', geminiProvider);
  }

  getProvider(name?: string): AIProvider {
    const providerName = name || process.env.AI_PROVIDER || 'openai';
    const provider = this.providers.get(providerName);
    if (!provider) {
      this.logger.warn(`Provider "${providerName}" not found, falling back to openai`);
      return this.providers.get('openai')!;
    }
    return provider;
  }

  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }
}