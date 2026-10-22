import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['docx', 'jszip'] })]
  },
  preload: {},
  renderer: {
    plugins: [react()]
  }
})
