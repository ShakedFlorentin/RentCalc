import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { GuidePlace, Place } from '../types'

const PIN_COLORS: Record<string, string> = {
  food: '#d7263d',
  sight: '#8e2de2',
  shopping: '#f08a24',
  transport: '#2e86de',
  other: '#3f7d5a',
}

type Props = {
  places: Place[]
  onPick: (p: Place) => void
  /** a guide's places, drawn as small dots under the trip's own pins */
  guide?: GuidePlace[]
  onPickGuide?: (g: GuidePlace) => void
}

export default function PlacesMap({ places, onPick, guide = [], onPickGuide }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const guideLayer = useRef<L.LayerGroup | null>(null)
  const fitted = useRef('')

  useEffect(() => {
    map.current = L.map(el.current!, { zoomControl: false }).setView([35.0, 136.5], 6)
    L.control.zoom({ position: 'bottomleft' }).addTo(map.current)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(map.current)
    guideLayer.current = L.layerGroup().addTo(map.current)
    layer.current = L.layerGroup().addTo(map.current)
    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    if (!map.current || !layer.current) return
    layer.current.clearLayers()
    const pts = places.filter((p) => p.lat != null && p.lng != null)
    for (const p of pts) {
      const icon = L.divIcon({
        className: '',
        html: `<div class="pin${p.visited ? ' visited' : ''}" style="background:${PIN_COLORS[p.category] ?? PIN_COLORS.other}"></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      })
      L.marker([p.lat!, p.lng!], { icon, title: p.name }).on('click', () => onPick(p)).addTo(layer.current)
    }
    // refit only when the set of places changes (a filter or a new place), not when tapping a pin or a friend's edit
    // re-renders, or the map would jump away from where the viewer zoomed in
    const key = pts.map((p) => p.id).sort().join()
    if (pts.length && key !== fitted.current) {
      fitted.current = key
      map.current.fitBounds(L.latLngBounds(pts.map((p) => [p.lat!, p.lng!])), { padding: [30, 30], maxZoom: 15 })
    }
  }, [places, onPick])

  useEffect(() => {
    if (!map.current || !guideLayer.current) return
    guideLayer.current.clearLayers()
    const icon = L.divIcon({ className: '', html: '<div class="pin guide"></div>', iconSize: [14, 14], iconAnchor: [7, 7] })
    for (const g of guide) {
      L.marker([g.lat, g.lng], { icon, title: g.name }).on('click', () => onPickGuide?.(g)).addTo(guideLayer.current)
    }
    // with no trip pins to frame, frame the guide instead
    if (guide.length && !places.some((p) => p.lat != null) && fitted.current !== 'guide') {
      fitted.current = 'guide'
      map.current.fitBounds(L.latLngBounds(guide.map((g) => [g.lat, g.lng])), { padding: [30, 30], maxZoom: 15 })
    }
  }, [guide, onPickGuide, places])

  return <div ref={el} className="map" />
}
