/*
 * Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
 * © 2026 WhiteRock (Royal Enterprise). All rights reserved.
 *
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import { colorForSalesmanId, salesmanColorMap, UNASSIGNED_PIN_COLOR } from '../mapColors'
import { formatDateTime } from '../lib/dateUtils'

const DefaultIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})
L.Marker.prototype.options.icon = DefaultIcon

const pinIconCache = new Map<string, L.Icon>()
function coloredPinIcon(hex: string): L.Icon {
  let icon = pinIconCache.get(hex)
  if (!icon) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36"><path fill="${hex}" stroke="#ffffff" stroke-width="1.5" d="M12 1.5C6.9 1.5 2.8 5.6 2.8 10.7c0 5.5 9.2 17.8 9.2 17.8s9.2-12.3 9.2-17.8C21.2 5.6 17.1 1.5 12 1.5z"/><circle cx="12" cy="10.5" r="3.2" fill="#fff" opacity="0.9"/></svg>`
    const url = `data:image/svg+xml,${encodeURIComponent(svg)}`
    icon = L.icon({
      iconUrl: url,
      iconSize: [28, 40],
      iconAnchor: [14, 40],
      popupAnchor: [0, -36],
    })
    pinIconCache.set(hex, icon)
  }
  return icon
}



const liveSalesmanDot = L.divIcon({
  className: 'live-salesman-dot',
  html: `
    <div style="position: relative; width: 18px; height: 18px;">
      <div style="position: absolute; width: 18px; height: 18px; background-color: #3b82f6; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 6px rgba(0,0,0,0.5); z-index: 2;"></div>
      <div class="live-pulse-ring" style="position: absolute; top: -13px; left: -13px; width: 44px; height: 44px; background-color: rgba(59, 130, 246, 0.4); border-radius: 50%; z-index: 1;"></div>
    </div>
    <style>
      @keyframes pulse-ring {
        0% { transform: scale(0.3); opacity: 0.8; }
        80%, 100% { transform: scale(1.5); opacity: 0; }
      }
      .live-pulse-ring {
        animation: pulse-ring 2s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
      }
    </style>
  `,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

type SalesmanRef = { id: string; name: string }
type CustomerPoint = {
  id: string
  name: string
  city: string
  lat: number
  lng: number
  salesmanName?: string
  assignedSalesmanId?: string
  address?: string
  phone?: string
  lastVisitDate?: string
}
type LivePoint = { lat: number; lng: number; accuracy: number; time: string; salesmanId?: string }


function LocateControl({ location, geoBlocked }: { location: L.LatLngExpression | null; geoBlocked: boolean }) {
  const map = useMap()
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const errTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showErr = (msg: string) => {
    setErrMsg(msg)
    if (errTimerRef.current) clearTimeout(errTimerRef.current)
    errTimerRef.current = setTimeout(() => setErrMsg(null), 4000)
  }

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    if (location && !geoBlocked) {
      map.flyTo(location, 16, { duration: 1 })
    } else if (navigator.geolocation) {
      // Force a re-check if it was blocked, or if we don't have location yet
      navigator.geolocation.getCurrentPosition(
        (pos) => map.flyTo([pos.coords.latitude, pos.coords.longitude], 16, { duration: 1 }),
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            showErr('Location permission denied. Enable it in browser settings and try again.')
          } else if (err.code === err.TIMEOUT) {
            showErr('Location timed out. Try again in an open area.')
          } else {
            showErr('Could not get location. Make sure GPS is on.')
          }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      )
    } else {
      showErr('Geolocation is not supported by this browser.')
    }
  }

  const isBlocked = geoBlocked

  return (
    <div className="leaflet-top leaflet-left">
      <div className="leaflet-control leaflet-bar" style={{ marginTop: '80px', marginLeft: '10px' }}>
        <a
          href="#"
          role="button"
          title={isBlocked ? 'Location blocked — tap for help' : 'Go to my location'}
          onClick={handleClick}
          style={{
            width: '30px', height: '30px', display: 'flex', alignItems: 'center',
            justifyContent: 'center', backgroundColor: '#fff',
            color: isBlocked ? '#dc2626' : '#333', textDecoration: 'none',
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
            <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/>
          </svg>
        </a>
      </div>
      {errMsg ? (
        <div style={{
          marginTop: '4px', marginLeft: '10px', maxWidth: '200px',
          background: '#1e293b', color: '#fff', fontSize: '0.75rem',
          padding: '6px 10px', borderRadius: '6px', lineHeight: 1.4,
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        }}>
          {errMsg}
        </div>
      ) : null}
    </div>
  )
}

function FitBounds({ points }: { points: L.LatLngExpression[] }) {
  const map = useMap()
  // Only fit bounds ONCE on initial mount — never reset the user's manual zoom.
  const hasRunRef = useRef(false)
  useEffect(() => {
    if (hasRunRef.current || points.length === 0) return
    hasRunRef.current = true
    const bounds = L.latLngBounds(points)
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 })
  }, [map, points])
  return null
}

function ResizeInvalidate() {
  const map = useMap()
  useEffect(() => {
    const refresh = () => map.invalidateSize()
    refresh()
    const t = window.setTimeout(refresh, 250)
    window.addEventListener('resize', refresh)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('resize', refresh)
    }
  }, [map])
  return null
}

type DealerMapProps = {
  customers: CustomerPoint[]
  livePoints: LivePoint[]
  /** Used to resolve salesman names on live pings when only salesmanId is set */
  salesmen?: SalesmanRef[]
  center?: [number, number]
  zoom?: number
  className?: string
}

