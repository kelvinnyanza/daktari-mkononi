'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useI18nStore, useT, type Locale } from '@/i18n';
import type { TranslationKey } from '@/i18n';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

export interface NavItem {
  href: string;
  labelKey: TranslationKey;
}

/** Chrome shared by the admin and doctor areas. */
export function PortalShell({ nav, children }: { nav: NavItem[]; children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const locale = useI18nStore((state) => state.locale);
  const setLocale = useI18nStore((state) => state.setLocale);

  const onSignOut = async () => {
    await logout();
    router.replace('/login');
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <div className="flex items-center gap-6 px-6 py-3">
          <span className="text-sm font-semibold">
            {t('app.name')} <span className="text-muted-foreground">{t('app.portal')}</span>
          </span>

          <nav className="flex items-center gap-1">
            {nav.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-sm transition-colors',
                    active
                      ? 'bg-accent font-medium text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/60',
                  )}
                >
                  {t(item.labelKey)}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <select
              aria-label={t('nav.language')}
              value={locale}
              onChange={(event) => {
                setLocale(event.target.value as Locale);
              }}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs"
            >
              <option value="en">English</option>
              <option value="sw">Kiswahili</option>
            </select>
            <span className="text-xs text-muted-foreground">{user?.fullName}</span>
            <Button variant="outline" size="sm" onClick={() => void onSignOut()}>
              {t('nav.signOut')}
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 px-6 py-6">{children}</main>
    </div>
  );
}

/** Page heading used by every screen. */
export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      {subtitle !== undefined && <p className="text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
