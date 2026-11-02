/**
 * ONE-OFF (Phase 13a), DEV DATA ONLY — apply the late/orphan payment rule to
 * payments that were left PROCESSING/PENDING when their appointment was
 * cancelled or expired before the rule existed.
 *
 *   pnpm --filter @daktari/db exec tsx prisma/scripts/fix-orphan-payments-13a.ts          # dry run
 *   pnpm --filter @daktari/db exec tsx prisma/scripts/fix-orphan-payments-13a.ts --apply  # write
 *
 * For each such payment:
 *   - it is marked abandoned (`abandonedAt`), exactly what the API now does at
 *     cancel/expiry time, so the running API's reconciliation keeps checking
 *     it and a late success is refunded instead of confirming anything;
 *   - if its provider reference was minted by the dev FakePayments adapter
 *     (`fake-mm-…`), no real money can ever have moved and no provider will
 *     ever answer for it (the fake's state died with the process), so it is
 *     closed as FAILED with an explicit reason.
 * Every change is written to AuditLog (DEV_ORPHAN_PAYMENT_CLEANUP).
 *
 * Refuses to run unless NODE_ENV is not production AND the database name ends
 * in `_dev` — this is not a production data-repair tool.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

const apply = process.argv.includes('--apply');

function databaseName(): string {
  const url = process.env.DATABASE_URL;
  if (url === undefined) throw new Error('DATABASE_URL is not set');
  return new URL(url).pathname.replace(/^\//, '');
}

async function main(): Promise<void> {
  const dbName = databaseName();
  if (process.env.NODE_ENV === 'production' || !dbName.endsWith('_dev')) {
    throw new Error(`Refusing to run: dev data only (database "${dbName}", NODE_ENV=${process.env.NODE_ENV ?? 'unset'})`);
  }

  const prisma = new PrismaClient();
  try {
    const now = new Date();
    const candidates = await prisma.payment.findMany({
      where: {
        status: { in: ['PENDING', 'PROCESSING'] },
        appointment: {
          OR: [
            { status: { in: ['CANCELLED', 'NO_SHOW'] } },
            { status: 'PENDING_PAYMENT', expiresAt: { lt: now } },
          ],
        },
      },
      include: { appointment: { select: { status: true, cancellationReason: true } } },
      orderBy: { createdAt: 'asc' },
    });

    console.log(`${apply ? 'APPLY' : 'DRY RUN'} on ${dbName}: ${candidates.length} orphaned payment(s)`);
    for (const payment of candidates) {
      const fakeReference = payment.aggregatorTransactionId?.startsWith('fake-mm-') ?? false;
      const action = fakeReference || payment.status === 'PENDING' ? 'close-failed' : 'abandon-watch';
      console.log(
        `  ${payment.id}  ${payment.status}  TZS ${payment.amountTzs}  appointment=${payment.appointment?.status ?? '?'}` +
          ` (${payment.appointment?.cancellationReason ?? '-'})  → ${action}`,
      );
      if (!apply) continue;

      await prisma.$transaction(async (tx) => {
        const { count } = await tx.payment.updateMany({
          where: { id: payment.id, status: payment.status },
          data:
            action === 'close-failed'
              ? {
                  status: 'FAILED',
                  abandonedAt: payment.abandonedAt ?? now,
                  failureReason: fakeReference
                    ? 'dev cleanup (13a): dev fake-provider reference — no money moved'
                    : 'dev cleanup (13a): never reached the provider',
                }
              : { abandonedAt: payment.abandonedAt ?? now },
        });
        if (count === 0) return; // changed underneath us — leave it
        await tx.auditLog.create({
          data: {
            actorUserId: null,
            action: 'DEV_ORPHAN_PAYMENT_CLEANUP',
            resourceType: 'Payment',
            resourceId: payment.id,
            metadata: {
              action,
              previousStatus: payment.status,
              amountTzs: payment.amountTzs,
              appointmentStatus: payment.appointment?.status ?? null,
            },
          },
        });
      });
    }
    if (!apply && candidates.length > 0) console.log('Re-run with --apply to write these changes.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
