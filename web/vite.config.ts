import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The API is stdlib-Python on :8010 and serves both /api and the generated
// /media files. We proxy both in dev so the app is same-origin and no CORS
// preflight ever enters the picture — Codex leaves CORS permissive, but a
// proxy means his server config can tighten later without breaking us.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const API = ((globalThis as any).process?.env?.BROLL_API_ORIGIN as string | undefined) ?? 'http://127.0.0.1:8010'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/media': { target: API, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
