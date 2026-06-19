import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../../core/database/supabase.service';
import { FlowEngineService } from '../../flows/flow-engine.service';
import { FlowStoreService } from '../../flows/flow-store.service';
import { FlowState, BotReplyMessage } from '../../flows/flow.types';

// In-memory conversation shape used when Supabase is unavailable.
interface MemConversation {
  id: string;
  metadata: Record<string, any>;
  status: string;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    created_at: string;
    metadata: Record<string, unknown>;
  }>;
}

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  // Fallback store so the webchat keeps working when Supabase is unreachable
  // (e.g. no credentials in dev). Sessions tracked here bypass Supabase for all
  // reads/writes; sessions created in Supabase continue to use Supabase.
  private readonly memStore = new Map<string, MemConversation>();

  constructor(
    private supabase: SupabaseService,
    private flowStore: FlowStoreService,
    private flowEngine: FlowEngineService,
  ) {}

  async createSession(visitorId?: string) {
    const vid = visitorId || randomUUID();
    const flow = await this.flowStore.getPublishedFlow();
    const initialMetadata = {
      visitor_id: vid,
      flow_id: flow.id,
      flow_state: this.flowEngine.createInitialState(flow),
    };

    let sessionId: string;
    try {
      const { data, error } = await this.supabase.client
        .from('conversations')
        .insert({ source: 'webchat', status: 'active', metadata: initialMetadata })
        .select('id')
        .single();
      if (error || !data) throw new Error(error?.message || 'insert returned no row');
      sessionId = data.id;
    } catch (err) {
      // Supabase unavailable: fall back to an in-memory session so the welcome
      // message is still delivered and the conversation can continue.
      sessionId = randomUUID();
      this.memStore.set(sessionId, {
        id: sessionId,
        status: 'active',
        metadata: initialMetadata,
        messages: [],
      });
      this.logger.warn(`Supabase unavailable; using in-memory session ${sessionId}: ${err}`);
    }

    const turn = await this.flowEngine.startConversation(flow);
    await this.persistFlowState(sessionId, turn.state);
    await this.storeBotMessages(sessionId, turn.messages);

    if (turn.escalated) {
      await this.escalate(sessionId);
    }

    return {
      sessionId,
      visitorId: vid,
      messages: this.formatOutgoing(turn.messages),
    };
  }

  async sendMessage(sessionId: string, text: string) {
    const conversation = await this.getConversation(sessionId);
    const flow = await this.flowStore.getPublishedFlow();
    const state: FlowState =
      conversation.metadata?.flow_state ?? this.flowEngine.createInitialState(flow);

    await this.storeMessage(sessionId, 'user', text);

    const turn = await this.flowEngine.handleUserInput(flow, state, text);
    await this.persistFlowState(sessionId, turn.state);
    await this.storeBotMessages(sessionId, turn.messages);

    if (turn.escalated) {
      await this.escalate(sessionId);
    }

    return { messages: this.formatOutgoing(turn.messages), state: turn.state };
  }

  async getHistory(sessionId: string) {
    const mem = this.memStore.get(sessionId);
    if (mem) {
      return mem.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.created_at,
        metadata: m.metadata,
      }));
    }
    const { data } = await this.supabase.client
      .from('messages')
      .select('*')
      .eq('conversation_id', sessionId)
      .order('created_at', { ascending: true });
    return (data || []).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.created_at,
      metadata: m.metadata,
    }));
  }

  async getBranding() {
    const { data } = await this.supabase.client
      .from('settings')
      .select('value')
      .eq('key', 'branding')
      .maybeSingle();

    const defaults = {
      bot_name: 'Assistant',
      primary_color: '#ffffff',
      accent_color: '#111827',
      logo_url: '',
    };

    return { ...defaults, ...(data?.value ?? {}) };
  }

  private formatOutgoing(messages: BotReplyMessage[]) {
    return messages
      .filter((m) => m.type === 'text' ? m.content.trim() : true)
      .map((m, i) => ({
        id: `bot-${Date.now()}-${i}`,
        role: 'assistant' as const,
        type: m.type,
        content: m.type === 'text' ? m.content : m.content || 'Choose an option:',
        choices: m.choices,
      }));
  }

  private async storeBotMessages(sessionId: string, messages: BotReplyMessage[]) {
    for (const m of messages) {
      if (m.type === 'text' && !m.content.trim()) continue;
      const content =
        m.type === 'text' ? m.content : m.content?.trim() ? m.content : 'Choose an option:';
      await this.storeMessage(sessionId, 'assistant', content, {
        type: m.type,
        choices: m.choices,
      });
    }
  }

  private async storeMessage(
    sessionId: string,
    role: string,
    content: string,
    metadata?: Record<string, unknown>,
  ) {
    const mem = this.memStore.get(sessionId);
    if (mem) {
      mem.messages.push({
        id: randomUUID(),
        role,
        content,
        created_at: new Date().toISOString(),
        metadata: metadata ?? {},
      });
      return;
    }
    await this.supabase.client.from('messages').insert({
      conversation_id: sessionId,
      role,
      content,
      metadata: metadata ?? {},
    });
    await this.supabase.client
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', sessionId);
  }

  private async persistFlowState(sessionId: string, state: FlowState) {
    const mem = this.memStore.get(sessionId);
    if (mem) {
      mem.metadata = { ...mem.metadata, flow_state: state };
      return;
    }
    const conv = await this.getConversation(sessionId);
    await this.supabase.client
      .from('conversations')
      .update({
        metadata: { ...conv.metadata, flow_state: state },
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId);
  }

  private async getConversation(sessionId: string) {
    const mem = this.memStore.get(sessionId);
    if (mem) return mem;
    const { data } = await this.supabase.client
      .from('conversations')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle();
    if (!data) throw new NotFoundException('Session not found');
    return data;
  }

  private async escalate(sessionId: string) {
    const mem = this.memStore.get(sessionId);
    if (mem) {
      mem.status = 'escalated';
      return;
    }
    await this.supabase.client
      .from('conversations')
      .update({ status: 'escalated', updated_at: new Date().toISOString() })
      .eq('id', sessionId);
  }
}
