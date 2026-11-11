/**
 * Health tips (UI Phase 3) — public health-education content, never PHI.
 *
 * Lifecycle: DRAFT → REVIEWED → PUBLISHED → ARCHIVED (ARCHIVED → DRAFT to
 * restore). Rules:
 *  - Review needs `content:review` AND, for a DOCTOR, an APPROVED
 *    verification (the role grant alone is not enough).
 *  - Publish needs `content:manage` and a REVIEWED tip — nothing unreviewed
 *    ever reaches patients.
 *  - Editing the CONTENT (text, takeaways, sources, category) of a REVIEWED
 *    or PUBLISHED tip sends it back to DRAFT: it leaves the app until it is
 *    reviewed and published again. Priority / publish window edits don't.
 *  - Every change is written to AuditLog with its from/to status.
 *  - Patients see PUBLISHED tips inside their publishAt/unpublishAt window;
 *    outside production a dev build may ask for drafts (`preview=drafts`),
 *    which the app badges "RASIMU".
 */
import { createHash, randomBytes } from 'node:crypto';
import type { HealthTipStatus, Prisma } from '@daktari/db';
import type {
  CreateHealthTipInput,
  ListAdminTipsQuery,
  ListPublicTipsQuery,
  PublicHealthTip,
  TipSource,
  UpdateHealthTipInput,
} from '@daktari/schemas';
import { HEALTH_TIP_CONTENT_FIELDS } from '@daktari/schemas';
import {
  assertMagicBytes,
  UPLOAD_SNIFF_BYTES,
  UploadValidationError,
  validateUploadDeclaration,
  type StoragePort,
} from '@daktari/storage';
import { ApiError, msg } from '../../lib/errors.js';
import type { AuditLogPort, DoctorRepoPort, HealthTipRepoPort, HealthTipRow } from '../../lib/ports.js';

export const TIP_IMAGE_MAX_BYTES = 1024 * 1024; // 1 MB — shown on budget phones
const TIP_IMAGE_UPLOAD_TTL_SECONDS = 600;

const NOT_FOUND = (): ApiError =>
  new ApiError(404, 'HEALTH_TIP_NOT_FOUND', msg('Kidokezo hakijapatikana', 'Health tip not found'));

const badState = (sw: string, en: string): ApiError => new ApiError(409, 'HEALTH_TIP_STATE', msg(sw, en));

export interface HealthTipServiceDeps {
  tips: HealthTipRepoPort;
  doctors: Pick<DoctorRepoPort, 'findByUserId'>;
  auditLogs: AuditLogPort;
  storage: StoragePort;
}

export interface HealthTipSettings {
  /** True outside production: `preview=drafts` may show DRAFT/REVIEWED tips. */
  allowDraftPreview: boolean;
}

export interface Actor {
  userId: string;
  role: string;
}

