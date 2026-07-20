'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { useI18nStore, useT, pickBilingual } from '@/i18n';
import { ApiError } from '@/lib/api';
import { resolvePostLoginPath } from '@/lib/auth-gate';
import { useAuthStore } from '@/stores/auth';

function LoginForm() {
  const t = useT();
  const locale = useI18nStore((state) => state.locale);
  const router = useRouter();
  const params = useSearchParams();
  const login = useAuthStore((state) => state.login);

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(phone, password);
      // `next` is validated against the user's own area — see auth-gate.ts.
      router.replace(resolvePostLoginPath(user.role, params.get('next')));
    } catch (caught) {
      if (caught instanceof Error && caught.message === '2FA_REQUIRED') {
        setError(t('login.twoFactorUnsupported'));
      } else if (caught instanceof ApiError) {
        setError(pickBilingual(caught.userMessage, locale) ?? t('login.failed'));
      } else {
        setError(t('common.error'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-base">{t('login.title')}</CardTitle>
          <CardDescription>{t('login.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="phone">{t('login.phone')}</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                autoComplete="username"
                placeholder={t('login.phonePlaceholder')}
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value);
                }}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="password">{t('login.password')}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
                required
              />
            </div>

            {error !== null && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" disabled={submitting} className="mt-1">
              {submitting ? t('login.submitting') : t('login.submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
