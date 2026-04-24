import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Cleanup legacy service workers + caches that could intercept requests
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => void reg.unregister())
  })
}
if ('caches' in window) {
  void caches.keys().then((keys) => keys.forEach((key) => void caches.delete(key)))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
