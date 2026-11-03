// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { doctorDocumentFieldSchema, doctorSpecialtySchema } from '@daktari/schemas';
import { NOTE_FIELDS } from '../features/consultation/notes-autosave';
import { en, sw } from './translations';

/**
 * Every key the portal can ask for has BOTH a Swahili and an English string.
 *
 * Literal t('key') calls are type-checked already; the gap is keys BUILT at
 * runtime — t(`consultation.${field}` as TranslationKey) — where the cast
 * hides a typo (consultation.historyOfPresentIllness was missing because the
 * table said "historyOfPresentingIllness"). This test scans the source for
 * every t(`prefix.${...}`) family and checks each family's full value set,
 * taken from the real source of truth (Prisma enums, Zod enums, constants).
 * A NEW dynamic family fails here until its values are declared below.
 */
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = readFileSync(path.resolve(SRC, '../../../packages/db/prisma/schema.prisma'), 'utf8');

function prismaEnum(name: string): string[] {
  const match = new RegExp(`enum ${name} \\{([^}]*)\\}`).exec(SCHEMA);
  if (!match) throw new Error(`enum ${name} not found in schema.prisma`);
  return match[1]!
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => /^[A-Z][A-Z0-9_]*$/.test(line));
}

const FAMILIES: Record<string, readonly string[]> = {
  'consultation.': NOTE_FIELDS,
  'payments.review.reason.': prismaEnum('PaymentReviewReason'),
  'payouts.reason.': ['OK', 'NO_ACCOUNT', 'ACCOUNT_NOT_VERIFIED', 'BELOW_MINIMUM'],
  'payouts.runStatus.': prismaEnum('PayoutBatchStatus'),
  'reports.metric.': [
    'collectedTzs',
    'refundedTzs',
    'commissionTzs',
    'vatDueTzs',
    'azamPayFeesTzs',
    'doctorPayoutsTzs',
    'netPlatformRevenueTzs',
  ],
  'earnings.status.': prismaEnum('DoctorPaymentStatus'),
  'onboarding.doc.review.': prismaEnum('DocumentReviewStatus'),
  'onboarding.doc.': doctorDocumentFieldSchema.options,
  'onboarding.status.': prismaEnum('DoctorVerificationStatus'),
  'schedule.day.': ['0', '1', '2', '3', '4', '5', '6'],
  'specialty.': doctorSpecialtySchema.options,
  'payoutAccount.operator.': prismaEnum('PayoutOperator'),
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !full.includes(`${path.sep}i18n${path.sep}`)
      ? [full]
      : [];
  });
}

const files = sourceFiles(SRC).map((file) => ({ file: path.relative(SRC, file), text: readFileSync(file, 'utf8') }));
const tables = { en: en as Record<string, string>, sw };

describe('portal i18n coverage (Swahili + English)', () => {
  it('actually scans the app (guards against a vacuous pass)', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('both tables have exactly the same keys, none empty', () => {
    expect(Object.keys(sw).sort()).toEqual(Object.keys(en).sort());
    for (const [locale, table] of Object.entries(tables)) {
      const empty = Object.entries(table).filter(([, value]) => value.trim() === '').map(([key]) => key);
      expect(empty, `${locale} has empty strings`).toEqual([]);
    }
  });

  it('every literal key used in the source exists in both tables', () => {
    const missing: string[] = [];
    for (const { file, text } of files) {
      for (const match of text.matchAll(/\b(?:t\(\s*|labelKey:\s*)'([a-zA-Z][\w.]*)'/g)) {
        const key = match[1]!;
        if (!(key in en) || !(key in sw)) missing.push(`${file}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every runtime-built key family is declared, and each of its values exists in both tables', () => {
    const prefixes = Object.keys(FAMILIES).sort((a, b) => b.length - a.length);
    const unknown: string[] = [];
    const missing: string[] = [];
    for (const { file, text } of files) {
      for (const match of text.matchAll(/\bt\(\s*`([\w.]*)\$\{/g)) {
        const prefix = match[1]!;
        const family = prefixes.find((candidate) => candidate === prefix);
        if (family === undefined) {
          unknown.push(`${file}: t(\`${prefix}\${…}\`) — declare its values in FAMILIES`);
          continue;
        }
        for (const value of FAMILIES[family]!) {
          const key = `${family}${value}`;
          for (const [locale, table] of Object.entries(tables)) {
            if (!(key in table)) missing.push(`${locale}: ${key} (${file})`);
          }
        }
      }
    }
    expect(unknown).toEqual([]);
    expect([...new Set(missing)]).toEqual([]);
  });
});
