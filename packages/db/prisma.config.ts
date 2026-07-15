// Prisma config (replaces the deprecated package.json#prisma block).
// Unlike the legacy setup, prisma.config.ts does not auto-load .env —
// dotenv/config restores that for migrate/seed commands.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
