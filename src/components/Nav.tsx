'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';

const LINKS: Array<{ href: string; label: string; accent?: string }> = [
  { href: '/', label: 'Dashboard' },
  { href: '/tiktok', label: 'TikTok', accent: 'text-tiktok' },
  { href: '/instagram', label: 'Instagram', accent: 'text-instagram' },
  { href: '/x', label: 'X', accent: 'text-x' },
  { href: '/duplicate-checker', label: 'Duplicate Checker' },
  { href: '/saved', label: 'Saved' },
  { href: '/rejected', label: 'Rejected' },
  { href: '/settings', label: 'Settings' },
];

export function Nav(): ReactNode {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string): boolean =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <nav className="sticky top-0 z-30 border-b border-hairline bg-void/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-3">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
          <span className="font-mono text-sm font-bold tracking-tight text-ink">
            VIRAL COIN RADAR
          </span>
        </Link>

        <div className="hidden flex-1 items-center gap-1 lg:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                isActive(link.href)
                  ? 'bg-panel-raised text-ink'
                  : `text-ink-muted hover:bg-panel hover:text-ink ${link.accent ?? ''}`
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto rounded border border-hairline-strong px-2 py-1 text-xs text-ink-muted lg:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
        >
          {open ? 'Close' : 'Menu'}
        </button>
      </div>

      {open ? (
        <div id="mobile-nav" className="grid grid-cols-2 gap-1 border-t border-hairline p-2 lg:hidden">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className={`rounded px-3 py-2 text-xs font-medium ${
                isActive(link.href) ? 'bg-panel-raised text-ink' : 'text-ink-muted'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>
      ) : null}
    </nav>
  );
}
