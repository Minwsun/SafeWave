import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Đã gỡ bỏ StrictMode để tránh lỗi khởi tạo Map 2 lần
createRoot(document.getElementById('root')!).render(
  <App />
)