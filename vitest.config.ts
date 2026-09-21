import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@dbw/core': src('./packages/core/src/index.ts'),
      '@dbw/driver-sqlite': src('./packages/driver-sqlite/src/index.ts'),
      '@dbw/language-prql': src('./packages/language-prql/src/index.ts'),
    },
  },
  test: { include: ['packages/*/src/**/*.test.ts'], environment: 'node' },
});
