import { useEffect, useState } from 'react'
import { t } from './i18n'

export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

/** "לפני 3 שעות" for a timestamp. */
function ago(at: number) {
  const min = Math.max(1, Math.round((Date.now() - at) / 60000))
  if (min < 60) return min === 1 ? t('לפני דקה') : t('לפני {n} דקות', { n: min })
  const h = Math.round(min / 60)
  if (h < 24) return h === 1 ? t('לפני שעה') : h === 2 ? t('לפני שעתיים') : t('לפני {n} שעות', { n: h })
  const d = Math.round(h / 24)
  return d === 1 ? t('לפני יום') : d === 2 ? t('לפני יומיים') : t('לפני {n} ימים', { n: d })
}

/**
 * Slim bar under the top bar while there is no connection, or while what's shown is a saved copy
 * (`since` = when that copy was taken).
 */
export function OfflineBanner({ since }: { since: number | null }) {
  const online = useOnline()
  const [, tick] = useState(0)
  // keep "לפני 3 שעות" honest while the screen stays open
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60000)
    return () => clearInterval(t)
  }, [])
  if (online && since == null) return null
  const parts = [online ? t('השרת לא עונה') : t('אין אינטרנט')]
  if (since != null) parts.push(t('עדכון אחרון {ago}', { ago: ago(since) }))
  return (
    <div
      role="status"
      className="small"
      style={{ background: 'var(--accent-soft)', color: 'var(--accent)', padding: '6px 20px', textAlign: 'center' }}
    >
      {parts.join(' · ')}
    </div>
  )
}
