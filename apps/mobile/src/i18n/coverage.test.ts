import fs from 'node:fs';
import path from 'node:path';
import { doctorSpecialtySchema, healthTipCategorySchema } from '@daktari/schemas';
import { en, sw } from './translations';

/**
 * Every key the app can ask for has BOTH a Swahili and an English string —
 * including keys BUILT at runtime (t(`appointments.status.${status}` as never)),
 * which the type checker cannot see through the cast. Each runtime family's
 * values come from the real source of truth (Prisma enums, the booking
 * intents). A new family fails here until its values are declared below.
 */
const MOBILE = path.resolve(__dirname, '../..');
const SCHEMA = fs.readFileSync(path.resolve(MOBILE, '../../packages/db/prisma/schema.prisma'), 'utf8');

function prismaEnum(name: string): string[] {
  const match = new RegExp(`enum ${name} \\{([^}]*)\\}`).exec(SCHEMA);
  if (!match) throw new Error(`enum ${name} not found in schema.prisma`);
  return match[1]!
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => /^[A-Z][A-Z0-9_]*$/.test(line));
}

const FAMILIES: Record<string, readonly string[]> = {
  'appointments.status.': prismaEnum('AppointmentStatus'),
  'payment.status.': prismaEnum('PaymentStatus'),
  'weekday.': ['0', '1', '2', '3', '4', '5', '6'],
  'booking.type.': prismaEnum('AppointmentType'),
  'booking.intent.': ['MOBILE_MONEY', 'NHIF', 'CASH_AT_FACILITY'],
  'specialty.': doctorSpecialtySchema.options,
  'legal.': ['terms.title', 'privacy.title'],
  'auth.password.strength.': ['weak', 'fair', 'strong'],
  // UI Phase 3: tip categories; greeting (morning/afternoon/evening, with or without a name).
  'tips.category.': healthTipCategorySchema.options,
  'profile.completion.step.': ['health', 'address', 'street', 'contact'],
  'home.greeting.': ['morning', 'afternoon', 'evening', 'morning.named', 'afternoon.named', 'evening.named'],
};

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !full.includes(`${path.sep}i18n${path.sep}`)
      ? [full]
      : [];
  });
}

const files = [...sourceFiles(path.join(MOBILE, 'app')), ...sourceFiles(path.join(MOBILE, 'src'))].map((file) => ({
  file: path.relative(MOBILE, file),
  text: fs.readFileSync(file, 'utf8'),
}));
const tables: Record<'sw' | 'en', Record<string, string>> = { sw, en };

describe('mobile i18n coverage (Swahili + English)', () => {
  it('actually scans the app (guards against a vacuous pass)', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('no empty strings in either table', () => {
    for (const [locale, table] of Object.entries(tables)) {
      const empty = Object.entries(table).filter(([, value]) => value.trim() === '').map(([key]) => key);
      expect({ locale, empty }).toEqual({ locale, empty: [] });
    }
  });

  it('every literal key used in the source exists in both tables', () => {
    const missing: string[] = [];
    for (const { file, text } of files) {
      // t('key'), labelKey: 'key', and [field, 'records.section.x'] tuples.
      const patterns = [/\bt\(\s*'([a-zA-Z][\w.]*)'/g, /\blabelKey:\s*'([a-zA-Z][\w.]*)'/g, /\[\s*'\w+',\s*'([a-z][\w]*\.[\w.]+)'\s*\]/g];
      for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
          const key = match[1]!;
          if (!(key in sw) || !(key in en)) missing.push(`${file}: ${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('every runtime-built key family is declared, and each value exists in both tables', () => {
    const unknown: string[] = [];
    const missing = new Set<string>();
    for (const { file, text } of files) {
      for (const match of text.matchAll(/\bt\(\s*`([\w.]*)\$\{/g)) {
        const prefix = match[1]!;
        const values = FAMILIES[prefix];
        if (values === undefined) {
          unknown.push(`${file}: t(\`${prefix}\${…}\`) — declare its values in FAMILIES`);
          continue;
        }
        for (const value of values) {
          for (const [locale, table] of Object.entries(tables)) {
            if (!(`${prefix}${value}` in table)) missing.add(`${locale}: ${prefix}${value} (${file})`);
          }
        }
      }
    }
    expect(unknown).toEqual([]);
    expect([...missing]).toEqual([]);
  });
});