/** The admin/editor view: everything, plus a short-lived preview URL for the image. */
export interface AdminHealthTip {
  id: string;
  slug: string;
  category: string;
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

function iso(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

function sourcesOf(row: HealthTipRow): TipSource[] {
  return Array.isArray(row.sources) ? (row.sources as unknown as TipSource[]) : [];
}

/** Stable, cache-friendly image path: the version changes only when the image does. */
export function tipImagePath(row: { id: string; imageKey: string | null }): string | null {
  if (row.imageKey === null) return null;
  const version = createHash('sha256').update(row.imageKey).digest('hex').slice(0, 12);
  return `/api/v1/health-tips/${row.id}/image?v=${version}`;
}

export function toPublicTip(row: HealthTipRow): PublicHealthTip {
  return {
    id: row.id,
    slug: row.slug,
    category: row.category,
    status: row.status,
    title: { sw: row.titleSw, en: row.titleEn },
    summary: { sw: row.summarySw, en: row.summaryEn },
    body: { sw: row.bodySw, en: row.bodyEn },
    takeaways: { sw: row.takeawaysSw, en: row.takeawaysEn },
    illustration: row.illustration,
    imageUrl: tipImagePath(row),
    sources: sourcesOf(row),
    reviewedBy: row.reviewedBy?.fullName ?? null,
    reviewedAt: iso(row.reviewedAt),
    publishedAt: iso(row.publishedAt),
    priority: row.priority,
  };
}

export class HealthTipService {
  constructor(
    private readonly deps: HealthTipServiceDeps,
    private readonly settings: HealthTipSettings,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // ── Patient app (public) ──────────────────────────────────────────────────

  private previewAllowed(preview: 'drafts' | undefined): boolean {
    return preview === 'drafts' && this.settings.allowDraftPreview;
  }

  async listPublic(query: ListPublicTipsQuery): Promise<{
    items: PublicHealthTip[];
    page: number;
    pageSize: number;
    total: number;
  }> {
    const preview = this.previewAllowed(query.preview);
    const { items, total } = await this.deps.tips.listPublic({
      now: this.now(),
      statuses: preview ? ['DRAFT', 'REVIEWED', 'PUBLISHED'] : ['PUBLISHED'],
      window: !preview,
      ...(query.category !== undefined ? { category: query.category } : {}),
      ...(query.q !== undefined ? { q: query.q } : {}),
      page: query.page,
      pageSize: query.pageSize,
    });
    return { items: items.map(toPublicTip), page: query.page, pageSize: query.pageSize, total };
  }

  /** Visible to patients right now (or, in dev preview, any non-archived tip). */
  private visible(row: HealthTipRow, preview: boolean): boolean {
    if (preview) return row.status !== 'ARCHIVED';
    const now = this.now().getTime();
    return (
      row.status === 'PUBLISHED' &&
      (row.publishAt === null || row.publishAt.getTime() <= now) &&
      (row.unpublishAt === null || row.unpublishAt.getTime() > now)
    );
  }

  async getPublic(slug: string, preview: 'drafts' | undefined): Promise<PublicHealthTip> {
    const row = await this.deps.tips.findBySlug(slug);
    if (row === null || !this.visible(row, this.previewAllowed(preview))) throw NOT_FOUND();
    return toPublicTip(row);
  }

  /** The image of a visible tip (dev: any non-archived), for the public image route. */
  async publicImage(id: string): Promise<{ key: string }> {
    const row = await this.deps.tips.findById(id);
    if (row === null || row.imageKey === null || !this.visible(row, this.settings.allowDraftPreview)) {
      throw NOT_FOUND();
    }
    return { key: row.imageKey };
  }

  // ── Admin / reviewer ──────────────────────────────────────────────────────

  private async toAdmin(row: HealthTipRow): Promise<AdminHealthTip> {
    return {
      id: row.id,
      slug: row.slug,
      category: row.category,
      status: row.status,
      titleSw: row.titleSw,
      titleEn: row.titleEn,
      summarySw: row.summarySw,
      summaryEn: row.summaryEn,
      bodySw: row.bodySw,
      bodyEn: row.bodyEn,
      takeawaysSw: row.takeawaysSw,
      takeawaysEn: row.takeawaysEn,
      illustration: row.illustration,
      imageUrl: row.imageKey === null ? null : await this.deps.storage.getSignedUrl(row.imageKey, 900),
      sources: sourcesOf(row),
      priority: row.priority,
      publishAt: iso(row.publishAt),
      unpublishAt: iso(row.unpublishAt),
      reviewedBy: row.reviewedBy?.fullName ?? null,
      reviewedAt: iso(row.reviewedAt),
      publishedAt: iso(row.publishedAt),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async mustGet(id: string): Promise<HealthTipRow> {
    const row = await this.deps.tips.findById(id);
    if (row === null) throw NOT_FOUND();
    return row;
  }

  private async audit(
    actor: Actor,
    action: string,
    tipId: string,
    metadata: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.deps.auditLogs.append({
      actorUserId: actor.userId,
      action,
      resourceType: 'HealthTip',
      resourceId: tipId,
      ipAddress: null,
      userAgent: null,
      metadata,
    });
  }

  async listAdmin(query: ListAdminTipsQuery): Promise<{
    items: Array<Pick<AdminHealthTip, 'id' | 'slug' | 'category' | 'status' | 'titleSw' | 'titleEn' | 'priority' | 'reviewedBy' | 'updatedAt' | 'illustration'>>;
    page: number;
    pageSize: number;
    total: number;
  }> {
    const { items, total } = await this.deps.tips.listAdmin({
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.category !== undefined ? { category: query.category } : {}),
      ...(query.q !== undefined ? { q: query.q } : {}),
      page: query.page,
      pageSize: query.pageSize,
    });
    return {
      items: items.map((row) => ({
        id: row.id,
        slug: row.slug,
        category: row.category,
        status: row.status,
        titleSw: row.titleSw,
        titleEn: row.titleEn,
        priority: row.priority,
        reviewedBy: row.reviewedBy?.fullName ?? null,
        updatedAt: row.updatedAt.toISOString(),
        illustration: row.illustration,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async getAdmin(id: string): Promise<AdminHealthTip> {
    return this.toAdmin(await this.mustGet(id));
  }

  private async assertSlugFree(slug: string, exceptId: string | null): Promise<void> {
    const existing = await this.deps.tips.findBySlug(slug);
    if (existing !== null && existing.id !== exceptId) {
      throw new ApiError(409, 'HEALTH_TIP_SLUG_TAKEN', msg('Slug hii tayari inatumika', 'This slug is already in use'));
    }
  }

  async create(actor: Actor, input: CreateHealthTipInput): Promise<AdminHealthTip> {
    await this.assertSlugFree(input.slug, null);
    const row = await this.deps.tips.create({
      ...input,
      sources: input.sources as unknown as Prisma.InputJsonValue,
      status: 'DRAFT',
      createdByUserId: actor.userId,
    });
    await this.audit(actor, 'HEALTH_TIP_CREATED', row.id, { slug: row.slug, status: 'DRAFT' });
    return this.toAdmin(row);
  }

  async update(actor: Actor, id: string, input: UpdateHealthTipInput): Promise<AdminHealthTip> {
    const row = await this.mustGet(id);
    if (input.slug !== undefined && input.slug !== row.slug) await this.assertSlugFree(input.slug, id);

    const changed = (Object.keys(input) as Array<keyof UpdateHealthTipInput>).filter((field) => {
      const next: unknown = field === 'sources' ? input.sources : input[field];
      const current: unknown = field === 'sources' ? sourcesOf(row) : row[field as keyof HealthTipRow];
      return JSON.stringify(next) !== JSON.stringify(current);
    });
    const contentChanged = changed.some((field) => (HEALTH_TIP_CONTENT_FIELDS as readonly string[]).includes(field));
    const backToDraft = contentChanged && (row.status === 'REVIEWED' || row.status === 'PUBLISHED');

    const { sources, ...rest } = input;
    // exactOptionalPropertyTypes: drop absent keys rather than send undefined.
    const present = Object.fromEntries(
      Object.entries(rest).filter(([, value]) => value !== undefined),
    ) as Prisma.HealthTipUncheckedUpdateInput;
    const updated = await this.deps.tips.update(id, {
      ...present,
      ...(sources !== undefined ? { sources: sources as unknown as Prisma.InputJsonValue } : {}),
      ...(backToDraft
        ? { status: 'DRAFT', reviewedByUserId: null, reviewedAt: null, publishedAt: null }
        : {}),
    });
    await this.audit(actor, 'HEALTH_TIP_UPDATED', id, {
      changedFields: changed,
      from: row.status,
      to: updated.status,
      ...(backToDraft ? { reason: 'content changed — needs review again' } : {}),
    });
    return this.toAdmin(updated);
  }

  private async move(
    actor: Actor,
    id: string,
    from: HealthTipStatus[],
    data: Prisma.HealthTipUncheckedUpdateInput & { status: HealthTipStatus },
    action: string,
    refuse: ApiError,
  ): Promise<AdminHealthTip> {
    const before = await this.mustGet(id);
    if (!from.includes(before.status)) throw refuse;
    const after = await this.deps.tips.transition(id, from, data);
    if (after === null) throw refuse; // lost a race with another editor
    await this.audit(actor, action, id, { from: before.status, to: data.status });
    return this.toAdmin(after);
  }

  /** DRAFT → REVIEWED. A doctor reviewer must be verified (APPROVED). */
  async review(actor: Actor, id: string): Promise<AdminHealthTip> {
    if (actor.role === 'DOCTOR') {
      const doctor = await this.deps.doctors.findByUserId(actor.userId);
      if (doctor?.verificationStatus !== 'APPROVED') {
        throw new ApiError(
          403,
          'REVIEWER_NOT_VERIFIED',
          msg(
            'Ni daktari aliyethibitishwa tu anayeweza kuhakiki vidokezo',
            'Only a verified doctor can review health tips',
          ),
        );
      }
    }
    return this.move(
      actor,
      id,
      ['DRAFT'],
      { status: 'REVIEWED', reviewedByUserId: actor.userId, reviewedAt: this.now() },
      'HEALTH_TIP_REVIEWED',
      badState('Ni rasimu tu inayoweza kuhakikiwa', 'Only a draft can be reviewed'),
    );
  }

  /** REVIEWED → PUBLISHED. */
  async publish(actor: Actor, id: string): Promise<AdminHealthTip> {
    return this.move(
      actor,
      id,
      ['REVIEWED'],
      { status: 'PUBLISHED', publishedAt: this.now() },
      'HEALTH_TIP_PUBLISHED',
      badState('Kidokezo kihakikiwe kwanza kabla ya kuchapishwa', 'A tip must be reviewed before it is published'),
    );
  }

  async archive(actor: Actor, id: string): Promise<AdminHealthTip> {
    return this.move(
      actor,
      id,
      ['DRAFT', 'REVIEWED', 'PUBLISHED'],
      { status: 'ARCHIVED' },
      'HEALTH_TIP_ARCHIVED',
      badState('Kidokezo tayari kimehifadhiwa kwenye kumbukumbu', 'The tip is already archived'),
    );
  }

  /** ARCHIVED → DRAFT (must be reviewed again). */
  async restore(actor: Actor, id: string): Promise<AdminHealthTip> {
    return this.move(
      actor,
      id,
      ['ARCHIVED'],
      { status: 'DRAFT', reviewedByUserId: null, reviewedAt: null, publishedAt: null },
      'HEALTH_TIP_RESTORED',
      badState('Ni kidokezo kilichohifadhiwa tu kinachoweza kurudishwa', 'Only an archived tip can be restored'),
    );
  }

  // ── Image upload (existing storage: presigned direct upload) ─────────────

  private static validateImage(fileName: string, contentType: string, size: number): { extension: string; contentType: string; kind: 'jpg' | 'png' | 'webp' } {
    let validated;
    try {
      validated = validateUploadDeclaration({ fileName, mimeType: contentType, size });
    } catch (error) {
      if (error instanceof UploadValidationError) throw uploadRejected(error.code);
      throw error;
    }
    if (validated.kind === 'pdf') throw uploadRejected('UNSUPPORTED_TYPE');
    if (size > TIP_IMAGE_MAX_BYTES) throw uploadRejected('FILE_TOO_LARGE');
    return { extension: validated.extension, contentType: validated.contentType, kind: validated.kind };
  }

  async createImageUpload(
    _actor: Actor,
    id: string,
    input: { fileName: string; contentType: string; size: number },
  ): Promise<{ key: string; url: string; method: 'POST'; fields: Record<string, string>; contentType: string; maxBytes: number; expiresAt: Date }> {
    await this.mustGet(id);
    const validated = HealthTipService.validateImage(input.fileName, input.contentType, input.size);
    const key = `health-tips/${id}/${randomBytes(8).toString('hex')}.${validated.extension}`;
    const upload = await this.deps.storage.createPresignedUpload({
      key,
      contentType: validated.contentType,
      maxBytes: TIP_IMAGE_MAX_BYTES,
      ttlSeconds: TIP_IMAGE_UPLOAD_TTL_SECONDS,
    });
    return { key, ...upload };
  }

  /** Nothing the client says is trusted: key prefix, size, type and magic bytes are re-checked. */
  async completeImageUpload(actor: Actor, id: string, input: { key: string; fileName: string }): Promise<AdminHealthTip> {
    const row = await this.mustGet(id);
    const prefix = `health-tips/${id}/`;
    if (!input.key.startsWith(prefix) || !/^[a-f0-9]{16}\.(jpg|png|webp)$/.test(input.key.slice(prefix.length))) {
      throw new ApiError(400, 'UPLOAD_KEY_INVALID', msg('Upakiaji huu si sahihi', 'This upload is not valid'));
    }
    const stored = await this.deps.storage.stat(input.key);
    if (stored === null) {
      throw new ApiError(409, 'UPLOAD_NOT_FOUND', msg('Picha haijafika bado — pakia tena', 'The image has not arrived — upload it again'));
    }
    try {
      const validated = HealthTipService.validateImage(input.fileName, stored.contentType ?? '', stored.size);
      if (!input.key.endsWith(`.${validated.extension}`)) throw uploadRejected('CONTENT_MISMATCH');
      try {
        assertMagicBytes(validated.kind, await this.deps.storage.readHead(input.key, UPLOAD_SNIFF_BYTES));
      } catch (error) {
        if (error instanceof UploadValidationError) throw uploadRejected(error.code);
        throw error;
      }
    } catch (error) {
      await this.deps.storage.delete(input.key).catch(() => undefined);
      throw error;
    }
    const updated = await this.deps.tips.update(id, { imageKey: input.key });
    if (row.imageKey !== null && row.imageKey !== input.key) {
      await this.deps.storage.delete(row.imageKey).catch(() => undefined);
    }
    await this.audit(actor, 'HEALTH_TIP_IMAGE_SET', id, { status: row.status });
    return this.toAdmin(updated);
  }

  async removeImage(actor: Actor, id: string): Promise<AdminHealthTip> {
    const row = await this.mustGet(id);
    if (row.imageKey === null) return this.toAdmin(row);
    const updated = await this.deps.tips.update(id, { imageKey: null });
    await this.deps.storage.delete(row.imageKey).catch(() => undefined);
    await this.audit(actor, 'HEALTH_TIP_IMAGE_REMOVED', id, { status: row.status });
    return this.toAdmin(updated);
  }
}

function uploadRejected(code: string): ApiError {
  const messages: Record<string, [string, string]> = {
    FILE_TOO_LARGE: ['Picha ni kubwa mno (kikomo ni MB 1)', 'The image is too large (1 MB limit)'],
    EMPTY_FILE: ['Picha ni tupu', 'The image is empty'],
    UNSUPPORTED_TYPE: ['Tumia picha ya JPG, PNG au WebP', 'Use a JPG, PNG or WebP image'],
    DOUBLE_EXTENSION: ['Jina la faili si sahihi', 'The file name is not valid'],
    CONTENT_MISMATCH: ['Faili si picha inayodaiwa', 'The file is not the image it claims to be'],
  };
  const [sw, en] = messages[code] ?? ['Picha imekataliwa', 'The image was rejected'];
  return new ApiError(400, `UPLOAD_${code}`, msg(sw, en));
}
