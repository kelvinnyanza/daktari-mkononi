import type { FeeSettings } from '@daktari/db';
import {
  DEFAULT_FEE_RATES,
  bpsToPercent,
  calculateFees,
  percentToBps,
  type FeeBreakdown,
  type FeeRates,
} from '@daktari/payments';
import type { DoctorCommissionOverrideInput, UpdateFeeSettingsInput } from '@daktari/schemas';
import { ApiError, msg } from '../../lib/errors.js';
import type { AuditLogPort, DoctorRepoPort, FeeSettingsRepoPort } from '../../lib/ports.js';

/** Used until an admin saves the first FeeSettings row. */
export const DEFAULT_MIN_PAYOUT_TZS = 10_000;

/** Allow "effective now" requests that took a moment to arrive; anything older is back-dating. */
const BACKDATE_TOLERANCE_MS = 60_000;

export interface FeeSettingsView {
  /** null ⇒ built-in defaults (no admin row saved yet). */
  id: string | null;
  commissionPercent: number;
  commissionBps: number;
  vatEnabled: boolean;
  vatPercent: number;
  vatBps: number;
  vatMode: FeeRates['vatMode'];
  minPayoutTzs: number;
  effectiveFrom: Date | null;
  createdByUserId: string | null;
  note: string | null;
  createdAt: Date | null;
}

export interface EffectiveRates {
  rates: FeeRates;
  feeSettingsId: string | null;
  minPayoutTzs: number;
  /** True when a per-doctor commission override replaced the platform rate. */
  overridden: boolean;
}

export interface FeeSettingsServiceDeps {
  feeSettings: FeeSettingsRepoPort;
  doctors: DoctorRepoPort;
  auditLogs: AuditLogPort;
}

/**
 * Platform commission / VAT / payout-minimum settings. Effective-dated and
 * insert-only (see FeeSettings in schema.prisma); every change and every
 * per-doctor override is audited. Payments snapshot the rates they used, so
 * nothing here can alter history.
 */
