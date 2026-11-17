import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// No cwd: git searches upward itself, so this works whether vite is invoked from the repo
// root or from apps/web. Shortcut: reading git at config load assumes a .git is reachable -
// a source tarball build falls back to "unknown" rather than failing.
const git = (cmd: string) => {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react-router-dom',
      '@tanstack/react-query',
      'lucide-react',
      'sonner',
      'clsx',
      'tailwind-merge',
      'react-markdown',
      'remark-gfm',
      '@xyflow/react',
      'xlsx',
    ],
  },
  // Injected so the About dialog reports the code it actually shipped with. It used to
  // display three hand-typed literals that had been sitting there since 2026-09-26.
  define: {
    __AETHERIA_COMMIT__: JSON.stringify(git('git rev-parse HEAD')),
    __AETHERIA_BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    __AETHERIA_VERSION__: JSON.stringify(
      JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
        .version || '0.0.0',
    ),
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    hmr: {
      overlay: false,
    },
    fs: {
      allow: ['..'],
    },
    warmup: {
      clientFiles: [
        './src/main.tsx',
        './src/App.tsx',
        './src/components/layout/AppLayout.tsx',
        './src/pages/UnifiedWorkstationPage.tsx',
      ],
    },
    watch: {
      ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/public/audio/**', '**/workspace/audio/**', '**/output/**'],
    },
    proxy: (() => {
      const apiTarget = process.env.AETHERIA_API || 'http://127.0.0.1:4196';
      return {
        '/session': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/api/messaging': {
          target: apiTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/messaging/, '/messaging'),
        },
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/file': {
          target: apiTarget,
          changeOrigin: true,
        },
        '/find': {
          target: apiTarget,
          changeOrigin: true,
        },
      };
    })(),
  },
  build: {
    target: 'es2022',
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react-dom') || id.includes('react-router') || /[/\\]node_modules[/\\]react[/\\]/.test(id)) {
            return 'vendor-react';
          }
          if (id.includes('@tanstack/react-query')) return 'vendor-query';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (id.includes('@tauri-apps')) return 'vendor-tauri';
          if (
            id.includes('react-markdown') ||
            id.includes('remark-') ||
            id.includes('rehype-') ||
            id.includes('micromark') ||
            id.includes('mdast') ||
            id.includes('hast') ||
            id.includes('unist') ||
            id.includes('unified')
          ) {
            return 'vendor-markdown';
          }
          return undefined;
        },
      },
    },
  },
})
