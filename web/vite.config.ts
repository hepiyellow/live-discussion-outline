import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The page (ADR 0001). The server serves the build (web/dist), and with --dev mounts this config as middleware instead.
export default defineConfig({
    root: import.meta.dirname,
    base: '/',
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': path.join(import.meta.dirname, 'src') } },
    build: { outDir: 'dist', emptyOutDir: true },
})
