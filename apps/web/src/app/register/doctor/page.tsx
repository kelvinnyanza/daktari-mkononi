'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { doctorRegistrationSchema, doctorSpecialtySchema } from '@daktari/schemas';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { pickBilingual, useI18nStore, useT, type Locale, type TranslationKey } from '@/i18n';
import { ApiError, api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

type Field = 'fullName' | 'phone' | 'password' | 'tmcRegistrationNumber' | 'specialty' | 'yearsOfExperience' | 'consultationFeeTzs';

/**
 * Public doctor self-registration (Swahili / English). Step 1 posts to the
 * existing POST /api/v1/doctors/register (202, identical body whether or not
 * the phone exists — anti-enumeration); step 2 confirms the SMS code, then
 * signs in and lands on /doctor/onboarding to upload documents. The form is
 * validated with the SAME Zod schema the API uses.
 */
export default function RegisterDoctorPage() {
  const t = useT();
  const router = useRouter();
  const locale = useI18nStore((state) => state.locale);
  const setLocale = useI18nStore((state) => state.setLocale);
  const login = useAuthStore((state) => state.login);

  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    password: '',
    tmcRegistrationNumber: '',
    specialty: 'GENERAL_PRACTICE',
    subSpecialty: '',
    yearsOfExperience: '',
    consultationFeeTzs: '',
    language: locale,
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, true>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [normalizedPhone, setNormalizedPhone] = useState('');
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const set = (name: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((current) => ({ ...current, [name]: event.target.value }));
  };
  const apiMessage = (caught: unknown): string =>
    caught instanceof ApiError ? (pickBilingual(caught.userMessage, locale) ?? t('common.error')) : t('common.error');

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    const parsed = doctorRegistrationSchema.safeParse({
      fullName: form.fullName,
      phone: form.phone,
      password: form.password,
      language: form.language,
      tmcRegistrationNumber: form.tmcRegistrationNumber,
      specialty: form.specialty,
      ...(form.subSpecialty.trim() !== '' ? { subSpecialty: form.subSpecialty } : {}),
      yearsOfExperience: Number(form.yearsOfExperience === '' ? NaN : form.yearsOfExperience),
      consultationFeeTzs: Number(form.consultationFeeTzs === '' ? NaN : form.consultationFeeTzs),
      languages: [form.language],
    });
    if (!parsed.success) {
      const flagged: Partial<Record<Field, true>> = {};
      for (const issue of parsed.error.issues) flagged[issue.path[0] as Field] = true;
      setFieldErrors(flagged);
      setError(t('register.fixFields'));
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      await api.post('/api/v1/doctors/register', parsed.data);
      setNormalizedPhone(parsed.data.phone);
      setStep('otp');
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post('/api/v1/auth/verify-otp', { phone: normalizedPhone, purpose: 'PHONE_VERIFY', code: code.trim() });
      await login(normalizedPhone, form.password);
      router.replace('/doctor/onboarding');
    } catch (caught) {
      setError(apiMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const resend = async (): Promise<void> => {
    setError(null);
    try {
      await api.post('/api/v1/auth/resend-otp', { phoneNumber: normalizedPhone, purpose: 'phone_verify' });
      setNotice(t('register.otpResent'));
    } catch (caught) {
      setError(apiMessage(caught));
    }
  };

  const invalid = (name: Field): string => (fieldErrors[name] ? 'border-destructive' : '');

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="text-base">{step === 'form' ? t('register.title') : t('register.otpTitle')}</CardTitle>
            <select
              aria-label={t('nav.language')}
              value={locale}
              onChange={(event) => {
                setLocale(event.target.value as Locale);
              }}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs"
            >
              <option value="sw">Kiswahili</option>
              <option value="en">English</option>
            </select>
          </div>
          <CardDescription>
            {step === 'form' ? t('register.subtitle') : t('register.otpBody', { phone: normalizedPhone })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === 'form' ? (
            <form onSubmit={(event) => void submit(event)} className="grid grid-cols-1 gap-3 sm:grid-cols-2" noValidate>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <Label htmlFor="fullName">{t('register.fullName')}</Label>
                <Input id="fullName" autoComplete="name" value={form.fullName} onChange={set('fullName')} className={invalid('fullName')} required />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="phone">{t('register.phone')}</Label>
                <Input id="phone" type="tel" autoComplete="tel" placeholder={t('login.phonePlaceholder')} value={form.phone} onChange={set('phone')} className={invalid('phone')} required />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="password">{t('register.password')}</Label>
                <Input id="password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} className={invalid('password')} required />
                <span className="text-xs text-muted-foreground">{t('register.passwordHint')}</span>
              </div>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <Label htmlFor="tmc">{t('register.tmc')}</Label>
                <Input id="tmc" value={form.tmcRegistrationNumber} onChange={set('tmcRegistrationNumber')} className={invalid('tmcRegistrationNumber')} required />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="specialty">{t('register.specialty')}</Label>
                <Select id="specialty" value={form.specialty} onChange={set('specialty')} className={invalid('specialty')}>
                  {doctorSpecialtySchema.options.map((value) => (
                    <option key={value} value={value}>
                      {t(`specialty.${value}` as TranslationKey)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="subSpecialty">{t('register.subSpecialty')}</Label>
                <Input id="subSpecialty" value={form.subSpecialty} onChange={set('subSpecialty')} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="years">{t('register.years')}</Label>
                <Input id="years" type="number" min={0} max={70} inputMode="numeric" value={form.yearsOfExperience} onChange={set('yearsOfExperience')} className={invalid('yearsOfExperience')} required />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="fee">{t('register.fee')}</Label>
                <Input id="fee" type="number" min={5000} max={500000} step={1} inputMode="numeric" value={form.consultationFeeTzs} onChange={set('consultationFeeTzs')} className={invalid('consultationFeeTzs')} required />
                <span className="text-xs text-muted-foreground">{t('register.feeHint')}</span>
              </div>
              <div className="flex flex-col gap-1 sm:col-span-2">
                <Label htmlFor="language">{t('register.language')}</Label>
                <Select id="language" value={form.language} onChange={set('language')}>
                  <option value="sw">Kiswahili</option>
                  <option value="en">English</option>
                </Select>
              </div>
              {error !== null && (
                <p role="alert" className="text-xs text-destructive sm:col-span-2">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={busy} className="sm:col-span-2">
                {busy ? t('register.submitting') : t('register.submit')}
              </Button>
              <Link href="/login" className="text-center text-xs text-muted-foreground underline sm:col-span-2">
                {t('register.haveAccount')}
              </Link>
            </form>
          ) : (
            <form onSubmit={(event) => void confirm(event)} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="code">{t('register.otpCode')}</Label>
                <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => { setCode(event.target.value); }} required />
              </div>
              {notice !== null && <p className="text-xs text-muted-foreground">{notice}</p>}
              {error !== null && (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={busy || !/^\d{6}$/.test(code.trim())}>
                {t('register.otpSubmit')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void resend()}>
                {t('register.otpResend')}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
