/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

/**
 * The live-mode API key is read from the environment ONLY when running the dev
 * server. For `vite build` the define is always the empty string, so a key can
 * never be baked into production output no matter what the environment holds.
 */
export default defineConfig(({ command }) => ({
  /**
   * Relative asset URLs, so one build runs from any path.
   *
   * GitHub Pages serves a project site from /<repo>/ rather than from the root.
   * Hardcoding that prefix would have produced a bundle that only works at one
   * URL -- and `vite preview` honours `base`, so the harness, which drives
   * http://localhost:4173/, would have been auditing a 404. A relative base
   * resolves against whatever directory the page was loaded from, so the
   * artifact CI publishes is byte-identical to the one the gates measure.
   *
   * Safe here because this is a single page with no client-side routing.
   */
  base: './',
  define: {
    __DEV_OPENAI_KEY__: JSON.stringify(
      command === 'serve' ? (process.env.OPENAI_API_KEY ?? '') : '',
    ),
  },
  /**
   * The dev server honours PORT when the environment sets one, so a second
   * checkout (or a second agent) can serve the app without colliding with the
   * default. Unset, it is Vite's 5173 as before.
   */
  server: {
    port: Number(process.env['PORT']) || 5173,
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
