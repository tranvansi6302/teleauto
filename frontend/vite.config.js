import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: process.env.VERCEL ? 'dist' : '../public',
    emptyOutDir: true
  },
  server: {
    proxy: {
      '/api': {
        target: 'https://teleauto-0tdl.onrender.com',
        changeOrigin: true
      }
    }
  }
})
