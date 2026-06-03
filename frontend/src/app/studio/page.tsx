'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Search, LayoutGrid, List } from 'lucide-react';
import VerifyEmailBanner from '@/components/workspace/VerifyEmailBanner';
import BotCard from '@/components/workspace/BotCard';
import RecentActivityPanel from '@/components/workspace/RecentActivityPanel';
import { studioDataApi } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function StudioHomePage() {
  const [messageCount, setMessageCount] = useState(0);
  const [view, setView] = useState<'grid' | 'list'>('grid');

  useEffect(() => {
    studioDataApi
      .getConversations()
      .then((c) => {
        const msgs = c.reduce((n, conv) => n + (conv.messages?.length || 0), 0);
        setMessageCount(msgs);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <VerifyEmailBanner />
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        <div className="flex-1 min-w-0 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Default Workspace</h1>
              <span className="inline-flex mt-1 rounded-md bg-slate-200/60 px-2 py-0.5 text-xs font-medium text-slate-600">
                Free
              </span>
            </div>
            <Link href="/studio/bots/main/workflows">
              <Button className="bg-slate-900 hover:bg-slate-800 text-white shadow-sm gap-2">
                <Plus className="h-4 w-4" />
                Create Bot
              </Button>
            </Link>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search bots…"
                className="pl-9 bg-white border-slate-200 h-10"
              />
            </div>
            <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setView('grid')}
                className={`rounded-md p-2 ${view === 'grid' ? 'bg-slate-100 text-slate-900' : 'text-slate-400'}`}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setView('list')}
                className={`rounded-md p-2 ${view === 'list' ? 'bg-slate-100 text-slate-900' : 'text-slate-400'}`}
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>

          {view === 'grid' ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <BotCard
                id="main"
                deployedAgo="Deployed · workflow active"
                messages={messageCount}
                errors={0}
              />
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <Link
                href="/studio/bots/main/workflows"
                className="flex items-center justify-between px-4 py-4 hover:bg-slate-50 transition-colors"
              >
                <span className="font-medium text-slate-900">MAXR Agent</span>
                <span className="text-xs text-slate-500">{messageCount} messages</span>
              </Link>
            </div>
          )}
        </div>

        <RecentActivityPanel />
      </div>
    </div>
  );
}
