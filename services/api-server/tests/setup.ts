/**
 * Runs before any test module is imported (vitest setupFiles). The Prisma
 * client singleton in @daktari/db captures DATABASE_URL at module load, so it
 * must be pointed at the test database before the first import — beforeAll is
 * too late once test helpers import @daktari/db values.
 */
if (process.env.TEST_DATABASE_URL !== undefined && process.env.TEST_DATABASE_URL !== '') {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