function salesmanNameForId(salesmen: SalesmanRef[] | undefined, id: string | undefined) {
  if (!salesmen?.length || !id) return undefined
  return salesmen.find((s) => s.id === id)?.name
}

export function DealerMap({
  customers,
  livePoints,
  salesmen,
  center = [20.5937, 78.9629],
  zoom = 5,
  className = '',
}: DealerMapProps) {
  const colors = useMemo(() => salesmanColorMap(salesmen ?? []), [salesmen])

  const [myLiveLocation, setMyLiveLocation] = useState<[number, number] | null>(null)
  // Tracks whether the user has denied / blocked location access
  const [geoBlocked, setGeoBlocked] = useState(false)

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoBlocked(true)
      return
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setGeoBlocked(false)
        setMyLiveLocation([pos.coords.latitude, pos.coords.longitude])
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setGeoBlocked(true)
        // POSITION_UNAVAILABLE / TIMEOUT are transient — don't block the button for those
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  const boundsPoints = useMemo(() => {
    // Deliberately excludes myLiveLocation — including it causes FitBounds to
    // re-fire on every GPS tick, resetting the user's manual zoom on mobile.
    const list: L.LatLngExpression[] = []
    for (const c of customers) {
      if (Number.isFinite(c.lat) && Number.isFinite(c.lng)) list.push([c.lat, c.lng])
    }
    for (const p of livePoints) {
      if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) list.push([p.lat, p.lng])
    }
    return list
  }, [customers, livePoints])

  const showFit = boundsPoints.length > 0

  return (
    <div className={`dealer-map-wrap ${className}`.trim()}>
      <MapContainer
        center={center}
        zoom={zoom}
        scrollWheelZoom
        touchZoom
        zoomControl
        className="dealer-map"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ResizeInvalidate />
        <LocateControl location={myLiveLocation} geoBlocked={geoBlocked} />
        {showFit ? <FitBounds points={boundsPoints} /> : null}

        {myLiveLocation ? (
          <Marker position={myLiveLocation} icon={liveSalesmanDot} zIndexOffset={1000}>
            <Popup>
              <strong>Your Current Location</strong>
            </Popup>
          </Marker>
        ) : null}

        {customers.map((c) => (
          <Marker
            key={`c-${c.id}`}
            position={[c.lat, c.lng]}
            icon={coloredPinIcon(colorForSalesmanId(colors, c.assignedSalesmanId))}
          >
            <Popup>
              <strong>{c.name}</strong>
              <br />
              {myLiveLocation ? (
                <span style={{ fontSize: '0.9em', color: '#059669', fontWeight: 600 }}>
                  📍 { (L.latLng(myLiveLocation as [number, number]).distanceTo([c.lat, c.lng]) / 1000).toFixed(2) } km away
                  <br />
                </span>
              ) : null}
              {c.address ? <>{c.address}<br /></> : null}
              {c.city}
              <br />
              {c.phone ? <span style={{ fontSize: '0.9em' }}>Phone: {c.phone}<br /></span> : null}
              <span style={{ fontSize: '0.9em', color: '#334155' }}>
                Salesman: {c.salesmanName ?? '—'}
              </span>
              <br />
              {c.lastVisitDate ? (
                <span style={{ fontSize: '0.9em', color: '#334155' }}>
                  Last visit: {formatDateTime(c.lastVisitDate)}<br />
                </span>
              ) : null}
              <div style={{ marginTop: '10px' }}>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'inline-block', width: '100%', textAlign: 'center', padding: '6px 12px', fontSize: '0.9em', background: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '4px', textDecoration: 'none', fontWeight: 600, boxSizing: 'border-box' }}
                >
                  Get Directions
                </a>
              </div>
            </Popup>
          </Marker>
        ))}

        {livePoints.slice(0, 50).map((p, i) => {
          const liveSalesman = salesmanNameForId(salesmen, p.salesmanId)
          const liveColor = colorForSalesmanId(colors, p.salesmanId)
          return (
            <CircleMarker
              key={`live-${p.time}-${i}`}
              center={[p.lat, p.lng]}
              radius={6}
              pathOptions={{
                color: liveColor,
                fillColor: liveColor,
                fillOpacity: 0.88,
                weight: 2,
              }}
            >
              <Popup>
                <strong>Live location</strong>
                {liveSalesman ? (
                  <>
                    <br />
                    <span style={{ fontSize: '0.9em', color: '#334155' }}>Salesman: {liveSalesman}</span>
                  </>
                ) : null}
                <br />
                {formatDateTime(p.time)}
                <br />
                ±{Math.round(p.accuracy)}m
              </Popup>
            </CircleMarker>
          )
        })}

      </MapContainer>
      <div className="map-legend">
        <span>
          <i className="legend-pin dealer" style={{ background: UNASSIGNED_PIN_COLOR }} /> Customers (color = assigned
          salesman)
        </span>
        {livePoints.length ? (
          <span>
            <i className="legend-dot live" style={{ background: '#9333ea' }} /> Live ping (same color as that salesman)
          </span>
        ) : null}
      </div>
    </div>
  )
}
