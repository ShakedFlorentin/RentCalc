import { useState, type ReactNode } from 'react'
import { ExternalLink, Globe, MapPin, Play } from 'lucide-react'
import { Sheet } from './ui'
import { t } from './i18n'
import { mapsUrl, safeUrl } from './lib'
import { Icon, type LucideIcon } from './icons'

type Media = {
  instagram_url?: string | null
  tiktok_url?: string | null
  photos?: string[] | null
  lat?: number | null
  lng?: number | null
  /** where people navigate to; coordinates are only for the map pins and the planner */
  address?: string | null
}

/** Embed URL for an Instagram post/reel or TikTok video; null when the id can't be parsed. */
export function videoEmbed(m: Media): { embed: string | null; href: string; kind: 'instagram' | 'tiktok' } | null {
  if (m.instagram_url) {
    const id = m.instagram_url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([\w-]+)/i)?.[1]
    return { kind: 'instagram', href: m.instagram_url, embed: id ? `https://www.instagram.com/p/${id}/embed` : null }
  }
  if (m.tiktok_url) {
    const id = m.tiktok_url.match(/tiktok\.com\/.*?\/video\/(\d+)/i)?.[1]
    return { kind: 'tiktok', href: m.tiktok_url, embed: id ? `https://www.tiktok.com/embed/v2/${id}` : null }
  }
  return null
}

export function VideoSheet({ media, title, onClose }: { media: NonNullable<ReturnType<typeof videoEmbed>>; title: string; onClose: () => void }) {
  return (
    <Sheet title={title} onClose={onClose}>
      {media.embed ? (
        <iframe
          className={'video-frame ' + media.kind}
          src={media.embed}
          title={title}
          allow="encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="no-referrer"
        />
      ) : null}
      <a className="secondary btn-link" href={safeUrl(media.href)} target="_blank" rel="noreferrer">
        <Icon as={ExternalLink} />
        {media.kind === 'instagram' ? t('פתיחה באינסטגרם') : t('פתיחה בטיקטוק')}
      </a>
    </Sheet>
  )
}

/** Maps / website / video chips, then any extra chips the caller adds. Renders nothing when there is nothing to show. */
export function MediaActions(props: { name: string; maps?: string | null; website?: string | null; m: Media; compact?: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const website = safeUrl(props.website)
  // the saved Google Maps link, else a search for the address (or the name, for a place with a known spot)
  const maps =
    safeUrl(props.maps) || (props.m.address ? mapsUrl(props.m.address) : props.m.lat != null ? mapsUrl(props.name) : null)
  const video = videoEmbed(props.m)
  if (!maps && !website && !video && !props.children) return null
  return (
    // the chips sit inside tappable cards: a tap on a chip is only the chip's
    <div className={'actions' + (props.compact ? ' compact' : '')} onClick={(e) => e.stopPropagation()}>
      {maps && (
        <a className="action" href={maps} target="_blank" rel="noreferrer">
          <Icon as={MapPin} /> <span>{t('מפה')}</span>
        </a>
      )}
      {website && (
        <a className="action" href={website} target="_blank" rel="noreferrer">
          <Icon as={Globe} /> <span>{t('אתר')}</span>
        </a>
      )}
      {video && (
        <button className="action" onClick={() => setOpen(true)}>
          <Icon as={Play} /> <span>{t('סרטון')}</span>
        </button>
      )}
      {props.children}
      {open && video && <VideoSheet media={video} title={props.name} onClose={() => setOpen(false)} />}
    </div>
  )
}

/** Square thumbnail: first photo, else a quiet category icon tile. */
export function Thumb({ photos, icon }: { photos?: string[] | null; icon: LucideIcon }) {
  const [bad, setBad] = useState(false)
  const src = photos?.[0]
  return (
    <span className="thumb" aria-hidden="true">
      {src && !bad ? (
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} />
      ) : (
        <Icon as={icon} size={24} />
      )}
    </span>
  )
}
