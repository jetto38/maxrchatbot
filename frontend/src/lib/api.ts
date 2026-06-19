import type { FlowDefinition } from './flow-types';

/** In the browser, use same-origin `/api` (Next.js proxy) when env is unset. */
export function getApiBase(): string {
  const env = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '');
  if (env) return env;
  if (typeof window !== 'undefined') return '';
  return 'http://localhost:3001';
}

const FETCH_TIMEOUT_MS = 30000;

export async function fetchApi(
  path: string,
  init?: RequestInit,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const url = `${getApiBase()}${path.startsWith('/') ? path : `/${path}`}`;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    // Translate the cryptic native abort ("signal is aborted without reason")
    // into a clear, user-facing message.
    if (timedOut || (err instanceof DOMException && err.name === 'AbortError')) {
      throw new Error('The request timed out. Please try again.');
    }
    throw err instanceof Error
      ? err
      : new Error('Network error — could not reach the server.');
  } finally {
    clearTimeout(timer);
  }
}

async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof data === 'object' && data && 'message' in data
        ? String((data as { message: string | string[] }).message)
        : res.statusText;
    throw new Error(Array.isArray(message) ? message.join(', ') : message);
  }
  return data as T;
}

export interface WebchatMessage {
  id: string;
  role: 'user' | 'assistant';
  type?: 'text' | 'choice';
  content: string;
  choices?: { id: string; label: string }[];
  createdAt?: string;
}

export const botApi = {
  getBranding() {
    return fetchApi('/api/bot/branding').then(
      parseJson<{
        bot_name: string;
        primary_color: string;
        accent_color: string;
        logo_url: string;
      }>,
    );
  },

  createSession(visitorId?: string) {
    return fetchApi('/api/bot/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId }),
    }).then(
      parseJson<{
        sessionId: string;
        visitorId: string;
        messages: WebchatMessage[];
      }>,
    );
  },

  sendMessage(sessionId: string, message: string) {
    return fetchApi('/api/bot/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message }),
    }).then(parseJson<{ messages: WebchatMessage[] }>);
  },

  getHistory(sessionId: string) {
    return fetchApi(`/api/bot/history/${sessionId}`).then(
      parseJson<
        Array<{
          id: string;
          role: string;
          content: string;
          createdAt: string;
          metadata?: { type?: string; choices?: { id: string; label: string }[] };
        }>
      >,
    );
  },
};

export const studioApi = {
  getFlow() {
    return fetchApi('/api/studio/flow').then(parseJson<FlowDefinition>);
  },

  saveFlow(flow: FlowDefinition) {
    return fetchApi('/api/studio/flow', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(flow),
    }).then(parseJson<FlowDefinition>);
  },
};

export interface StudioAnalytics {
  totalConversations: number;
  activeChats: number;
  escalated: number;
  totalLeads: number;
}

export interface StudioConversation {
  id: string;
  status: string;
  source: string;
  created_at: string;
  updated_at: string;
  metadata?: { visitor_id?: string };
  messages?: Array<{ id: string; content: string; role: string; created_at: string }>;
}

export interface KnowledgeArticle {
  id: string;
  title: string;
  content: string;
  created_at: string;
}

export const studioDataApi = {
  getAnalytics() {
    return fetchApi('/api/studio/analytics').then(parseJson<StudioAnalytics>);
  },

  getConversations() {
    return fetchApi('/api/studio/conversations').then(parseJson<StudioConversation[]>);
  },

  getKnowledge() {
    return fetchApi('/api/studio/knowledge').then(parseJson<KnowledgeArticle[]>);
  },

  uploadKnowledge(body: { title: string; content: string }) {
    return fetchApi('/api/studio/knowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(parseJson<KnowledgeArticle>);
  },
};
