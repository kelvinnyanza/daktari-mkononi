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
