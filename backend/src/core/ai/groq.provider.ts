import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { AIProvider, AIMessage, AICompletionOptions, AIResponse } from './ai.interface';

@Injectable()
export class GroqProvider implements AIProvider {
  name = 'groq';
  private readonly logger = new Logger(GroqProvider.name);
  private client: OpenAI;
  // When the primary model hits its daily token cap, every subsequent request
  // would also 429 — wasting a round-trip per message. Remember the cooldown
  // window and route straight to the fallback model until it elapses.
  private primaryCooldownUntil = 0;
  private static readonly COOLDOWN_MS = 5 * 60 * 1000;

  constructor() {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      this.logger.warn('GROQ_API_KEY not set — Groq provider will fail at runtime');
    }
    this.client = new OpenAI({
      apiKey: apiKey || 'dummy',
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }

  async generateCompletion(
    messages: AIMessage[],
    options?: AICompletionOptions,
  ): Promise<AIResponse> {
    const model = options?.model || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    // A lighter model with a separate quota, used to keep the bot responsive
    // when the primary model exhausts its daily token budget (429).
    const fallbackModel = process.env.GROQ_FALLBACK_MODEL || 'llama-3.1-8b-instant';

    // If the primary model is in a known cooldown, skip it entirely and go
    // straight to the fallback so we don't burn a guaranteed 429 per request.
    if (
      model !== fallbackModel &&
      !options?.model &&
      Date.now() < this.primaryCooldownUntil
    ) {
      return this.complete(fallbackModel, messages, options);
    }

    try {
      return await this.complete(model, messages, options);
    } catch (err) {
      if (this.isRateLimit(err) && model !== fallbackModel) {
        this.primaryCooldownUntil = Date.now() + GroqProvider.COOLDOWN_MS;
        this.logger.warn(
          `Model "${model}" rate-limited; using fallback "${fallbackModel}" ` +
            `for the next ${GroqProvider.COOLDOWN_MS / 60000}m`,
        );
        return this.complete(fallbackModel, messages, options);
      }
      throw err;
    }
  }

  private async complete(
    model: string,
    messages: AIMessage[],
    options?: AICompletionOptions,
  ): Promise<AIResponse> {
    const completion = await this.client.chat.completions.create({
      model,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 1024,
    });

    const choice = completion.choices[0];
    return {
      content: choice?.message?.content || '',
      provider: this.name,
      model,
      usage: completion.usage
        ? {
            promptTokens: completion.usage.prompt_tokens,
            completionTokens: completion.usage.completion_tokens,
            totalTokens: completion.usage.total_tokens,
          }
        : undefined,
    };
  }

  private isRateLimit(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      (err as { status?: number }).status === 429
    );
  }
}