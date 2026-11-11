'use client';

import { parseTipBody, type TipSource } from '@daktari/schemas';
import { useT, type TranslationKey } from '@/i18n';
import { Badge } from '@/components/ui/badge';
import { illustrationSrc } from './types';

export interface PreviewContent {
  category: string;
  title: string;
  summary: string;
  body: string;
  takeaways: string[];
  sources: TipSource[];
  illustration: string;
  imageUrl: string | null;
  reviewedBy: string | null;
  draft: boolean;
}

/**
 * How the tip looks in the patient app: the Home carousel card and the tip
 * page. Rendered from the same tiny article format (parseTipBody) the app
 * uses, so what the editor sees is what patients get.
 */
export function TipPreview({ content }: { content: PreviewContent }) {
  const t = useT();
  const blocks = parseTipBody(content.body);
  const art = content.imageUrl ?? illustrationSrc(content.illustration);
  const categoryLabel = t(`tips.category.${content.category}` as TranslationKey);

  return (
    <div className="flex flex-col gap-6">
      <section aria-label={t('tips.preview.card')}>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('tips.preview.card')}</p>
        <div className="w-[300px] overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
          <div className="flex h-36 items-center justify-center bg-[#E3F3F0]">
            <img src={art} alt="" className="h-32 w-auto object-contain" />
          </div>
          <div className="flex flex-col gap-1.5 p-4">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-[#E3F3F0] px-2 py-0.5 text-xs font-semibold text-[#0B5E54]">{categoryLabel}</span>
              {content.draft ? <Badge tone="warning">RASIMU</Badge> : null}
            </div>
            <p className="text-base font-bold leading-snug text-[#17201E]">{content.title || '—'}</p>
            <p className="line-clamp-1 text-sm text-[#4E5B58]">{content.summary}</p>
            <p className="pt-1 text-sm font-semibold text-[#0F7366]">{t('tips.preview.readMore')} →</p>
          </div>
        </div>
      </section>

      <section aria-label={t('tips.preview.detail')}>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('tips.preview.detail')}</p>
        <div className="w-[360px] overflow-hidden rounded-2xl border border-border bg-[#F6F9F8] shadow-sm">
          <div className="flex h-48 items-center justify-center bg-[#E3F3F0]">
            <img src={art} alt="" className="h-44 w-auto object-contain" />
          </div>
          <div className="flex flex-col gap-3 p-4 text-[#17201E]">
            <span className="w-fit rounded-full bg-[#E3F3F0] px-2 py-0.5 text-xs font-semibold text-[#0B5E54]">{categoryLabel}</span>
            <h3 className="text-xl font-bold leading-tight">{content.title || '—'}</h3>
            <p className="text-sm text-[#4E5B58]">
              {content.reviewedBy !== null ? `✓ ${t('tips.reviewedBy', { name: content.reviewedBy })}` : t('tips.notReviewed')}
            </p>
            {blocks.map((block, index) =>
              block.type === 'heading' ? (
                <h4 key={index} className="pt-1 text-base font-semibold">
                  {block.text}
                </h4>
              ) : block.type === 'paragraph' ? (
                <p key={index} className="text-sm leading-relaxed">
                  {block.text}
                </p>
              ) : (
                <ul key={index} className="ml-5 list-disc text-sm leading-relaxed">
                  {block.items.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              ),
            )}
            {content.takeaways.length > 0 ? (
              <div className="rounded-xl border border-[#8FD9C6] bg-[#E3F3F0] p-3">
                <p className="mb-1 text-sm font-semibold">{t('tips.preview.takeaways')}</p>
                <ul className="ml-5 list-disc text-sm">
                  {content.takeaways.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {content.sources.length > 0 ? (
              <div className="text-xs text-[#4E5B58]">
                <p className="font-semibold">{t('tips.preview.sources')}</p>
                {content.sources.map((source, i) => (
                  <p key={i}>
                    <a href={source.url} target="_blank" rel="noreferrer" className="underline">
                      {source.name}
                    </a>
                  </p>
                ))}
              </div>
            ) : null}
            <div className="rounded-lg bg-[#E3F3F0] px-3 py-2 text-center text-sm font-bold text-[#0B5E54]">
              {t('tips.preview.screening')}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
