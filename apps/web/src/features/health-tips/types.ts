import type { HealthTipCategory, HealthTipStatus, TipSource } from '@daktari/schemas';

/** GET /api/v1/admin/health-tips/:id */
export interface AdminTip {
  id: string;
  slug: string;
  category: HealthTipCategory;
  status: HealthTipStatus;
  titleSw: string;
  titleEn: string;
  summarySw: string;
  summaryEn: string;
  bodySw: string;
  bodyEn: string;
  takeawaysSw: string[];
  takeawaysEn: string[];
  illustration: string;
  /** Short-lived signed preview URL of the uploaded image. */
  imageUrl: string | null;
  sources: TipSource[];
  priority: number;
  publishAt: string | null;
  unpublishAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** GET /api/v1/admin/health-tips row. */
export interface AdminTipRow {
  id: string;
  slug: string;
  category: HealthTipCategory;
  status: HealthTipStatus;
  titleSw: string;
  titleEn: string;
  priority: number;
  reviewedBy: string | null;
  updatedAt: string;
  illustration: string;
}

export const STATUS_TONE: Record<HealthTipStatus, 'neutral' | 'info' | 'success' | 'warning'> = {
  DRAFT: 'warning',
  REVIEWED: 'info',
  PUBLISHED: 'success',
  ARCHIVED: 'neutral',
};

/** Public path of a bundled illustration (apps/web/public/illustrations). */
export function illustrationSrc(key: string): string {
  return `/illustrations/${key}.svg`;
}
