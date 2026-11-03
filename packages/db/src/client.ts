import { PrismaClient } from '@prisma/client';

// DATABASE_URL is read by Prisma itself; this package deliberately does not
// depend on @daktari/config so that migrations/seeds can run standalone.

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Process-wide Prisma client singleton (survives hot reload in dev). */
export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export class MigrationsNotAppliedError extends Error {
  constructor(missing: string) {
    super(
      `database is not migrated (${missing} missing) — run \`pnpm db:migrate\` (dev) or ` +
        '`pnpm db:deploy` (staging/production) and restart',
    );
    this.name = 'MigrationsNotAppliedError';
  }
}

/**
 * Slot exclusivity for bookings is a partial unique index Prisma cannot
 * declare; it is created by migration 1_booking_slot_index (no longer at
 * startup). The server calls this at boot and refuses to start without it —
 * booking without the arbiter would allow double-booked slots.
 */
export async function assertBookingSlotIndex(client: PrismaClient = prisma): Promise<void> {
  const rows = await client.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname FROM pg_indexes WHERE indexname = 'uniq_appointment_active_slot'`;
  if (rows.length === 0) throw new MigrationsNotAppliedError('uniq_appointment_active_slot');
}
