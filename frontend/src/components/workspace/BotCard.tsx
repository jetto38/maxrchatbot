'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Bot,
  MoreHorizontal,
  MessageSquare,
  AlertCircle,
  Pencil,
  ExternalLink,
  Zap,
  ZapOff,
  FileText,
  Copy,
  Trash2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getBotMeta, saveBotMeta } from '@/lib/bot-meta';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface BotCardProps {
  id: string;
  deployedAgo?: string;
  messages?: number;
  errors?: number;
}

export default function BotCard({
  id,
  deployedAgo = 'Deployed recently',
  messages = 0,
  errors = 0,
}: BotCardProps) {
  const router = useRouter();
  const [meta, setMeta] = useState(() => getBotMeta(id));

  useEffect(() => {
    setMeta(getBotMeta(id));
  }, [id]);

  const refresh = useCallback(() => setMeta(getBotMeta(id)), [id]);

  const rename = () => {
    const next = window.prompt('Bot display name', meta.name);
    if (next?.trim()) {
      saveBotMeta(id, { name: next.trim() });
      refresh();
      toast.success('Name updated');
    }
  };

  const editDescription = () => {
    const next = window.prompt('Short description', meta.description);
    if (next !== null) {
      saveBotMeta(id, { description: next.trim() });
      refresh();
      toast.success('Description saved');
    }
  };

  const toggleAlive = () => {
    const next = !meta.alwaysAlive;
    saveBotMeta(id, { alwaysAlive: next });
    refresh();
    toast.message(next ? 'Always-on mode enabled (simulated)' : 'Always-on mode disabled');
  };

  const duplicate = () => {
    toast.message('Duplicate bot — available when multi-bot is enabled');
  };

  const remove = () => {
    if (
      window.confirm(
        'Delete this bot? Workflow and conversation data would be removed. (Default bot is protected in this build.)',
      )
    ) {
      toast.error('Delete is disabled for the default bot. Create additional bots first.');
    }
  };

  return (
    <div className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md hover:border-slate-300 transition-all">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/studio/bots/${id}/workflows`} className="flex items-center gap-3 min-w-0 flex-1">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 shadow-sm">
            <Bot className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 text-left">
            <p className="font-semibold text-slate-900 truncate group-hover:text-teal-700 transition-colors">
              {meta.name}
            </p>
            <p className="text-xs text-slate-500 mt-0.5 truncate">{deployedAgo}</p>
            {meta.description && (
              <p className="text-[11px] text-slate-400 mt-1 line-clamp-1">{meta.description}</p>
            )}
          </div>
        </Link>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              toggleAlive();
            }}
            title={meta.alwaysAlive ? 'Always on' : 'Enable always on'}
            className={cn(
              'rounded-lg p-1.5 transition-colors',
              meta.alwaysAlive
                ? 'text-amber-600 bg-amber-50 hover:bg-amber-100'
                : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600',
            )}
          >
            {meta.alwaysAlive ? <Zap className="h-4 w-4" /> : <ZapOff className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              rename();
            }}
            title="Rename"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 outline-none"
              aria-label="Bot actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-[220px] rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
            >
              <DropdownMenuItem
                onClick={rename}
                className="gap-2.5 rounded-lg px-2.5 py-2 cursor-pointer focus:bg-teal-50 focus:text-teal-900"
              >
                <Pencil className="h-4 w-4 text-slate-500" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={editDescription}
                className="gap-2.5 rounded-lg px-2.5 py-2 cursor-pointer focus:bg-teal-50 focus:text-teal-900"
              >
                <FileText className="h-4 w-4 text-slate-500" />
                Edit description
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => router.push(`/studio/bots/${id}/workflows`)}
                className="gap-2.5 rounded-lg px-2.5 py-2 cursor-pointer focus:bg-teal-50 focus:text-teal-900"
              >
                <ExternalLink className="h-4 w-4 text-slate-500" />
                Open in Studio
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={toggleAlive}
                className="gap-2.5 rounded-lg px-2.5 py-2 cursor-pointer focus:bg-teal-50 focus:text-teal-900"
              >
                <Zap className="h-4 w-4 text-slate-500" />
                {meta.alwaysAlive ? 'Disable always on' : 'Enable always on'}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={duplicate}
                className="gap-2.5 rounded-lg px-2.5 py-2 cursor-pointer focus:bg-teal-50 focus:text-teal-900"
              >
                <Copy className="h-4 w-4 text-slate-500" />
                Duplicate bot
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-slate-100 my-1" />
              <DropdownMenuItem
                variant="destructive"
                onClick={remove}
                className="gap-2.5 rounded-lg px-2.5 py-2 cursor-pointer"
              >
                <Trash2 className="h-4 w-4" />
                Delete bot
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <Link
          href="/"
          className="text-[11px] font-medium text-teal-600 hover:text-teal-700 hover:underline"
        >
          Preview webchat
        </Link>
        <span className="text-slate-300">·</span>
        <Link
          href={`/studio/bots/${id}/conversations`}
          className="text-[11px] font-medium text-slate-500 hover:text-slate-800"
        >
          Conversations
        </Link>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <MessageSquare className="h-3.5 w-3.5 text-slate-400" />
          <span className="font-medium text-slate-900">{messages}</span>
          <span>Messages</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <AlertCircle className="h-3.5 w-3.5 text-slate-400" />
          <span className="font-medium text-slate-900">{errors}</span>
          <span>Errors</span>
        </div>
      </div>
    </div>
  );
}
