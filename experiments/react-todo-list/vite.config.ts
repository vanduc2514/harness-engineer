import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves this project under /<repo>/, so the deploy workflow sets
  // VITE_BASE. Local runs and the dev server keep the default.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
})
