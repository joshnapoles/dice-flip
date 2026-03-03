import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Config for building the demo app for GitHub Pages deployment
export default defineConfig({
  plugins: [react()],
  base: '/dice-flip/',
  build: {
    outDir: 'dist-demo',
  },
})
