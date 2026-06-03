'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, Headphones, ChevronRight } from 'lucide-react';
import { getBotMeta } from '@/lib/bot-meta';

const crumbs: Record<string, string> = {
  '/studio/integrations': 'Integrations',
  '/studio/usage': 'Usage',
  '/studio/billing': 'Billing',
  '/studio/settings': 'Settings',
};

type Breadcrumb = {
  id: string;
  label: string;
  href?: string;
};

function getBreadcrumbs(pathname: string, botLabel: string): Breadcrumb[] {
  const parts: Breadcrumb[] = [
    { id: 'workspace', label: 'Default Workspace', href: '/studio' },
  ];

  if (pathname.startsWith('/studio/bots/')) {
    const botBase = pathname.match(/^\/studio\/bots\/[^/]+/)?.[0] ?? '/studio/bots/main';
    parts.push({ id: 'bot', label: botLabel, href: `${botBase}/workflows` });

    if (pathname.includes('/workflows')) {
      parts.push({ id: 'workflows', label: 'Workflows' });
    } else if (pathname.includes('/conversations')) {
      parts.push({ id: 'conversations', label: 'Conversations' });
    } else if (pathname.includes('/knowledge')) {
      parts.push({ id: 'knowledge', label: 'Knowledge' });
    }
    return parts;
  }

  if (pathname === '/studio') {
    parts.push({ id: 'home', label: 'Home' });
    return parts;
  }

  const label = crumbs[pathname];
  if (label) {
    parts.push({ id: pathname, label, href: pathname });
  }

  return parts;
}

export default function WorkspaceTopBar() {
  const pathname = usePathname();
  const [botLabel, setBotLabel] = useState('MAXR Agent');

  useEffect(() => {
    setBotLabel(getBotMeta('main').name);
  }, [pathname]);

  const trail = getBreadcrumbs(pathname, botLabel);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white px-5">
      <nav className="flex items-center gap-1 text-sm text-slate-500 min-w-0">
        {trail.map((item, i) => (
          <span key={item.id} className="flex items-center gap-1 min-w-0">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />}
            {i === trail.length - 1 || !item.href ? (
              <span className="font-medium text-slate-900 truncate">{item.label}</span>
            ) : (
              <Link href={item.href} className="hover:text-slate-800 truncate">
                {item.label}
              </Link>
            )}
          </span>
        ))}
      </nav>

      <div className="flex items-center gap-2 shrink-0">
        <Link
          href="#"
          className="hidden sm:inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50/80 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 transition-colors"
        >
          Questions? Get a quick demo
        </Link>
        <button
          type="button"
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
          aria-label="Support"
        >
          <Headphones className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
        </button>
        <div className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-xs font-semibold text-white">
          M
        </div>
      </div>
    </header>
  );
}
