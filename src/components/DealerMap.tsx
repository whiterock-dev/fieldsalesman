import { useEffect, useMemo } from 'react'
import L from 'leaflet'
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import { colorForSalesmanId, salesmanColorMap, UNASSIGNED_PIN_COLOR } from '../mapColors'

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

const visitDotIconCache = new Map<string, L.DivIcon>()
function visitDotIcon(hex: string): L.DivIcon {
  let icon = visitDotIconCache.get(hex)
  if (!icon) {
    icon = L.divIcon({
      className: 'visit-marker-icon',
      html: `<span class="visit-marker-dot" style="background:${hex}"></span>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    })
    visitDotIconCache.set(hex, icon)
  }
  return icon
}

type SalesmanRef = { id: string; name: string }
type CustomerPoint = {
  id: string
  name: string
  city: string
  lat: number
  lng: number
  salesmanName?: string
  assignedSalesmanId?: string
}
type LivePoint = { lat: number; lng: number; accuracy: number; time: string; salesmanId?: string }
type VisitPoint = {
  id: string
  customerName: string
  lat: number
  lng: number
  capturedAt: string
  salesmanName: string
  salesmanId?: string
}

function FitBounds({ points }: { points: L.LatLngExpression[] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) return
    const bounds = L.latLngBounds(points)
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 })
  }, [map, points])
  return null
}

type DealerMapProps = {
  customers: CustomerPoint[]
  livePoints: LivePoint[]
  recentVisits?: VisitPoint[]
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
  recentVisits = [],
  salesmen,
  center = [20.5937, 78.9629],
  zoom = 5,
  className = '',
}: DealerMapProps) {
  const colors = useMemo(() => salesmanColorMap(salesmen ?? []), [salesmen])

  const boundsPoints = useMemo(() => {
    const list: L.LatLngExpression[] = []
    for (const c of customers) {
      if (Number.isFinite(c.lat) && Number.isFinite(c.lng)) list.push([c.lat, c.lng])
    }
    for (const p of livePoints) {
      if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) list.push([p.lat, p.lng])
    }
    for (const v of recentVisits) {
      if (Number.isFinite(v.lat) && Number.isFinite(v.lng)) list.push([v.lat, v.lng])
    }
    return list
  }, [customers, livePoints, recentVisits])

  const showFit = boundsPoints.length > 0

  return (
    <div className={`dealer-map-wrap ${className}`.trim()}>
      <MapContainer center={center} zoom={zoom} scrollWheelZoom className="dealer-map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {showFit ? <FitBounds points={boundsPoints} /> : null}

        {customers.map((c) => (
          <Marker
            key={`c-${c.id}`}
            position={[c.lat, c.lng]}
            icon={coloredPinIcon(colorForSalesmanId(colors, c.assignedSalesmanId))}
          >
            <Popup>
              <strong>{c.name}</strong>
              <br />
              {c.city}
              <br />
              <span style={{ fontSize: '0.9em', color: '#334155' }}>
                Salesman: {c.salesmanName ?? '—'}
              </span>
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
                {new Date(p.time).toLocaleString()}
                <br />
                ±{Math.round(p.accuracy)}m
              </Popup>
            </CircleMarker>
          )
        })}

        {recentVisits.slice(0, 30).map((v) => (
          <Marker
            key={`v-${v.id}`}
            position={[v.lat, v.lng]}
            icon={visitDotIcon(colorForSalesmanId(colors, v.salesmanId))}
          >
            <Popup>
              <strong>Visit</strong>: {v.customerName}
              <br />
              <span style={{ fontSize: '0.9em', color: '#334155' }}>Salesman: {v.salesmanName}</span>
              <br />
              {new Date(v.capturedAt).toLocaleString()}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      <div className="map-legend">
        <span>
          <i className="legend-pin dealer" style={{ background: UNASSIGNED_PIN_COLOR }} /> Customers (color = assigned
          salesman)
        </span>
        <span>
          <i className="legend-dot live" style={{ background: '#9333ea' }} /> Live ping (same color as that salesman)
        </span>
        <span>
          <i className="legend-dot visit" style={{ background: '#16a34a' }} /> Recent visits (salesman color)
        </span>
      </div>
    </div>
  )
}
