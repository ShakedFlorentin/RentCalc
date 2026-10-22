import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// relative base so the build works on GitHub Pages under /<repo>/
export default defineConfig({ plugins: [react()], base: './' })
