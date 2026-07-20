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

/**
 * Prisma cannot declare partial unique indexes, so slot exclusivity for
 * bookings is created here: one active appointment per (doctorId, scheduledAt).
 * Idempotent — call at server startup and in integration test setup, after
 * `prisma db push` / migrations.
 */
export async function ensureBookingSlotIndex(client: PrismaClient = prisma): Promise<void> {
  await client.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "uniq_appointment_active_slot"
     ON "Appointment" ("doctorId", "scheduledAt")
     WHERE "status" NOT IN ('CANCELLED', 'NO_SHOW')`,
  );
}
