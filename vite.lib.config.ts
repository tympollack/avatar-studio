/**
 * vite.lib.config.ts
 *
 * Vite library build configuration for @digitalcanopy/avatar-studio.
 * Produces a separate ESM bundle of the public schema/types API from
 * src/index.ts, independent of the SPA build in vite.config.ts.
 *
 * Usage: vite build --config vite.lib.config.ts
 * Output: dist/lib/avatar-studio.js  (ESM, tree-shakeable)
 *         dist/types/                (from tsconfig.lib.json tsc emit)
 */

import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      name: 'AvatarStudio',
      fileName: 'avatar-studio',
      formats: ['es'],
    },
    outDir: 'dist/lib',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      // Treat all peer deps as external — consumers provide them
      external: [
        'zod',
        'react',
        'react-dom',
        '@digitalcanopy/supabase',
        '@digitalcanopy/ui',
      ],
    },
  },
});