export class FeeSettingsService {
  constructor(
    private readonly deps: FeeSettingsServiceDeps,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async current(): Promise<FeeSettingsView> {
    const row = await this.deps.feeSettings.findEffective(this.now());
    return row === null ? FeeSettingsService.defaultsView() : FeeSettingsService.toView(row);
  }

  /** Current row, upcoming (future-dated) rows and the past, newest first. */
  async overview(): Promise<{ current: FeeSettingsView; history: FeeSettingsView[] }> {
    const [current, history] = await Promise.all([this.current(), this.deps.feeSettings.listHistory(50)]);
    return { current, history: history.map((row) => FeeSettingsService.toView(row)) };
  }

  /** Rates for a new payment to this doctor right now (platform row + doctor override). */
  async ratesFor(doctorId: string | null): Promise<EffectiveRates> {
    const row = await this.deps.feeSettings.findEffective(this.now());
    const base: FeeRates =
      row === null
        ? DEFAULT_FEE_RATES
        : {
            commissionBps: row.commissionBps,
            vatEnabled: row.vatEnabled,
            vatBps: row.vatBps,
            vatMode: row.vatMode,
          };
    const doctor = doctorId === null ? null : await this.deps.doctors.findById(doctorId);
    const override = doctor?.commissionOverrideBps ?? null;
    return {
      rates: override === null ? base : { ...base, commissionBps: override },
      feeSettingsId: row?.id ?? null,
      minPayoutTzs: row?.minPayoutTzs ?? DEFAULT_MIN_PAYOUT_TZS,
      overridden: override !== null,
    };
  }

  async preview(feeTzs: number, doctorId: string | null): Promise<FeeBreakdown & { rates: FeeRates }> {
    const { rates } = await this.ratesFor(doctorId);
    return { ...calculateFees(feeTzs, rates), rates };
  }

  async update(adminUserId: string, input: UpdateFeeSettingsInput): Promise<FeeSettingsView> {
    const now = this.now();
    const effectiveFrom = input.effectiveFrom ?? now;
    if (effectiveFrom.getTime() < now.getTime() - BACKDATE_TOLERANCE_MS) {
      throw new ApiError(
        400,
        'FEE_SETTINGS_BACKDATED',
        msg(
          'Viwango vipya haviwezi kuanza tarehe iliyopita',
          'New rates cannot take effect in the past',
        ),
      );
    }
    const commissionBps = FeeSettingsService.bps(input.commissionPercent);
    const vatBps = FeeSettingsService.bps(input.vatPercent);
    const before = await this.current();
    const created = await this.deps.feeSettings.create({
      commissionBps,
      vatEnabled: input.vatEnabled,
      vatBps,
      vatMode: input.vatMode,
      minPayoutTzs: input.minPayoutTzs,
      effectiveFrom,
      createdByUserId: adminUserId,
      note: input.note,
    });
    await this.deps.auditLogs.append({
      actorUserId: adminUserId,
      action: 'FEE_SETTINGS_CHANGED',
      resourceType: 'FeeSettings',
      resourceId: created.id,
      ipAddress: null,
      userAgent: null,
      metadata: {
        before: {
          commissionBps: before.commissionBps,
          vatEnabled: before.vatEnabled,
          vatBps: before.vatBps,
          vatMode: before.vatMode,
          minPayoutTzs: before.minPayoutTzs,
        },
        after: { commissionBps, vatEnabled: input.vatEnabled, vatBps, vatMode: input.vatMode, minPayoutTzs: input.minPayoutTzs },
        effectiveFrom: effectiveFrom.toISOString(),
        note: input.note,
      },
    });
    return FeeSettingsService.toView(created);
  }

  async setDoctorOverride(
    adminUserId: string,
    doctorId: string,
    input: DoctorCommissionOverrideInput,
  ): Promise<{ doctorId: string; commissionOverridePercent: number | null }> {
    const doctor = await this.deps.doctors.findById(doctorId);
    if (!doctor) {
      throw new ApiError(404, 'DOCTOR_NOT_FOUND', msg('Daktari hajapatikana', 'Doctor not found'));
    }
    const nextBps = input.commissionPercent === null ? null : FeeSettingsService.bps(input.commissionPercent);
    await this.deps.doctors.update(doctor.id, { commissionOverrideBps: nextBps });
    await this.deps.auditLogs.append({
      actorUserId: adminUserId,
      action: 'FEE_OVERRIDE_CHANGED',
      resourceType: 'Doctor',
      resourceId: doctor.id,
      ipAddress: null,
      userAgent: null,
      metadata: { beforeBps: doctor.commissionOverrideBps, afterBps: nextBps, note: input.note },
    });
    return {
      doctorId: doctor.id,
      commissionOverridePercent: nextBps === null ? null : bpsToPercent(nextBps),
    };
  }

  private static bps(percent: number): number {
    const bps = percentToBps(percent);
    if (bps === null) {
      throw new ApiError(400, 'INVALID_RATE', msg('Kiwango si sahihi', 'Invalid rate'));
    }
    return bps;
  }

  private static toView(row: FeeSettings): FeeSettingsView {
    return {
      id: row.id,
      commissionPercent: bpsToPercent(row.commissionBps),
      commissionBps: row.commissionBps,
      vatEnabled: row.vatEnabled,
      vatPercent: bpsToPercent(row.vatBps),
      vatBps: row.vatBps,
      vatMode: row.vatMode,
      minPayoutTzs: row.minPayoutTzs,
      effectiveFrom: row.effectiveFrom,
      createdByUserId: row.createdByUserId,
      note: row.note,
      createdAt: row.createdAt,
    };
  }

  private static defaultsView(): FeeSettingsView {
    return {
      id: null,
      commissionPercent: bpsToPercent(DEFAULT_FEE_RATES.commissionBps),
      commissionBps: DEFAULT_FEE_RATES.commissionBps,
      vatEnabled: DEFAULT_FEE_RATES.vatEnabled,
      vatPercent: bpsToPercent(DEFAULT_FEE_RATES.vatBps),
      vatBps: DEFAULT_FEE_RATES.vatBps,
      vatMode: DEFAULT_FEE_RATES.vatMode,
      minPayoutTzs: DEFAULT_MIN_PAYOUT_TZS,
      effectiveFrom: null,
      createdByUserId: null,
      note: null,
      createdAt: null,
    };
  }
}
