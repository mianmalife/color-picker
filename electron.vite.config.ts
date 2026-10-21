import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: { build: { rolldownOptions: { input: 'electron/main.ts', output: { format: 'cjs', entryFileNames: 'index.cjs' } } } },
  preload: { build: { rolldownOptions: { input: 'electron/preload.ts', output: { format: 'cjs', entryFileNames: 'index.cjs' } } } },
  renderer: { root: '.', plugins: [vue()], build: { rolldownOptions: { input: 'index.html' } } }
})
