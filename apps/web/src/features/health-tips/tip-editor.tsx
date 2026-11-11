'use client';

import {
  CATEGORY_ILLUSTRATION,
  createHealthTipSchema,
  HEALTH_TIP_ILLUSTRATIONS,
  healthTipCategorySchema,
  type HealthTipCategory,
  type TipSource,
} from '@daktari/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { PageHeader } from '@/components/portal-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { pickBilingual, useI18nStore, useT, type TranslationKey } from '@/i18n';
import { ApiError, api } from '@/lib/api';
import { uploadToPresignedTarget, type PresignedUploadTarget } from '@/lib/upload';
import { TipPreview } from './tip-preview';
import { STATUS_TONE, type AdminTip } from './types';

type Lang = 'sw' | 'en';

interface FormState {
  slug: string;
  category: HealthTipCategory;
  illustration: string;
  priority: string;
  publishAt: string; // datetime-local
  unpublishAt: string;
  title: Record<Lang, string>;
  summary: Record<Lang, string>;
  body: Record<Lang, string>;
  takeaways: Record<Lang, string>; // one per line
  sources: string; // "Name | https://…" per line
}

const EMPTY: FormState = {
  slug: '',
  category: 'NUTRITION',
  illustration: CATEGORY_ILLUSTRATION.NUTRITION,
  priority: '0',
  publishAt: '',
  unpublishAt: '',
  title: { sw: '', en: '' },
  summary: { sw: '', en: '' },
  body: { sw: '', en: '' },
  takeaways: { sw: '', en: '' },
  sources: '',
};

