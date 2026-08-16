/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

/**
 * The live-mode API key is read from the environment ONLY when running the dev
 * server. For `vite build` the define is always the empty string, so a key can
 * never be baked into production output no matter what the environment holds.
 */
export default defineConfig(({ command }) => ({
  define: {
    __DEV_OPENAI_KEY__: JSON.stringify(
      command === 'serve' ? (process.env.OPENAI_API_KEY ?? '') : '',
    ),
  },
  build: {
    target: 'es2022',
    cssMinify: true,
    reportCompressedSize: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['harness/**', 'node_modules/**', 'dist/**'],
    reporters: ['default'],
  },
}));
