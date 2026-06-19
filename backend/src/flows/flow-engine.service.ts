import { Injectable, Logger } from '@nestjs/common';
import { AIFactory } from '../core/ai/ai.factory';
import { AIMessage } from '../core/ai/ai.interface';
import { KnowledgeService } from '../modules/knowledge/knowledge.service';
import {
  BotReplyMessage,
  BotTurnResult,
  FlowChoice,
  FlowDefinition,
  FlowNode,
  FlowState,
} from './flow.types';

@Injectable()
export class FlowEngineService {
  private readonly logger = new Logger(FlowEngineService.name);

  constructor(
    private aiFactory: AIFactory,
    private knowledgeService: KnowledgeService,
  ) {}

  createInitialState(flow: FlowDefinition): FlowState {
    const start = flow.nodes.find((n) => n.type === 'start');
    return {
      currentNodeId: start?.id ?? flow.nodes[0]?.id ?? null,
      variables: {},
      awaiting: 'none',
      completed: false,
    };
  }

  async startConversation(flow: FlowDefinition): Promise<BotTurnResult> {
    const state = this.createInitialState(flow);
    return this.advanceUntilInput(flow, state);
  }

  async handleUserInput(
    flow: FlowDefinition,
    state: FlowState,
    userText: string,
  ): Promise<BotTurnResult> {
    if (state.completed) {
      return this.runAiFallback(userText, state);
    }

    const trimmed = userText.trim();
    if (!trimmed) {
      return { messages: [], state, escalated: false };
    }

    if (state.awaiting === 'choice' && state.choiceNodeId) {
      const node = flow.nodes.find((n) => n.id === state.choiceNodeId);
      const choice = this.matchChoice(node, trimmed);
      if (!choice) {
        return {
          messages: [
            {
              type: 'choice',
              content: 'Please select one of the options below:',
              choices: node?.data.choices,
            },
          ],
          state,
        };
      }
      state.awaiting = 'none';
      const next = this.getNextNode(flow, state.choiceNodeId, choice.id);
      if (!next) {
        state.completed = true;
        return { messages: [], state };
      }
      state.currentNodeId = next.id;
      return this.advanceUntilInput(flow, state);
    }

    if (state.awaiting === 'text' && state.currentNodeId) {
      const node = flow.nodes.find((n) => n.id === state.currentNodeId);
      if (node?.type === 'capture') {
        const key = node.data.variable || node.data.field || 'input';
        state.variables[key] = trimmed;
        state.awaiting = 'none';
        const next = this.getNextNode(flow, node.id);
        if (next) {
          state.currentNodeId = next.id;
          return this.advanceUntilInput(flow, state);
        }
      }
      if (node?.type === 'ai') {
        state.awaiting = 'none';
        const reply = await this.generateAiReply(trimmed, node, state);
        return {
          messages: [{ type: 'text', content: reply }],
          state: { ...state, awaiting: 'text', currentNodeId: node.id },
        };
      }
    }

    if (state.currentNodeId) {
      const current = flow.nodes.find((n) => n.id === state.currentNodeId);
      if (current?.type === 'ai') {
        const reply = await this.generateAiReply(trimmed, current, state);
        return {
          messages: [{ type: 'text', content: reply }],
          state: { ...state, awaiting: 'text' },
        };
      }
    }

    return this.runAiFallback(trimmed, state);
  }

