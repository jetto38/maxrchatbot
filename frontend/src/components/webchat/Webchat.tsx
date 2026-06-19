'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, X, Send, Minus, RotateCcw } from 'lucide-react';
import { useChatStore } from '@/store/useChatStore';
import { botApi } from '@/lib/api';
import {
  getStoredSessionId,
  setStoredSessionId,
  getVisitorId,
  setVisitorId as persistVisitorId,
  clearChatSession,
} from '@/lib/chat-session';

function TypingDots() {
  return (
    <div className="flex gap-1 py-1">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-2 w-2 rounded-full bg-gray-400 animate-bounce"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}

export default function Webchat() {
  const {
    isOpen,
    toggleChat,
    messages,
    addMessage,
    addMessages,
    setMessages,
    isTyping,
    setIsTyping,
    sessionId,
    setSessionId,
    setVisitorId,
    botName,
    setBotName,
    isReady,
    setIsReady,
    error,
    setError,
    reset,
  } = useChatStore();

  const [input, setInput] = useState('');
  const [initLoading, setInitLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    botApi.getBranding().then((b) => setBotName(b.bot_name || 'Assistant')).catch(() => {});
  }, [setBotName]);

  useEffect(() => {
    scrollRef.current && (scrollRef.current.scrollTop = scrollRef.current.scrollHeight);
  }, [messages, isTyping]);

  const mapHistory = useCallback(
    (
      rows: Array<{
        id: string;
        role: string;
        content: string;
        createdAt: string;
        metadata?: { type?: string; choices?: { id: string; label: string }[] };
      }>,
    ) =>
      rows
        .filter((r) => r.role === 'user' || r.role === 'assistant')
        .map((r) => ({
          id: r.id,
          role: r.role as 'user' | 'assistant',
          type: (r.metadata?.type as 'text' | 'choice') || 'text',
          content: r.content,
          choices: r.metadata?.choices,
          createdAt: r.createdAt,
        })),
    [],
  );

  const ensureSession = useCallback(async () => {
    if (sessionId && isReady) return sessionId;
    setInitLoading(true);
    setError(null);
    try {
      const stored = getStoredSessionId();
      if (stored) {
        try {
          const history = await botApi.getHistory(stored);
          setSessionId(stored);
          if (history.length) setMessages(mapHistory(history));
          setIsReady(true);
          return stored;
        } catch {
          clearChatSession();
        }
      }
      const res = await botApi.createSession(getVisitorId() || undefined);
      persistVisitorId(res.visitorId);
      setVisitorId(res.visitorId);
      setStoredSessionId(res.sessionId);
      setSessionId(res.sessionId);
      addMessages(res.messages);
      setIsReady(true);
      return res.sessionId;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cannot reach bot server (port 3001)');
      return null;
    } finally {
      setInitLoading(false);
    }
  }, [
    sessionId,
    isReady,
    mapHistory,
    setSessionId,
    setVisitorId,
    setMessages,
    addMessages,
    setIsReady,
    setError,
  ]);

  useEffect(() => {
    if (isOpen && !isReady && !initLoading) void ensureSession();
  }, [isOpen, isReady, initLoading, ensureSession]);

  const sendText = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isTyping) return;
    const sid = await ensureSession();
    if (!sid) return;

    addMessage({
      id: `u-${Date.now()}`,
      role: 'user',
      type: 'text',
      content: trimmed,
      createdAt: new Date().toISOString(),
    });
    setInput('');
    setIsTyping(true);
    try {
      const { messages: replies } = await botApi.sendMessage(sid, trimmed);
      addMessages(
        replies.map((m, i) => ({
          ...m,
          id: m.id || `a-${Date.now()}-${i}`,
          createdAt: new Date().toISOString(),
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setIsTyping(false);
    }
  };

  const lastChoices = [...messages]
    .reverse()
    .find((m) => m.role === 'assistant' && m.choices?.length)?.choices;

  const showChoices =
    lastChoices &&
    !isTyping &&
    messages[messages.length - 1]?.role !== 'user';

  return (
    <div className="fixed bottom-5 right-5 z-[9999] flex flex-col items-end">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            className="mb-3 flex h-[min(600px,calc(100vh-5rem))] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
          >
            <header className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-gray-50 text-sm font-semibold text-gray-900">
                  {botName.charAt(0)}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-gray-900 truncate">{botName}</p>
                  <p className="text-xs text-gray-500">Online</p>
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => {
                    clearChatSession();
                    reset();
                    void ensureSession();
                  }}
                  className="rounded-md p-2 text-gray-500 hover:bg-gray-100"
                  title="Restart"
                >
                  <RotateCcw size={16} />
                </button>
                <button
                  type="button"
                  onClick={toggleChat}
                  className="rounded-md p-2 text-gray-500 hover:bg-gray-100"
                >
                  <Minus size={16} />
                </button>
              </div>
            </header>

            <div ref={scrollRef} className="flex-1 overflow-y-auto bg-white px-4 py-4 space-y-3">
              {initLoading && (
                <p className="text-center text-xs text-gray-400">Starting conversation…</p>
              )}
              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  {error}
                </div>
              )}
              {messages.map((msg) => {
                // Choice messages carry their selectable options separately (rendered
                // as buttons below). Still show any prompt text they include — e.g.
                // "Please select one of the options below:" — so typed input that
                // re-triggers the menu isn't silently dropped. Skip only blank text.
                const text = msg.content?.trim();
                if (!text) return null;
                return (
                  <div key={msg.id}>
                    <div
                      className={
                        msg.role === 'user'
                          ? 'ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-gray-900 px-4 py-2 text-sm text-white'
                          : 'mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-900'
                      }
                    >
                      {msg.content}
                    </div>
                  </div>
                );
              })}
              {showChoices && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {lastChoices!.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => void sendText(c.label)}
                      className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 hover:border-gray-400 transition-colors"
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
              {isTyping && (
                <div className="mr-auto rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2">
                  <TypingDots />
                </div>
              )}
            </div>

            <footer className="shrink-0 border-t border-gray-200 bg-white p-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendText(input);
                }}
                className="flex gap-2"
              >
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Type a message…"
                  disabled={isTyping || initLoading}
                  className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-300"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isTyping}
                  className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-900 text-white disabled:opacity-40 hover:bg-gray-800"
                >
                  <Send size={16} />
                </button>
              </form>
              <p className="mt-2 text-center text-[10px] text-gray-400">Powered by MAXR</p>
            </footer>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={toggleChat}
        aria-label="Open chat"
        className="flex h-14 w-14 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-900 shadow-lg hover:bg-gray-50"
      >
        {isOpen ? <X size={24} /> : <MessageCircle size={24} />}
      </button>
    </div>
  );
}
