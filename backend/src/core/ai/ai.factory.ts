import { Injectable, Logger } from '@nestjs/common';
import { AIProvider, AIMessage, AICompletionOptions, AIResponse } from './ai.interface';
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

  /**
   * Ordered list of providers to try for a completion: the configured primary
   * first, then the rest. Lets a 429/quota error on one provider (e.g. Gemini
   * free tier) transparently fall through to another (e.g. Groq).
   */
  private fallbackOrder(): string[] {
    const primary = process.env.AI_PROVIDER || 'openai';
    const configured = (process.env.AI_FALLBACK_PROVIDERS || 'groq,gemini,openai')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    return [primary, ...configured].filter((p) => {
      if (seen.has(p) || !this.providers.has(p)) return false;
      seen.add(p);
      return true;
    });
  }

  /**
   * Generate a completion, trying providers in fallback order until one
   * succeeds. Throws the last error only if every provider fails.
   */
  async generateWithFallback(
    messages: AIMessage[],
    options?: AICompletionOptions,
  ): Promise<AIResponse> {
    const order = this.fallbackOrder();
    let lastErr: unknown;
    for (const name of order) {
      const provider = this.providers.get(name)!;
      try {
        return await provider.generateCompletion(messages, options);
      } catch (err) {
        lastErr = err;
        this.logger.warn(
          `Provider "${name}" failed (${err instanceof Error ? err.message : err}); ` +
            `trying next of [${order.join(', ')}]`,
        );
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('All AI providers failed');
  }
}