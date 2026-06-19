import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { AIProvider, AIMessage, AICompletionOptions, AIResponse } from './ai.interface';

/**
 * Google Gemini via its OpenAI-compatible endpoint, so we can reuse the same
 * OpenAI SDK client shape as the other providers.
 * https://ai.google.dev/gemini-api/docs/openai
 */
@Injectable()
export class GeminiProvider implements AIProvider {
  name = 'gemini';
  private readonly logger = new Logger(GeminiProvider.name);
  private client: OpenAI;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      this.logger.warn('GEMINI_API_KEY not set — Gemini provider will fail at runtime');
    }
    this.client = new OpenAI({
      apiKey: apiKey || 'dummy',
      baseURL:
        process.env.GEMINI_BASE_URL ||
        'https://generativelanguage.googleapis.com/v1beta/openai',
    });
  }

  async generateCompletion(
    messages: AIMessage[],
    options?: AICompletionOptions,
  ): Promise<AIResponse> {
    const model = options?.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash';

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
}
