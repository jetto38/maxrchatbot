export interface BotMeta {
  name: string;
  description: string;
  alwaysAlive: boolean;
}

const KEY = 'maxr_bot_meta';

const defaults: Record<string, BotMeta> = {
  main: {
    name: 'MAXR Agent',
    description: 'Customer support bot with RAG and workflow handoff',
    alwaysAlive: false,
  },
};

export function getBotMeta(botId: string): BotMeta {
  if (typeof window === 'undefined') return defaults[botId] ?? defaults.main;
  try {
    const raw = localStorage.getItem(KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, BotMeta>) : {};
    return { ...defaults[botId], ...defaults.main, ...all[botId] };
  } catch {
    return defaults[botId] ?? defaults.main;
  }
}

export function saveBotMeta(botId: string, patch: Partial<BotMeta>) {
  const current = getBotMeta(botId);
  const next = { ...current, ...patch };
  const raw = localStorage.getItem(KEY);
  const all = raw ? (JSON.parse(raw) as Record<string, BotMeta>) : {};
  all[botId] = next;
  localStorage.setItem(KEY, JSON.stringify(all));
  return next;
}