  private async advanceUntilInput(
    flow: FlowDefinition,
    state: FlowState,
  ): Promise<BotTurnResult> {
    const messages: BotReplyMessage[] = [];
    let guard = 0;
    let escalated = false;

    while (guard++ < 20 && state.currentNodeId && !state.completed) {
      const node = flow.nodes.find((n) => n.id === state.currentNodeId);
      if (!node) break;

      switch (node.type) {
        case 'start': {
          const next = this.getNextNode(flow, node.id);
          state.currentNodeId = next?.id ?? null;
          break;
        }
        case 'message': {
          if (node.data.text) {
            messages.push({ type: 'text', content: this.interpolate(node.data.text, state) });
          }
          const next = this.getNextNode(flow, node.id);
          if (next) state.currentNodeId = next.id;
          else state.completed = true;
          break;
        }
        case 'choice': {
          if (node.data.text) {
            messages.push({ type: 'text', content: this.interpolate(node.data.text, state) });
          }
          messages.push({
            type: 'choice',
            content: ' ',
            choices: node.data.choices ?? [],
          });
          state.awaiting = 'choice';
          state.choiceNodeId = node.id;
          return { messages, state, escalated };
        }
        case 'capture': {
          if (node.data.text) {
            messages.push({ type: 'text', content: this.interpolate(node.data.text, state) });
          }
          state.awaiting = 'text';
          return { messages, state, escalated };
        }
        case 'ai': {
          if (node.data.text) {
            messages.push({ type: 'text', content: this.interpolate(node.data.text, state) });
          } else if (messages.length === 0) {
            // An AI node with no scripted greeting would otherwise leave the
            // user staring at silence after a choice. Emit a short invitation
            // so it's clear the bot is waiting for their question.
            messages.push({
              type: 'text',
              content: 'Sure — how can I help? Go ahead and describe what you need.',
            });
          }
          state.awaiting = 'text';
          return { messages, state, escalated };
        }
        case 'handoff': {
          if (node.data.text) {
            messages.push({ type: 'text', content: node.data.text });
          }
          escalated = true;
          const next = this.getNextNode(flow, node.id);
          if (next) state.currentNodeId = next.id;
          else state.completed = true;
          break;
        }
        case 'end': {
          if (node.data.text) {
            messages.push({ type: 'text', content: node.data.text });
          }
          state.completed = true;
          state.currentNodeId = null;
          state.awaiting = 'none';
          return { messages, state, escalated };
        }
        default:
          state.completed = true;
          break;
      }
    }

    return { messages, state, escalated };
  }

  private matchChoice(node: FlowNode | undefined, input: string): FlowChoice | null {
    if (!node?.data.choices) return null;
    const lower = input.toLowerCase();
    return (
      node.data.choices.find(
        (c) =>
          c.id.toLowerCase() === lower ||
          c.label.toLowerCase() === lower ||
          lower.includes(c.label.toLowerCase()),
      ) ?? null
    );
  }

  private getNextNode(
    flow: FlowDefinition,
    sourceId: string,
    sourceHandle?: string,
  ): FlowNode | undefined {
    const edge = flow.edges.find(
      (e) =>
        e.source === sourceId &&
        (sourceHandle ? e.sourceHandle === sourceHandle : !e.sourceHandle),
    );
    if (!edge) {
      const anyEdge = flow.edges.find((e) => e.source === sourceId);
      if (!anyEdge) return undefined;
      return flow.nodes.find((n) => n.id === anyEdge.target);
    }
    return flow.nodes.find((n) => n.id === edge.target);
  }

  private interpolate(text: string, state: FlowState): string {
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => state.variables[key] ?? '');
  }

  private async generateAiReply(
    userText: string,
    node: FlowNode,
    state: FlowState,
  ): Promise<string> {
    let context = '';
    try {
      const chunks = await this.knowledgeService.search(userText, 4);
      context = chunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n');
    } catch (err) {
      this.logger.warn(`RAG skipped: ${err}`);
    }

    const system =
      node.data.prompt ||
      'You are a helpful customer support assistant. Be concise and professional.';

    const messages: AIMessage[] = [
      {
        role: 'system',
        content: context ? `${system}\n\nKnowledge:\n${context}` : system,
      },
      { role: 'user', content: userText },
    ];

    try {
      const res = await this.aiFactory.generateWithFallback(messages);
      return res.content;
    } catch (err) {
      this.logger.error(`AI completion failed: ${err instanceof Error ? err.message : err}`);
      return "I'm having trouble connecting to AI right now. Please try again or ask for a human agent.";
    }
  }

  private async runAiFallback(userText: string, state: FlowState): Promise<BotTurnResult> {
    const reply = await this.generateAiReply(userText, { id: 'fb', type: 'ai', data: {}, position: { x: 0, y: 0 } }, state);
    return {
      messages: [{ type: 'text', content: reply }],
      state,
    };
  }
}
