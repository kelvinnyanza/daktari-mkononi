'use client';

import { useRouter } from 'next/navigation';
import { AuthGate } from '@/components/auth-gate';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useT } from '@/i18n';
import { useAuthStore } from '@/stores/auth';

function NoAccess() {
  const t = useT();
  const router = useRouter();
  const logout = useAuthStore((state) => state.logout);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-base">{t('noAccess.title')}</CardTitle>
          <CardDescription>{t('noAccess.body')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={() => {
              void logout().then(() => {
                router.replace('/login');
              });
            }}
          >
            {t('nav.signOut')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function NoAccessPage() {
  return (
    <AuthGate required={null}>
      <NoAccess />
    </AuthGate>
  );
}
