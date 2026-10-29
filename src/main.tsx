import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './styles/ltr.css'

// relative path: the site lives under /<repo>/ on GitHub Pages; dev has no worker so it never serves stale files
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}))
}

// A phone keeps the app open in the background for days, so a deploy only showed after it was closed for real.
// Back in front after a while: if the site has a newer build, load it. Unsent changes wait in localStorage (outbox).
if (import.meta.env.PROD) {
  const BUILD = /assets\/index-[\w-]+\.js/
  const running = document.querySelector<HTMLScriptElement>('script[src*="assets/index-"]')?.src.match(BUILD)?.[0]
  let hiddenAt = 0
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') return void (hiddenAt = Date.now())
    if (!running || !navigator.onLine || Date.now() - hiddenAt < 60_000) return
    try {
      const html = await (await fetch('./', { cache: 'no-cache' })).text()
      const live = html.match(BUILD)?.[0]
      if (live && live !== running) location.reload()
    } catch {
      // no connection after all: stay on this version
    }
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
