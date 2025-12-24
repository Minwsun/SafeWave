import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './', // Thêm dòng này để dùng relative paths trong Electron
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
  ],
  server: {
    proxy: {
      // Cấu hình Proxy để bypass lỗi CORS
      '/api-gdacs': {
        target: 'https://www.gdacs.org',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api-gdacs/, ''),
      },
    },
  },
})