/**
 * One-time backfill (UI Phase 2): move plaintext health columns into the
 * encrypted health-profile blob and clear them.
 *
 *   pnpm --filter @daktari/api-server health:encrypt-backfill
 *
 * Idempotent and safe to re-run: each row is read, merged and written in one
 * update; rows with nothing left in plaintext are never selected again. For
 * a row that already has a blob, the blob wins (it is newer — every Phase 2
 * write clears the legacy columns) and the stale plaintext is just cleared.
 * Run it in every environment before the follow-up migration that drops the
 * legacy columns.
 */
import '../lib/load-env.js';
import { auditLogRepository, patientRepository } from '@daktari/db';
import {
  encodeHealthProfile,
  hasLegacyHealthData,
  LEGACY_CLEARED,
  readHealthProfile,
} from '../modules/patients/health-profile.js';

const BATCH = 200;

async function main(): Promise<void> {
  let migrated = 0;
  let cleared = 0;
  for (;;) {
    const rows = await patientRepository.findWithLegacyHealthData(BATCH);
    if (rows.length === 0) break;
    for (const row of rows) {
      if (!hasLegacyHealthData(row)) continue;
      if (row.encryptedHealthProfile === null) {
        await patientRepository.update(row.id, {
          ...LEGACY_CLEARED,
          encryptedHealthProfile: encodeHealthProfile(readHealthProfile(row)),
          healthProfileUpdatedAt: new Date(),
        });
        migrated += 1;
      } else {
        await patientRepository.update(row.id, LEGACY_CLEARED);
        cleared += 1;
      }
    }
  }
  await auditLogRepository.append({
    actorUserId: null,
    action: 'HEALTH_PROFILE_ENCRYPT_BACKFILL',
    resourceType: 'Patient',
    resourceId: null,
    ipAddress: null,
    userAgent: null,
    metadata: { migrated, cleared },
  });
  // Counts only — never row contents.
  console.log(`health:encrypt-backfill done — encrypted ${migrated} row(s), cleared ${cleared} stale row(s).`);
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error('health:encrypt-backfill failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
