import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    environment: 'node',
    testTimeout: 60_000, // argon2id hashing in auth flows is deliberately slow
    hookTimeout: 60_000,
  },
});