function toLocalInput(iso: string | null): string {
  if (iso === null) return '';
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | null {
  return value === '' ? null : new Date(value).toISOString();
}

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseSources(text: string): TipSource[] {
  return lines(text).map((line) => {
    const [name = '', url = ''] = line.split('|').map((part) => part.trim());
    return { name, url };
  });
}

function formOf(tip: AdminTip): FormState {
  return {
    slug: tip.slug,
    category: tip.category,
    illustration: tip.illustration,
    priority: String(tip.priority),
    publishAt: toLocalInput(tip.publishAt),
    unpublishAt: toLocalInput(tip.unpublishAt),
    title: { sw: tip.titleSw, en: tip.titleEn },
    summary: { sw: tip.summarySw, en: tip.summaryEn },
    body: { sw: tip.bodySw, en: tip.bodyEn },
    takeaways: { sw: tip.takeawaysSw.join('\n'), en: tip.takeawaysEn.join('\n') },
    sources: tip.sources.map((source) => `${source.name} | ${source.url}`).join('\n'),
  };
}

function payloadOf(form: FormState) {
  return {
    slug: form.slug.trim(),
    category: form.category,
    illustration: form.illustration,
    priority: Number.parseInt(form.priority, 10) || 0,
    publishAt: fromLocalInput(form.publishAt),
    unpublishAt: fromLocalInput(form.unpublishAt),
    titleSw: form.title.sw,
    titleEn: form.title.en,
    summarySw: form.summary.sw,
    summaryEn: form.summary.en,
    bodySw: form.body.sw,
    bodyEn: form.body.en,
    takeawaysSw: lines(form.takeaways.sw),
    takeawaysEn: lines(form.takeaways.en),
    sources: parseSources(form.sources),
  };
}

/**
 * Create / edit a tip (admin, `content:manage`). Swahili and English side by
 * side, a live preview as the app shows it, and the lifecycle actions the
 * server allows from the current status. Every action is audited server-side.
 */
export function TipEditor({ id, basePath }: { id: string | null; basePath: string }) {
  const t = useT();
  const locale = useI18nStore((state) => state.locale);
  const router = useRouter();
  const queryClient = useQueryClient();
  const isNew = id === null;
  const [form, setForm] = useState<FormState>(EMPTY);
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [previewLang, setPreviewLang] = useState<Lang>('sw');

  const tip = useQuery({
    queryKey: ['admin-health-tip', id],
    queryFn: () => api.get<AdminTip>(`/api/v1/admin/health-tips/${id ?? ''}`),
    enabled: !isNew,
  });

  useEffect(() => {
    if (tip.data !== undefined) setForm(formOf(tip.data));
  }, [tip.data]);

  const errorText = (error: unknown): string =>
    error instanceof ApiError ? (pickBilingual(error.userMessage, locale) ?? error.code) : t('common.error');

  const afterChange = async (saved: AdminTip, message: string): Promise<void> => {
    queryClient.setQueryData(['admin-health-tip', saved.id], saved);
    await queryClient.invalidateQueries({ queryKey: ['admin-health-tips'] });
    setNotice(message);
    if (isNew) router.replace(`${basePath}/${saved.id}`);
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = payloadOf(form);
      const parsed = createHealthTipSchema.safeParse(payload);
      if (!parsed.success) {
        setInvalid(new Set(parsed.error.issues.map((issue) => String(issue.path[0]))));
        throw new Error(t('tips.validation'));
      }
      setInvalid(new Set());
      return isNew
        ? api.post<AdminTip>('/api/v1/admin/health-tips', payload)
        : api.patch<AdminTip>(`/api/v1/admin/health-tips/${id}`, payload);
    },
    onSuccess: (saved) => afterChange(saved, t('tips.saved')),
  });

  const action = useMutation({
    mutationFn: (name: 'review' | 'publish' | 'archive' | 'restore') =>
      api.post<AdminTip>(`/api/v1/admin/health-tips/${id ?? ''}/${name}`),
    onSuccess: (saved) => afterChange(saved, t(`tips.status.${saved.status}` as TranslationKey)),
  });

  const image = useMutation({
    mutationFn: async (file: File | null) => {
      if (id === null) throw new Error('save first');
      if (file === null) return api.delete<AdminTip>(`/api/v1/admin/health-tips/${id}/image`);
      const target = await api.post<PresignedUploadTarget>(`/api/v1/admin/health-tips/${id}/image/upload-url`, {
        fileName: file.name,
        contentType: file.type,
        size: file.size,
      });
      await uploadToPresignedTarget(target, file, file.name);
      return api.post<AdminTip>(`/api/v1/admin/health-tips/${id}/image/complete`, { key: target.key, fileName: file.name });
    },
    onSuccess: (saved) => afterChange(saved, t('tips.saved')),
  });

  if (!isNew && tip.isPending) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  if (!isNew && tip.isError) return <p className="text-sm text-destructive">{errorText(tip.error)}</p>;

  const current = tip.data;
  const status = current?.status ?? 'DRAFT';
  const busy = save.isPending || action.isPending || image.isPending;
  const error = save.error ?? action.error ?? image.error;
  const bad = (field: string): string => (invalid.has(field) ? 'border-destructive' : '');
  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void => setForm((f) => ({ ...f, [key]: value }));
  const setLang = (key: 'title' | 'summary' | 'body' | 'takeaways', lang: Lang, value: string): void =>
    setForm((f) => ({ ...f, [key]: { ...f[key], [lang]: value } }));

  const bilingual = (
    key: 'title' | 'summary' | 'body' | 'takeaways',
    label: TranslationKey,
    fieldSw: string,
    fieldEn: string,
    rows?: number,
    hint?: ReactNode,
  ) => (
    <div className="grid gap-3 md:grid-cols-2">
      {(['sw', 'en'] as const).map((lang) => {
        const field = lang === 'sw' ? fieldSw : fieldEn;
        const inputId = `${key}-${lang}`;
        return (
          <div key={lang} className="flex flex-col gap-1">
            <Label htmlFor={inputId}>
              {t(label)} · {t(`tips.lang.${lang}`)}
            </Label>
            {rows === undefined ? (
              <Input id={inputId} className={bad(field)} value={form[key][lang]} onChange={(e) => setLang(key, lang, e.target.value)} />
            ) : (
              <Textarea
                id={inputId}
                rows={rows}
                className={`font-mono text-xs ${bad(field)}`}
                value={form[key][lang]}
                onChange={(e) => setLang(key, lang, e.target.value)}
              />
            )}
            {hint !== undefined && lang === 'sw' ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      <div className="mb-2">
        <Link href={basePath} className="text-sm underline">
          ← {t('tips.editor.back')}
        </Link>
      </div>
      <PageHeader title={isNew ? t('tips.editor.newTitle') : t('tips.editor.editTitle')} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Badge tone={STATUS_TONE[status]}>{t(`tips.status.${status}` as TranslationKey)}</Badge>
        <span className="text-sm text-muted-foreground">
          {current?.reviewedBy != null ? t('tips.reviewedBy', { name: current.reviewedBy }) : t('tips.notReviewed')}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button onClick={() => save.mutate()} disabled={busy}>
            {isNew ? t('tips.action.create') : t('tips.action.save')}
          </Button>
          {!isNew && status === 'DRAFT' ? (
            <Button variant="secondary" onClick={() => action.mutate('review')} disabled={busy}>
              {t('tips.action.review')}
            </Button>
          ) : null}
          {!isNew && status === 'REVIEWED' ? (
            <Button variant="secondary" onClick={() => action.mutate('publish')} disabled={busy}>
              {t('tips.action.publish')}
            </Button>
          ) : null}
          {!isNew && status !== 'ARCHIVED' ? (
            <Button variant="outline" onClick={() => action.mutate('archive')} disabled={busy}>
              {t('tips.action.archive')}
            </Button>
          ) : null}
          {!isNew && status === 'ARCHIVED' ? (
            <Button variant="outline" onClick={() => action.mutate('restore')} disabled={busy}>
              {t('tips.action.restore')}
            </Button>
          ) : null}
        </div>
      </div>

      <p className="mb-1 text-xs text-muted-foreground">{t('tips.reviewRule')}</p>
      {status === 'REVIEWED' || status === 'PUBLISHED' ? (
        <p className="mb-3 text-xs text-amber-700">{t('tips.contentResetNote')}</p>
      ) : null}
      {notice !== null && error === null ? (
        <p role="status" className="mb-3 text-sm text-emerald-700">
          {notice}
        </p>
      ) : null}
      {error !== null ? (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error instanceof Error && !(error instanceof ApiError) ? error.message : errorText(error)}
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="slug">{t('tips.field.slug')}</Label>
                <Input id="slug" className={bad('slug')} value={form.slug} onChange={(e) => set('slug', e.target.value)} />
                <p className="text-xs text-muted-foreground">{t('tips.field.slugHint')}</p>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="category">{t('tips.field.category')}</Label>
                <Select
                  id="category"
                  value={form.category}
                  onChange={(e) => {
                    const category = e.target.value as HealthTipCategory;
                    setForm((f) => ({ ...f, category, illustration: isNew ? CATEGORY_ILLUSTRATION[category] : f.illustration }));
                  }}
                >
                  {healthTipCategorySchema.options.map((value) => (
                    <option key={value} value={value}>
                      {t(`tips.category.${value}` as TranslationKey)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="illustration">{t('tips.field.illustration')}</Label>
                <Select id="illustration" value={form.illustration} onChange={(e) => set('illustration', e.target.value)}>
                  {HEALTH_TIP_ILLUSTRATIONS.map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="priority">{t('tips.field.priority')}</Label>
                <Input id="priority" type="number" min={0} max={100} value={form.priority} onChange={(e) => set('priority', e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="publishAt">{t('tips.field.publishAt')}</Label>
                <Input id="publishAt" type="datetime-local" value={form.publishAt} onChange={(e) => set('publishAt', e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="unpublishAt">{t('tips.field.unpublishAt')}</Label>
                <Input
                  id="unpublishAt"
                  type="datetime-local"
                  className={bad('unpublishAt')}
                  value={form.unpublishAt}
                  onChange={(e) => set('unpublishAt', e.target.value)}
                />
              </div>
            </div>

            {bilingual('title', 'tips.field.title', 'titleSw', 'titleEn')}
            {bilingual('summary', 'tips.field.summary', 'summarySw', 'summaryEn', 2)}
            {bilingual('body', 'tips.field.body', 'bodySw', 'bodyEn', 16, t('tips.field.bodyHint'))}
            {bilingual('takeaways', 'tips.field.takeaways', 'takeawaysSw', 'takeawaysEn', 4)}

            <div className="flex flex-col gap-1">
              <Label htmlFor="sources">{t('tips.field.sources')}</Label>
              <Textarea
                id="sources"
                rows={3}
                className={`font-mono text-xs ${bad('sources')}`}
                value={form.sources}
                onChange={(e) => set('sources', e.target.value)}
              />
            </div>

            {!isNew ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="image">{t('tips.field.image')}</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id="image"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file !== undefined) image.mutate(file);
                      e.target.value = '';
                    }}
                    className="text-sm"
                  />
                  {current?.imageUrl != null ? (
                    <Button variant="ghost" size="sm" onClick={() => image.mutate(null)} disabled={busy}>
                      {t('tips.action.removeImage')}
                    </Button>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">{t('tips.field.imageHint')}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>{t('tips.preview')}</CardTitle>
            <div className="flex gap-1">
              {(['sw', 'en'] as const).map((lang) => (
                <Button key={lang} size="sm" variant={previewLang === lang ? 'default' : 'outline'} onClick={() => setPreviewLang(lang)}>
                  {lang.toUpperCase()}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            <TipPreview
              content={{
                category: form.category,
                title: form.title[previewLang],
                summary: form.summary[previewLang],
                body: form.body[previewLang],
                takeaways: lines(form.takeaways[previewLang]),
                sources: parseSources(form.sources).filter((source) => source.name !== ''),
                illustration: form.illustration,
                imageUrl: current?.imageUrl ?? null,
                reviewedBy: current?.reviewedBy ?? null,
                draft: status !== 'PUBLISHED',
              }}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

/**
 * Doctor's review view (`content:review`): read-only preview in both
 * languages and one action — mark reviewed. The server checks that the
 * doctor's verification is APPROVED.
 */
export function TipReview({ id, basePath }: { id: string; basePath: string }) {
  const t = useT();
  const locale = useI18nStore((state) => state.locale);
  const queryClient = useQueryClient();
  const tip = useQuery({
    queryKey: ['admin-health-tip', id],
    queryFn: () => api.get<AdminTip>(`/api/v1/admin/health-tips/${id}`),
  });
  const review = useMutation({
    mutationFn: () => api.post<AdminTip>(`/api/v1/admin/health-tips/${id}/review`),
    onSuccess: async (saved) => {
      queryClient.setQueryData(['admin-health-tip', id], saved);
      await queryClient.invalidateQueries({ queryKey: ['admin-health-tips'] });
    },
  });

  if (tip.isPending) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  if (tip.isError) return <p className="text-sm text-destructive">{t('common.error')}</p>;
  const data = tip.data;

  return (
    <>
      <div className="mb-2">
        <Link href={basePath} className="text-sm underline">
          ← {t('tips.editor.back')}
        </Link>
      </div>
      <PageHeader title={locale === 'sw' ? data.titleSw : data.titleEn} subtitle={t('tips.reviewRule')} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Badge tone={STATUS_TONE[data.status]}>{t(`tips.status.${data.status}` as TranslationKey)}</Badge>
        {data.status === 'DRAFT' ? (
          <Button onClick={() => review.mutate()} disabled={review.isPending}>
            {t('tips.action.review')}
          </Button>
        ) : null}
        {review.error !== null ? (
          <span role="alert" className="text-sm text-destructive">
            {review.error instanceof ApiError ? (pickBilingual(review.error.userMessage, locale) ?? review.error.code) : t('common.error')}
          </span>
        ) : null}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {(['sw', 'en'] as const).map((lang) => (
          <Card key={lang}>
            <CardHeader>
              <CardTitle>{t(`tips.lang.${lang}`)}</CardTitle>
            </CardHeader>
            <CardContent>
              <TipPreview
                content={{
                  category: data.category,
                  title: lang === 'sw' ? data.titleSw : data.titleEn,
                  summary: lang === 'sw' ? data.summarySw : data.summaryEn,
                  body: lang === 'sw' ? data.bodySw : data.bodyEn,
                  takeaways: lang === 'sw' ? data.takeawaysSw : data.takeawaysEn,
                  sources: data.sources,
                  illustration: data.illustration,
                  imageUrl: data.imageUrl,
                  reviewedBy: data.reviewedBy,
                  draft: data.status !== 'PUBLISHED',
                }}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
