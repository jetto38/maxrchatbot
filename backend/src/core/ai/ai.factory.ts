import { Injectable, Logger } from '@nestjs/common';
import { AIProvider } from './ai.interface';
import { OpenAIProvider } from './openai.provider';
import { GroqProvider } from './groq.provider';

@Injectable()
export class AIFactory {
  private readonly logger = new Logger(AIFactory.name);
  private providers: Map<string, AIProvider> = new Map();

  constructor(openAIProvider: OpenAIProvider, groqProvider: GroqProvider) {
    this.providers.set('openai', openAIProvider);
    this.providers.set('groq', groqProvider);
  }

  getProvider(name?: string): AIProvider {
    // Groq is the default chat provider; OpenAI is no longer used unless
    // explicitly selected via AI_PROVIDER=openai.
    const providerName = name || process.env.AI_PROVIDER || 'groq';
    const provider = this.providers.get(providerName);
    if (!provider) {
      this.logger.warn(`Provider "${providerName}" not found, falling back to groq`);
      return this.providers.get('groq')!;
    }
    return provider;
  }

  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }
}