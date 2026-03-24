import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { DealerMap } from './components/DealerMap'
import { LoginScreen } from './components/LoginScreen'
import { findInviteForEmail, normalizeEmail, type InvitedUser } from './lib/invites'
import { addableRolesFor, type Role } from './lib/roles'
import { supabase, supabaseEnabled } from './lib/supabase'
import { colorForSalesmanId, salesmanColorMap } from './mapColors'

type TeamProfile = { id: string; fullName: string; role: Role; email?: string }
type VisitType = 'New lead' | 'Existing customer' | 'Follow-up' | 'Collection' | 'Complaint'
type VisitStatus = 'synced' | 'queued'
type FollowUpStatus = 'pending' | 'in_progress' | 'closed'

type Salesman = { id: string; name: string }
type Customer = {
  id: string
  name: string
  phone: string
  whatsapp: string
  address: string
  city: string
  tags: string[]
  assignedSalesmanId: string
  lat: number
  lng: number
}
type FollowUp = {
  id: string
  customerId: string
  dueDate: string
  priority: 'low' | 'medium' | 'high'
  status: FollowUpStatus
  remarks: string
  salesmanId: string
}
type VisitRecord = {
  id: string
  customerId: string
  customerName: string
  salesmanId: string
  salesmanName: string
  lat: number
  lng: number
  accuracy: number
  capturedAt: string
  photoDataUrl: string
  visitType: VisitType
  notes: string
  nextAction: string
  followUpDate?: string
  status: VisitStatus
  /** Accuracy ceiling used when saving (30 existing / 80 new lead); needed for offline sync RPC. */
  maxGpsAccuracyMeters?: number
}
type MeetingResponse = { id: string; customerName: string; salesmanName: string; response: string; createdAt: string }
type LivePoint = { lat: number; lng: number; accuracy: number; time: string; salesmanId?: string }
type KpiRow = {
  salesmanId: string
  salesmanName: string
  date: string
  totalWorkingHours: string
  firstVisitTime: string
  lastVisitTime: string
  visitCount: number
  startTime: string
  endTime: string
}
type PersistedState<T> = [T, React.Dispatch<React.SetStateAction<T>>]

type NavId =
  | 'dashboard'
  | 'map'
  | 'add_visit'
  | 'admin_overdue'
  | 'admin_meetings'
  | 'admin_kpi'
  | 'settings'
  | 'field_followups'
  | 'field_tracking'
  | 'field_customers'
  | 'visits'

const NAV_ITEMS: { id: NavId; label: string; section: string; show: (r: Role) => boolean }[] = [
  { id: 'dashboard', label: 'Dashboard', section: 'Overview', show: () => true },
  { id: 'map', label: 'Map', section: 'Overview', show: () => true },
  {
    id: 'add_visit',
    label: 'Add visit',
    section: 'Field',
    show: (r) => r === 'salesman' || r === 'super_salesman' || r === 'owner' || r === 'sub_admin',
  },
  { id: 'field_followups', label: 'Pending follow-ups', section: 'Field', show: (r) => r === 'salesman' || r === 'super_salesman' },
  { id: 'field_tracking', label: 'Live tracking', section: 'Field', show: (r) => r === 'salesman' || r === 'super_salesman' },
  { id: 'field_customers', label: 'My customers', section: 'Field', show: (r) => r === 'salesman' || r === 'super_salesman' },
  { id: 'admin_overdue', label: 'Overdue follow-ups', section: 'Admin', show: (r) => r !== 'salesman' },
  { id: 'admin_meetings', label: 'Meeting responses', section: 'Admin', show: (r) => r !== 'salesman' },
  { id: 'admin_kpi', label: 'KPI table', section: 'Admin', show: (r) => r !== 'salesman' },
  { id: 'settings', label: 'Settings', section: 'Account', show: () => true },
  { id: 'visits', label: 'Visit history', section: 'Overview', show: () => true },
]

/** Max reported GPS uncertainty allowed when visiting an existing customer (tight geo-fence). */
const GPS_THRESHOLD_METERS = 30
/** New leads have no prior map pin — allow looser GPS (phones often 30–80m). */
const GPS_THRESHOLD_NEW_LEAD_METERS = 80
const RADIUS_THRESHOLD_METERS = 30
const VISIT_TYPES: VisitType[] = ['New lead', 'Existing customer', 'Follow-up', 'Collection', 'Complaint']

const INITIAL_CUSTOMERS: Customer[] = [
  {
    id: 'c1',
    name: 'Madhav Traders',
    phone: '9990011122',
    whatsapp: '9990011122',
    address: 'Shastri Nagar Market',
    city: 'Jaipur',
    tags: ['gypsum', 'soffit'],
    assignedSalesmanId: 's1',
    lat: 26.9165,
    lng: 75.8243,
  },
  {
    id: 'c2',
    name: 'Shree Interiors',
    phone: '9884411100',
    whatsapp: '9884411100',
    address: 'Navrangpura Main Rd',
    city: 'Ahmedabad',
    tags: ['t-grid'],
    assignedSalesmanId: 's2',
    lat: 23.0322,
    lng: 72.5452,
  },
]

const INITIAL_FOLLOWUPS: FollowUp[] = [
  { id: 'f1', customerId: 'c1', dueDate: '2026-03-16', priority: 'high', status: 'pending', remarks: 'Collection pending', salesmanId: 's1' },
  { id: 'f2', customerId: 'c2', dueDate: '2026-03-20', priority: 'medium', status: 'pending', remarks: 'Quotation follow-up', salesmanId: 's2' },
]

function useLocalStorageState<T>(key: string, initialValue: T): PersistedState<T> {
  const [value, setValue] = useState<T>(() => {
    const raw = localStorage.getItem(key)
    if (!raw) return initialValue
    try {
      return JSON.parse(raw) as T
    } catch {
      return initialValue
    }
  })
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value))
  }, [key, value])
  return [value, setValue]
}

function timeString(isoDate: string) {
  return new Date(isoDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

function dateString(isoDate: string) {
  return new Date(isoDate).toISOString().slice(0, 10)
}

function hoursBetween(startIso: string, endIso: string) {
  const diff = Math.max(0, new Date(endIso).getTime() - new Date(startIso).getTime())
  const mins = Math.floor(diff / 60000)
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  const toRad = (v: number) => (v * Math.PI) / 180
  const earthRadius = 6371000
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const aa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa))
  return earthRadius * c
}

function kpiFromVisits(visits: VisitRecord[], salesmen: Salesman[]): KpiRow[] {
  const grouped = new Map<string, VisitRecord[]>()
  for (const visit of visits) {
    const key = `${visit.salesmanId}-${dateString(visit.capturedAt)}`
    grouped.set(key, [...(grouped.get(key) ?? []), visit])
  }
  return [...grouped.entries()].map(([key, rows]) => {
    const [salesmanId, date] = key.split('-').length > 2
      ? [rows[0].salesmanId, dateString(rows[0].capturedAt)]
      : key.split('-')
    const sorted = rows.slice().sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
    const first = timeString(sorted[0].capturedAt)
    const last = timeString(sorted[sorted.length - 1].capturedAt)
    const salesmanName = salesmen.find((s) => s.id === salesmanId)?.name ?? rows[0].salesmanName
    return {
      salesmanId,
      salesmanName,
      date,
      totalWorkingHours: hoursBetween(`${date}T${first}:00`, `${date}T${last}:00`),
      firstVisitTime: first,
      lastVisitTime: last,
      visitCount: sorted.length,
      startTime: first,
      endTime: last,
    }
  }).sort((a, b) => b.date.localeCompare(a.date))
}

function App() {
  const [authSession, setAuthSession] = useState<Session | null>(null)
  const [authHydrated, setAuthHydrated] = useState(() => !supabaseEnabled)
  const [loginMessage, setLoginMessage] = useState('')

  const [teamProfiles, setTeamProfiles] = useState<TeamProfile[]>([])
  const [invitedUsers, setInvitedUsers] = useLocalStorageState<InvitedUser[]>('fs_invited_users', [])

  useEffect(() => {
    localStorage.removeItem('fs_offline_demo')
  }, [])
  const [customers, setCustomers] = useLocalStorageState<Customer[]>('fs_customers', INITIAL_CUSTOMERS)
  const [followUps, setFollowUps] = useLocalStorageState<FollowUp[]>('fs_followups', INITIAL_FOLLOWUPS)
  const [visits, setVisits] = useLocalStorageState<VisitRecord[]>('fs_visits', [])
  const [meetingResponses, setMeetingResponses] = useLocalStorageState<MeetingResponse[]>('fs_meeting_responses', [])
  const [livePoints, setLivePoints] = useLocalStorageState<LivePoint[]>('fs_live_points', [])
  const [online, setOnline] = useState<boolean>(navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const [geo, setGeo] = useState<{ lat: number; lng: number; accuracy: number; capturedAt: string } | null>(null)
  const [visitType, setVisitType] = useState<VisitType>('New lead')
  const [selectedCustomerId, setSelectedCustomerId] = useState('new')
  const [quickLeadName, setQuickLeadName] = useState('')
  const [quickLeadPhone, setQuickLeadPhone] = useState('')
  const [quickLeadWhatsapp, setQuickLeadWhatsapp] = useState('')
  const [quickLeadAddress, setQuickLeadAddress] = useState('')
  const [quickLeadCity, setQuickLeadCity] = useState('')
  const [quickLeadTags, setQuickLeadTags] = useState('')
  const [notes, setNotes] = useState('')
  const [nextAction, setNextAction] = useState('')
  const [followUpDate, setFollowUpDate] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState('')
  /** True when image was taken from live camera with timestamp+GPS already drawn on canvas */
  const [photoHasEmbeddedWatermark, setPhotoHasEmbeddedWatermark] = useState(false)
  const [visitCameraOn, setVisitCameraOn] = useState(false)
  const [message, setMessage] = useState('')
  const [kpiDateFilter, setKpiDateFilter] = useState('')
  const [kpiSalesmanFilter, setKpiSalesmanFilter] = useState('all')
  const [activeView, setActiveView] = useState<NavId>('dashboard')
  const watchIdRef = useRef<number | null>(null)
  const visitLocationTimeoutRef = useRef<number | null>(null)
  const locationRequestIdRef = useRef(0)
  const visitCameraStreamRef = useRef<MediaStream | null>(null)
  const visitVideoRef = useRef<HTMLVideoElement>(null)
  const [locationLocking, setLocationLocking] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('salesman')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const salesmen = useMemo(
    () =>
      teamProfiles
        .filter((p) => p.role === 'salesman' || p.role === 'super_salesman')
        .map((p) => ({ id: p.id, name: p.fullName })),
    [teamProfiles],
  )

  const role = useMemo<Role>(() => {
    const email = authSession?.user?.email
    if (!email) return 'salesman'
    const inv = findInviteForEmail(invitedUsers, email)
    if (inv) return inv.role
    if (invitedUsers.length === 0) return 'owner'
    return 'salesman'
  }, [authSession, invitedUsers])

  const addableTeamRoles = useMemo(() => addableRolesFor(role), [role])

  const allowedNavIds = useMemo(() => NAV_ITEMS.filter((item) => item.show(role)).map((item) => item.id), [role])

  useEffect(() => {
    if (!allowedNavIds.includes(activeView)) setActiveView('dashboard')
  }, [allowedNavIds, activeView])

  useEffect(() => {
    setMobileNavOpen(false)
  }, [activeView])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!mobileNavOpen) return
    const mq = window.matchMedia('(max-width: 900px)')
    if (!mq.matches) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [mobileNavOpen])

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 901px)')
    const onChange = () => {
      if (mq.matches) setMobileNavOpen(false)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const activeSalesmanId = useMemo(() => {
    if (role === 'salesman' || role === 'super_salesman') return authSession?.user?.id ?? ''
    return salesmen[0]?.id ?? authSession?.user?.id ?? ''
  }, [role, salesmen, authSession?.user?.id])

  const activeSalesman = useMemo(
    () => salesmen.find((item) => item.id === activeSalesmanId) ?? salesmen[0] ?? { id: '', name: '—' },
    [activeSalesmanId, salesmen],
  )

  const mapColorBySalesmanId = useMemo(() => salesmanColorMap(salesmen), [salesmen])

  useEffect(() => {
    if (!addableTeamRoles.length) return
    if (!addableTeamRoles.includes(inviteRole)) setInviteRole(addableTeamRoles[0])
  }, [addableTeamRoles, inviteRole])

  useEffect(() => {
    if (!supabase) {
      setAuthHydrated(true)
      return
    }
    setAuthHydrated(false)
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      setAuthHydrated(true)
    }
    void supabase.auth.getSession().then(({ data: { session } }) => {
      setAuthSession(session)
      finish()
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthSession(session)
      finish()
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const sb = supabase
    if (!sb || !authSession?.user?.email) return
    const emailNorm = normalizeEmail(authSession.user.email)

    setInvitedUsers((prev) => {
      let list = [...prev]
      if (list.length === 0) {
        list = [{ email: emailNorm, role: 'owner', addedAt: new Date().toISOString() }]
      }
      const matched = list.find((i) => normalizeEmail(i.email) === emailNorm)
      if (!matched) {
        queueMicrotask(() => {
          void sb.auth.signOut()
          setMessage('This Google account is not invited. Ask an admin to add your email in Settings.')
        })
        return prev
      }
      return list.length !== prev.length ? list : prev
    })
  }, [authSession?.user?.id])

  useEffect(() => {
    if (!supabase || !authSession?.user) return
    const matched = findInviteForEmail(invitedUsers, authSession.user.email)
    if (!matched) return
    const displayName =
      (authSession.user.user_metadata?.full_name as string | undefined) || authSession.user.email || 'User'
    void supabase.from('profiles').upsert(
      { id: authSession.user.id, full_name: displayName, role: matched.role },
      { onConflict: 'id' },
    )
  }, [authSession?.user?.id, invitedUsers])

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    const sb = supabase
    if (!sb) return
    if (!authSession?.user) return
    let closed = false
    const load = async () => {
      const [{ data: profileRows }, { data: customerRows }, { data: followupRows }, { data: visitRows }, { data: liveRows }] =
        await Promise.all([
          sb.from('profiles').select('id, full_name, role'),
          sb.from('customers').select('*').order('created_at', { ascending: false }),
          sb.from('followups').select('*').order('due_date', { ascending: true }),
          sb.from('visits').select('*').order('captured_at', { ascending: false }).limit(200),
          sb.from('live_locations').select('*').order('captured_at', { ascending: false }).limit(200),
        ])
      if (closed) return

      const profileNameById = new Map<string, string>()
      if (profileRows?.length) {
        for (const r of profileRows) {
          profileNameById.set(r.id as string, (r.full_name as string) ?? 'User')
        }
        setTeamProfiles(
          profileRows.map((r) => ({
            id: r.id as string,
            fullName: (r.full_name as string) ?? 'User',
            role: (r.role as Role) ?? 'salesman',
          })),
        )
      }
      if (customerRows?.length) {
        setCustomers(
          customerRows.map((r) => ({
            id: r.id as string,
            name: r.name as string,
            phone: r.phone as string,
            whatsapp: (r.whatsapp as string) ?? '',
            address: (r.address as string) ?? '',
            city: (r.city as string) ?? '',
            tags: (r.tags as string[]) ?? [],
            assignedSalesmanId: (r.assigned_salesman_id as string) ?? '',
            lat: Number(r.lat),
            lng: Number(r.lng),
          })),
        )
      }
      if (followupRows?.length) {
        setFollowUps(
          followupRows.map((r) => ({
            id: r.id as string,
            customerId: r.customer_id as string,
            dueDate: r.due_date as string,
            priority: r.priority as FollowUp['priority'],
            status: r.status as FollowUpStatus,
            remarks: (r.remarks as string) ?? '',
            salesmanId: r.salesman_id as string,
          })),
        )
      }
      if (visitRows?.length) {
        setVisits(
          visitRows.map((r) => ({
            id: r.id as string,
            customerId: r.customer_id as string,
            customerName: customers.find((c) => c.id === (r.customer_id as string))?.name ?? 'Customer',
            salesmanId: r.salesman_id as string,
            salesmanName: profileNameById.get(r.salesman_id as string) ?? 'Salesman',
            lat: Number(r.lat),
            lng: Number(r.lng),
            accuracy: Number(r.accuracy_meters),
            capturedAt: r.captured_at as string,
            photoDataUrl: (r.photo_path as string) ?? '',
            visitType: r.visit_type as VisitType,
            notes: r.notes as string,
            nextAction: (r.next_action as string) ?? '',
            followUpDate: (r.follow_up_date as string) ?? undefined,
            status: 'synced',
          })),
        )
      }
      if (liveRows?.length) {
        setLivePoints(
          liveRows.map((r) => ({
            lat: Number(r.lat),
            lng: Number(r.lng),
            accuracy: Number(r.accuracy_meters),
            time: r.captured_at as string,
            salesmanId: r.salesman_id as string,
          })),
        )
      }
    }
    void load()

    const channel = sb
      .channel('live-locations')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'live_locations' }, (payload) => {
        const row = payload.new as { lat: number; lng: number; accuracy_meters: number; captured_at: string; salesman_id: string }
        setLivePoints((previous) => [
          { lat: Number(row.lat), lng: Number(row.lng), accuracy: Number(row.accuracy_meters), time: row.captured_at, salesmanId: row.salesman_id },
          ...previous,
        ].slice(0, 200))
      })
      .subscribe()

    return () => {
      closed = true
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current)
      void sb.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authSession?.user?.id])

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current)
    }
  }, [])

  const pendingFollowUpsForSalesman = useMemo(
    () => followUps.filter((item) => item.salesmanId === activeSalesman.id && item.status !== 'closed').sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [activeSalesman.id, followUps],
  )
  const overdueBySalesman = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return salesmen.map((salesman) => ({
      salesman,
      overdue: followUps.filter((item) => item.salesmanId === salesman.id && item.status !== 'closed' && item.dueDate < today),
    }))
  }, [followUps, salesmen])
  const kpiRows = useMemo(() => kpiFromVisits(visits, salesmen), [visits, salesmen])
  const filteredKpiRows = useMemo(
    () => kpiRows.filter((row) => (!kpiDateFilter || row.date === kpiDateFilter) && (kpiSalesmanFilter === 'all' || row.salesmanId === kpiSalesmanFilter)),
    [kpiDateFilter, kpiRows, kpiSalesmanFilter],
  )

  const queuedVisitCount = visits.filter((item) => item.status === 'queued').length

  const mapCustomers = useMemo(() => {
    if (role === 'salesman') return customers.filter((c) => c.assignedSalesmanId === activeSalesman.id)
    return customers
  }, [role, customers, activeSalesman.id])

  const mapLivePoints = useMemo(() => {
    if (role === 'salesman') return livePoints.filter((p) => p.salesmanId === activeSalesman.id)
    return livePoints
  }, [role, livePoints, activeSalesman.id])

  const mapRecentVisits = useMemo(() => {
    const slice = visits.slice(0, 40)
    if (role === 'salesman') {
      return slice
        .filter((v) => v.salesmanId === activeSalesman.id)
        .map((v) => ({
          id: v.id,
          customerName: v.customerName,
          lat: v.lat,
          lng: v.lng,
          capturedAt: v.capturedAt,
          salesmanName: v.salesmanName,
          salesmanId: v.salesmanId,
        }))
    }
    return slice.map((v) => ({
      id: v.id,
      customerName: v.customerName,
      lat: v.lat,
      lng: v.lng,
      capturedAt: v.capturedAt,
      salesmanName: v.salesmanName,
      salesmanId: v.salesmanId,
    }))
  }, [role, visits, activeSalesman.id])

  const visitHistoryRows = useMemo(() => {
    const rows = role === 'salesman' ? visits.filter((v) => v.salesmanId === activeSalesman.id) : visits
    return rows.slice(0, 50)
  }, [role, visits, activeSalesman.id])

  const navGrouped = useMemo(() => {
    const visible = NAV_ITEMS.filter((item) => item.show(role))
    const sections = new Map<string, typeof visible>()
    for (const item of visible) {
      sections.set(item.section, [...(sections.get(item.section) ?? []), item])
    }
    return [...sections.entries()]
  }, [role])

  const activeViewLabel = useMemo(
    () => NAV_ITEMS.find((item) => item.id === activeView)?.label ?? activeView,
    [activeView],
  )

  const stopVisitCamera = useCallback(() => {
    visitCameraStreamRef.current?.getTracks().forEach((track) => track.stop())
    visitCameraStreamRef.current = null
    const el = visitVideoRef.current
    if (el) el.srcObject = null
    setVisitCameraOn(false)
  }, [])

  useEffect(() => () => stopVisitCamera(), [stopVisitCamera])

  useEffect(() => {
    if (activeView !== 'add_visit') stopVisitCamera()
  }, [activeView, stopVisitCamera])

  const clearVisitLocationWatch = useCallback(() => {
    if (visitLocationTimeoutRef.current !== null) {
      clearTimeout(visitLocationTimeoutRef.current)
      visitLocationTimeoutRef.current = null
    }
    setLocationLocking(false)
  }, [])

  useEffect(
    () => () => {
      locationRequestIdRef.current += 1
      clearVisitLocationWatch()
    },
    [clearVisitLocationWatch],
  )

  useEffect(() => {
    if (activeView !== 'add_visit') {
      locationRequestIdRef.current += 1
      clearVisitLocationWatch()
    }
  }, [activeView, clearVisitLocationWatch])

  /**
   * Uses getCurrentPosition (reliable completion) instead of watchPosition, which often never fires on desktop
   * or hangs without callbacks. Safety timeout always clears the "locking" UI.
   */
  const markVisitLocation = () => {
    setMessage('')
    clearVisitLocationWatch()

    if (!navigator.geolocation) {
      setMessage('This browser does not support geolocation.')
      return
    }

    const requestId = ++locationRequestIdRef.current
    setLocationLocking(true)

    const stopSafetyTimer = () => {
      if (visitLocationTimeoutRef.current !== null) {
        clearTimeout(visitLocationTimeoutRef.current)
        visitLocationTimeoutRef.current = null
      }
    }

    const endLocking = () => {
      stopSafetyTimer()
      setLocationLocking(false)
    }

    visitLocationTimeoutRef.current = window.setTimeout(() => {
      visitLocationTimeoutRef.current = null
      if (locationRequestIdRef.current !== requestId) return
      setLocationLocking(false)
      setMessage(
        'Location is taking too long. Allow location for this site (address bar → site settings), use HTTPS (or localhost), enable system Location/GPS, and try again — desktop often needs Wi‑Fi location or a phone hotspot.',
      )
    }, 22000)

    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (locationRequestIdRef.current !== requestId) return
          endLocking()
          const acc = position.coords.accuracy
          const lat = position.coords.latitude
          const lng = position.coords.longitude
          const capturedAt = new Date().toISOString()
          setGeo({ lat, lng, accuracy: acc, capturedAt })
          setMessage(
            acc <= GPS_THRESHOLD_METERS
              ? `Location locked: ±${Math.round(acc)}m — OK for existing customers and new leads.`
              : acc <= GPS_THRESHOLD_NEW_LEAD_METERS
                ? `Location locked: ±${Math.round(acc)}m — OK for new lead only (existing customer visits need ≤${GPS_THRESHOLD_METERS}m).`
                : `Location locked: ±${Math.round(acc)}m — need ≤${GPS_THRESHOLD_NEW_LEAD_METERS}m for new lead, ≤${GPS_THRESHOLD_METERS}m for existing customer.`,
          )
        },
        (error) => {
          if (locationRequestIdRef.current !== requestId) return
          endLocking()
          const geoError = error as GeolocationPositionError
          let hint = error.message
          if (geoError.code === 1) {
            hint = 'Permission denied — allow Location for this page (lock icon in the address bar).'
          } else if (geoError.code === 2) {
            hint = 'Position unavailable — turn on device location / GPS services.'
          } else if (geoError.code === 3) {
            hint = 'Request timed out — try outdoors or a stronger GPS/Wi‑Fi signal.'
          }
          setMessage(`Could not lock location: ${hint}`)
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 18000 },
      )
    } catch {
      if (locationRequestIdRef.current !== requestId) return
      endLocking()
      setMessage('Geolocation failed unexpectedly. Try another browser or check HTTPS.')
    }
  }

  const cancelMarkLocation = () => {
    locationRequestIdRef.current += 1
    clearVisitLocationWatch()
    setMessage('')
  }

  const startVisitCamera = async () => {
    setMessage('')
    if (!geo) {
      setMessage('Mark visit location first — the photo will include that GPS and timestamps on the image.')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage('Camera API not available. Use HTTPS and a device with a camera.')
      return
    }
    stopVisitCamera()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      visitCameraStreamRef.current = stream
      const el = visitVideoRef.current
      if (el) {
        el.srcObject = stream
        await el.play().catch(() => undefined)
      }
      setVisitCameraOn(true)
    } catch (error) {
      setMessage(`Cannot open camera: ${(error as Error).message}`)
    }
  }

  const captureVisitPhoto = async () => {
    setMessage('')
    const video = visitVideoRef.current
    if (!video || !geo) return
    if (video.readyState < 2) {
      setMessage('Wait for the preview to appear, then tap Capture photo again.')
      return
    }
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!vw || !vh) {
      setMessage('Camera preview is not ready yet.')
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = vw
    canvas.height = vh
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, vw, vh)
    const pad = Math.max(14, Math.floor(vw * 0.02))
    const lineHeight = Math.max(24, Math.floor(vh * 0.038))
    const fontSize = Math.max(17, Math.floor(vw * 0.034))
    const lines = [
      `Photo time: ${new Date().toLocaleString()}`,
      `Location: ${geo.lat.toFixed(6)}, ${geo.lng.toFixed(6)}  (GPS ±${Math.round(geo.accuracy)}m)`,
      `Visit GPS capture: ${new Date(geo.capturedAt).toLocaleString()}`,
    ]
    const boxH = pad * 2 + lines.length * lineHeight
    ctx.fillStyle = 'rgba(0,0,0,0.75)'
    ctx.fillRect(pad, vh - boxH - pad, vw - pad * 2, boxH)
    ctx.fillStyle = '#ffffff'
    ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`
    lines.forEach((line, i) => {
      ctx.fillText(line, pad * 2, vh - boxH + pad + (i + 1) * lineHeight - 8)
    })
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92)
    })
    if (!blob) {
      setMessage('Could not create image from camera.')
      return
    }
    const file = new File([blob], `visit-live-${Date.now()}.jpg`, { type: 'image/jpeg' })
    setPhotoFile(file)
    setPhotoPreview(dataUrl)
    setPhotoHasEmbeddedWatermark(true)
    stopVisitCamera()
    setMessage('Photo saved. Use Retake if you want another shot, or Save visit below.')
  }

  const clearVisitPhoto = () => {
    setPhotoFile(null)
    setPhotoPreview('')
    setPhotoHasEmbeddedWatermark(false)
    stopVisitCamera()
  }

  const retakeVisitPhoto = () => {
    clearVisitPhoto()
    void startVisitCamera()
  }

  const uploadVisitPhoto = async (visitId: string, dataUrl: string) => {
    if (!supabase) return dataUrl
    const blob = await fetch(dataUrl).then((res) => res.blob())
    const filePath = `${activeSalesman.id}/${visitId}.jpg`
    const { error } = await supabase.storage.from('visit-photos').upload(filePath, blob, {
      upsert: true,
      contentType: 'image/jpeg',
    })
    if (error) throw new Error(error.message)
    return filePath
  }

  const startLiveTracking = () => {
    setMessage('')
    if (watchIdRef.current !== null) return
    watchIdRef.current = navigator.geolocation.watchPosition(
      async (position) => {
        const point: LivePoint = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          time: new Date().toISOString(),
          salesmanId: activeSalesman.id,
        }
        setLivePoints((previous) => [point, ...previous].slice(0, 200))
        if (supabase && online) {
          const { error } = await supabase.from('live_locations').insert({
            salesman_id: activeSalesman.id,
            lat: point.lat,
            lng: point.lng,
            accuracy_meters: point.accuracy,
            captured_at: point.time,
          })
          if (error) setMessage(`Live API error: ${error.message}`)
        }
      },
      (error) => setMessage(`Live tracking error: ${error.message}`),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    )
  }

  const stopLiveTracking = () => {
    if (watchIdRef.current === null) return
    navigator.geolocation.clearWatch(watchIdRef.current)
    watchIdRef.current = null
  }

  const signInWithGoogle = async () => {
    setLoginMessage('')
    if (!supabase) return
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/` },
    })
    if (error) setLoginMessage(error.message)
  }

  const handleSignOut = async () => {
    await supabase?.auth.signOut()
    setAuthSession(null)
    localStorage.removeItem('fs_offline_demo')
    setActiveView('dashboard')
    setMobileNavOpen(false)
  }

  const addInvitedUser = () => {
    setMessage('')
    const email = normalizeEmail(inviteEmail)
    if (!email.includes('@')) {
      setMessage('Enter a valid email address.')
      return
    }
    if (!addableTeamRoles.includes(inviteRole)) {
      setMessage('Your role cannot invite that type of user.')
      return
    }
    if (invitedUsers.some((u) => normalizeEmail(u.email) === email)) {
      setMessage('That email is already invited.')
      return
    }
    setInvitedUsers((previous) => [...previous, { email, role: inviteRole, addedAt: new Date().toISOString() }])
    setInviteEmail('')
    setMessage(`Invited ${email} as ${inviteRole.replace(/_/g, ' ')}. They sign in with Google using that email only.`)
  }

  const removeInvitedUser = (email: string) => {
    if (role !== 'owner') return
    const n = normalizeEmail(email)
    setInvitedUsers((previous) => previous.filter((u) => normalizeEmail(u.email) !== n))
  }

  const saveVisit = async () => {
    setMessage('')
    if (!activeSalesman.id)
      return setMessage('Add a field user (invite their email in Settings) or ensure a salesman exists before saving visits.')
    if (!geo) return setMessage('Mark visit location before saving.')
    const maxGpsAccuracy =
      selectedCustomerId === 'new' ? GPS_THRESHOLD_NEW_LEAD_METERS : GPS_THRESHOLD_METERS
    if (geo.accuracy > maxGpsAccuracy) {
      return setMessage(
        selectedCustomerId === 'new'
          ? `GPS accuracy must be under ${GPS_THRESHOLD_NEW_LEAD_METERS}m for a new lead. Current: ${Math.round(geo.accuracy)}m`
          : `GPS accuracy must be under ${GPS_THRESHOLD_METERS}m for an existing customer. Current: ${Math.round(geo.accuracy)}m`,
      )
    }
    if (!photoFile) return setMessage('Take a mandatory photo using the camera (gallery upload is not allowed).')
    if (!photoHasEmbeddedWatermark || !photoPreview.startsWith('data:image')) {
      return setMessage('Use Open camera and Capture photo. Images must come from the live camera with timestamp and location on the picture.')
    }
    if (!notes.trim()) return setMessage('Meeting notes are required.')

    let customerName = ''
    let customerId = selectedCustomerId
    let selectedCustomer: Customer | undefined

    if (selectedCustomerId === 'new') {
      if (!quickLeadName.trim() || !quickLeadPhone.trim()) return setMessage('Quick lead needs at least name and phone.')
      const newCustomer: Customer = {
        id: `c-${Date.now()}`,
        name: quickLeadName.trim(),
        phone: quickLeadPhone.trim(),
        whatsapp: quickLeadWhatsapp.trim() || quickLeadPhone.trim(),
        address: quickLeadAddress.trim() || 'Address pending',
        city: quickLeadCity.trim() || 'Unknown',
        tags: quickLeadTags.split(',').map((item) => item.trim()).filter(Boolean),
        assignedSalesmanId: activeSalesman.id,
        lat: geo.lat,
        lng: geo.lng,
      }
      customerName = newCustomer.name
      customerId = newCustomer.id
      selectedCustomer = newCustomer
      setCustomers((previous) => [newCustomer, ...previous])
      if (supabase && online) {
        const { error } = await supabase.from('customers').upsert({
          id: newCustomer.id,
          name: newCustomer.name,
          phone: newCustomer.phone,
          whatsapp: newCustomer.whatsapp,
          address: newCustomer.address,
          city: newCustomer.city,
          tags: newCustomer.tags,
          assigned_salesman_id: newCustomer.assignedSalesmanId,
          lat: newCustomer.lat,
          lng: newCustomer.lng,
        })
        if (error) return setMessage(`Customer save failed: ${error.message}`)
      }
    } else {
      selectedCustomer = customers.find((item) => item.id === selectedCustomerId)
      if (!selectedCustomer) return setMessage('Customer not found.')
      customerName = selectedCustomer.name
    }

    if (selectedCustomer && selectedCustomerId !== 'new') {
      const radius = distanceMeters(geo.lat, geo.lng, selectedCustomer.lat, selectedCustomer.lng)
      if (radius > RADIUS_THRESHOLD_METERS) {
        return setMessage(`Outside ${RADIUS_THRESHOLD_METERS}m radius. Current distance: ${Math.round(radius)}m`)
      }
    }

    const watermarkedPhoto = photoPreview
    const visitId = `v-${Date.now()}`
    const capturedAt = geo.capturedAt
    let photoPath = watermarkedPhoto

    if (supabase && online) {
      try {
        photoPath = await uploadVisitPhoto(visitId, watermarkedPhoto)
      } catch (error) {
        return setMessage(`Photo upload failed: ${(error as Error).message}`)
      }
    }

    const payload: VisitRecord = {
      id: visitId,
      customerId,
      customerName,
      salesmanId: activeSalesman.id,
      salesmanName: activeSalesman.name,
      lat: geo.lat,
      lng: geo.lng,
      accuracy: geo.accuracy,
      capturedAt,
      photoDataUrl: photoPath,
      visitType,
      notes: notes.trim(),
      nextAction: nextAction.trim(),
      followUpDate: followUpDate || undefined,
      status: online ? 'synced' : 'queued',
      maxGpsAccuracyMeters: maxGpsAccuracy,
    }

    setVisits((previous) => [payload, ...previous])
    setMeetingResponses((previous) => [
      { id: `m-${Date.now()}`, customerName, salesmanName: activeSalesman.name, response: notes.trim(), createdAt: capturedAt },
      ...previous,
    ])
    if (followUpDate) {
      const nextFollowUp: FollowUp = {
        id: `f-${Date.now()}`,
        customerId,
        dueDate: followUpDate,
        priority: 'medium',
        status: 'pending',
        remarks: nextAction.trim() || 'Follow-up from visit',
        salesmanId: activeSalesman.id,
      }
      setFollowUps((previous) => [nextFollowUp, ...previous])
      if (supabase && online) {
        const { error } = await supabase.from('followups').upsert({
          id: nextFollowUp.id,
          customer_id: nextFollowUp.customerId,
          salesman_id: nextFollowUp.salesmanId,
          due_date: nextFollowUp.dueDate,
          priority: nextFollowUp.priority,
          status: nextFollowUp.status,
          remarks: nextFollowUp.remarks,
        })
        if (error) setMessage(`Follow-up save warning: ${error.message}`)
      }
    }

    if (supabase && online) {
      const { error } = await supabase.rpc('create_visit_enforced', {
        p_customer_id: payload.customerId,
        p_salesman_id: payload.salesmanId,
        p_visit_type: payload.visitType,
        p_captured_at: payload.capturedAt,
        p_lat: payload.lat,
        p_lng: payload.lng,
        p_accuracy_meters: payload.accuracy,
        p_max_gps_accuracy_meters: payload.maxGpsAccuracyMeters ?? GPS_THRESHOLD_METERS,
        p_photo_path: payload.photoDataUrl,
        p_notes: payload.notes,
        p_next_action: payload.nextAction || null,
        p_follow_up_date: payload.followUpDate || null,
      })
      if (error) {
        setVisits((previous) => previous.filter((v) => v.id !== payload.id))
        return setMessage(`Visit rejected by server: ${error.message}`)
      }
    }

    setGeo(null)
    setSelectedCustomerId('new')
    setQuickLeadName('')
    setQuickLeadPhone('')
    setQuickLeadWhatsapp('')
    setQuickLeadAddress('')
    setQuickLeadCity('')
    setQuickLeadTags('')
    setVisitType('New lead')
    setNotes('')
    setNextAction('')
    setFollowUpDate('')
    setPhotoFile(null)
    setPhotoPreview('')
    setPhotoHasEmbeddedWatermark(false)
    stopVisitCamera()
    setMessage(online ? 'Visit saved and synced.' : 'Visit saved offline. Sync later with same captured time.')
  }

  const syncQueued = async () => {
    if (!online) return setMessage('You are offline. Connect internet to sync queued visits.')
    if (!supabase) return setMessage('Supabase is not configured. Add .env.local to enable live sync.')

    const queued = visits.filter((item) => item.status === 'queued')
    if (!queued.length) return setMessage('No queued visits.')
    setSyncing(true)

    for (const visit of queued) {
      const { error } = await supabase.rpc('create_visit_enforced', {
        p_customer_id: visit.customerId,
        p_salesman_id: visit.salesmanId,
        p_visit_type: visit.visitType,
        p_captured_at: visit.capturedAt,
        p_lat: visit.lat,
        p_lng: visit.lng,
        p_accuracy_meters: visit.accuracy,
        p_max_gps_accuracy_meters: visit.maxGpsAccuracyMeters ?? GPS_THRESHOLD_METERS,
        p_photo_path: visit.photoDataUrl,
        p_notes: visit.notes,
        p_next_action: visit.nextAction || null,
        p_follow_up_date: visit.followUpDate || null,
      })
      if (!error) {
        setVisits((previous) => previous.map((item) => (item.id === visit.id ? { ...item, status: 'synced' } : item)))
      }
    }
    setSyncing(false)
    setMessage('Queued visits sync attempt completed.')
  }

  const visitFormCard = (
    <article className="card visitFormCard">
      <h3>Record visit</h3>
      {!salesmen.length ? (
        <p className="muted visit-camera-warn">
          Invite at least one <strong>salesman</strong> or <strong>super-salesman</strong> in <strong>Settings</strong> before
          recording visits.
        </p>
      ) : null}
      <p className="muted">
        <strong>1.</strong> Mark your visit location. <strong>Existing customer:</strong> GPS uncertainty must be ≤{' '}
        {GPS_THRESHOLD_METERS}m and you must be within {RADIUS_THRESHOLD_METERS}m of their pin. <strong>New lead:</strong>{' '}
        GPS uncertainty can be up to {GPS_THRESHOLD_NEW_LEAD_METERS}m (no prior pin to match). Laptops often report
        30–100m; phones work better in the field.
      </p>
      <div className="inlineActions">
        <button type="button" onClick={markVisitLocation} disabled={locationLocking}>
          {locationLocking ? 'Getting location…' : 'Mark visit location'}
        </button>
        {locationLocking ? (
          <button type="button" className="secondary" onClick={cancelMarkLocation}>
            Cancel
          </button>
        ) : null}
      </div>
      {locationLocking ? (
        <p className="muted">
          Requesting location (usually under 20s). If this never finishes, tap <strong>Cancel</strong> and check site
          permissions (HTTPS required except on localhost).
        </p>
      ) : null}
      {geo && !locationLocking ? (
        <p className="muted">
          Locked {new Date(geo.capturedAt).toLocaleString()} | {geo.lat.toFixed(6)}, {geo.lng.toFixed(6)} | ±
          {Math.round(geo.accuracy)}m
        </p>
      ) : null}

      <div className="formGrid">
        <label>
          Customer
          <select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)}>
            <option value="new">+ Quick create new lead</option>
            {customers.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        {selectedCustomerId === 'new' ? (
          <>
            <label>
              Lead name
              <input value={quickLeadName} onChange={(event) => setQuickLeadName(event.target.value)} />
            </label>
            <label>
              Phone
              <input value={quickLeadPhone} onChange={(event) => setQuickLeadPhone(event.target.value)} />
            </label>
            <label>
              WhatsApp
              <input value={quickLeadWhatsapp} onChange={(event) => setQuickLeadWhatsapp(event.target.value)} />
            </label>
            <label>
              Address
              <input value={quickLeadAddress} onChange={(event) => setQuickLeadAddress(event.target.value)} />
            </label>
            <label>
              City / area
              <input value={quickLeadCity} onChange={(event) => setQuickLeadCity(event.target.value)} />
            </label>
            <label>
              Tags (comma separated)
              <input value={quickLeadTags} onChange={(event) => setQuickLeadTags(event.target.value)} />
            </label>
          </>
        ) : null}

        <label>
          Visit type
          <select value={visitType} onChange={(event) => setVisitType(event.target.value as VisitType)}>
            {VISIT_TYPES.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label>
          Notes
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>

        <label>
          Next action
          <textarea value={nextAction} onChange={(event) => setNextAction(event.target.value)} />
        </label>

        <label>
          Follow-up date
          <input type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} />
        </label>
      </div>

      <div className="visit-camera-block">
        <h4 className="visit-camera-title">
          <strong>2.</strong> Mandatory photo (camera only)
        </h4>
        <p className="muted">
          One step: open the camera, then capture. The image is saved with timestamp and your marked GPS on it. Gallery is
          not used. After a shot you can <strong>Retake</strong> or <strong>Save visit</strong> below.
        </p>
        {!geo ? <p className="muted visit-camera-warn">Mark visit location above before opening the camera.</p> : null}
        <video
          ref={visitVideoRef}
          className="visit-camera-video"
          playsInline
          muted
          autoPlay
          style={{ display: visitCameraOn ? 'block' : 'none' }}
        />
        {!photoPreview && !visitCameraOn ? (
          <div className="visit-camera-actions">
            <button
              type="button"
              className="visit-camera-primary"
              disabled={!geo || locationLocking}
              onClick={() => void startVisitCamera()}
            >
              Open camera
            </button>
          </div>
        ) : null}
        {visitCameraOn ? (
          <div className="visit-camera-capture-wrap">
            <button type="button" className="capture-photo-btn" onClick={() => void captureVisitPhoto()}>
              Capture photo
            </button>
            <p className="muted capture-hint">Tap once when ready — the photo is saved; you can retake if needed.</p>
          </div>
        ) : null}
        {photoPreview && !visitCameraOn ? (
          <div className="visit-camera-actions">
            <button type="button" className="secondary visit-camera-primary" onClick={() => void retakeVisitPhoto()}>
              Retake
            </button>
          </div>
        ) : null}
      </div>

      {photoPreview ? <img src={photoPreview} alt="Saved visit photo" className="photoPreview" /> : null}

      <div className="inlineActions">
        <button type="button" onClick={() => void saveVisit()}>
          Save visit
        </button>
      </div>
    </article>
  )

  const mainContent = (() => {
    switch (activeView) {
      case 'dashboard':
        return (
          <section className="panel">
            <h2>Dashboard</h2>
            <div className="grid two">
              <article className="card">
                <h3>Summary</h3>
                <p className="muted">Customers: {customers.length}</p>
                <p className="muted">Open follow-ups: {followUps.filter((f) => f.status !== 'closed').length}</p>
                <p className="muted">Visits logged: {visits.length}</p>
                <p className="muted">Queued offline visits: {queuedVisitCount}</p>
              </article>
              <article className="card">
                <h3>Quick links</h3>
                <div className="inlineActions">
                  <button type="button" className="secondary" onClick={() => setActiveView('map')}>
                    Open map
                  </button>
                  <button type="button" className="secondary" onClick={() => setActiveView('visits')}>
                    Visit history
                  </button>
                  {NAV_ITEMS.find((i) => i.id === 'add_visit')?.show(role) ? (
                    <button type="button" onClick={() => setActiveView('add_visit')}>
                      Add visit
                    </button>
                  ) : null}
                </div>
              </article>
            </div>
          </section>
        )
      case 'map':
        return (
          <section className="panel">
            <h2>Map</h2>
            <p className="muted">
              Each salesman has a consistent color on customer pins, live pings, and recent visit dots. Unassigned
              customers use gray.
            </p>
            {salesmen.length ? (
              <div className="mapColorKey">
                {salesmen.map((s) => (
                  <span key={s.id} className="mapColorKeyItem">
                    <i
                      className="mapColorSwatch"
                      style={{ background: colorForSalesmanId(mapColorBySalesmanId, s.id) }}
                      aria-hidden
                    />
                    {s.name}
                  </span>
                ))}
              </div>
            ) : null}
            <DealerMap
              customers={mapCustomers.map((c) => ({
                id: c.id,
                name: c.name,
                city: c.city,
                lat: c.lat,
                lng: c.lng,
                assignedSalesmanId: c.assignedSalesmanId,
                salesmanName: salesmen.find((x) => x.id === c.assignedSalesmanId)?.name,
              }))}
              livePoints={mapLivePoints}
              recentVisits={mapRecentVisits}
              salesmen={salesmen}
            />
          </section>
        )
      case 'add_visit':
        return (
          <section className="panel">
            <h2>Add visit</h2>
            <div className="grid single">{visitFormCard}</div>
          </section>
        )
      case 'admin_overdue':
        return (
          <section className="panel">
            <h2>Overdue follow-ups</h2>
            <article className="card">
              <table>
                <thead>
                  <tr>
                    <th>Salesman</th>
                    <th>Overdue count</th>
                    <th>Due tasks</th>
                  </tr>
                </thead>
                <tbody>
                  {overdueBySalesman.map(({ salesman, overdue }) => (
                    <tr key={salesman.id}>
                      <td>{salesman.name}</td>
                      <td>{overdue.length}</td>
                      <td>{overdue.map((item) => item.dueDate).join(', ') || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          </section>
        )
      case 'admin_meetings':
        return (
          <section className="panel">
            <h2>Meeting responses</h2>
            <article className="card">
              <div className="scrollArea">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Salesman</th>
                      <th>Customer</th>
                      <th>Response</th>
                    </tr>
                  </thead>
                  <tbody>
                    {meetingResponses.slice(0, 50).map((item) => (
                      <tr key={item.id}>
                        <td>{new Date(item.createdAt).toLocaleString()}</td>
                        <td>{item.salesmanName}</td>
                        <td>{item.customerName}</td>
                        <td>{item.response}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        )
      case 'settings':
        return (
          <section className="panel">
            <h2>Settings</h2>

            <article className="card">
              <h3>Account</h3>
              <p className="muted">
                Signed in with Google. Your role comes from the invite list. There is no password — use the same Google
                account as the invited email.
              </p>
              {authSession?.user?.email ? (
                <p>
                  <strong>Email:</strong> {authSession.user.email}
                </p>
              ) : null}
              <p>
                <strong>Role:</strong> {role.replace(/_/g, ' ')}
              </p>
              <div className="inlineActions">
                {supabaseEnabled && authSession ? (
                  <button type="button" className="secondary" onClick={() => void handleSignOut()}>
                    Log out
                  </button>
                ) : null}
              </div>
            </article>

            {addableTeamRoles.length ? (
              <article className="card">
                <h3>Add user (invite)</h3>
                <p className="muted">
                  Enter the person&apos;s email and role. They must sign in with <strong>Google using that exact email</strong>{' '}
                  (no password field). <strong>Owner</strong> can invite salesman, sub-admin, super-salesman.{' '}
                  <strong>Sub-admin</strong> can invite salesman and super-salesman. <strong>Super-salesman</strong> can
                  invite salesman.
                </p>
                <div className="formGrid">
                  <label>
                    Email
                    <input
                      type="email"
                      autoComplete="email"
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="name@company.com"
                    />
                  </label>
                  <label>
                    Role
                    <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as Role)}>
                      {addableTeamRoles.map((r) => (
                        <option value={r} key={r}>
                          {r.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="inlineActions">
                  <button type="button" onClick={addInvitedUser}>
                    Add invited user
                  </button>
                </div>
              </article>
            ) : null}

            <article className="card">
              <h3>Invited emails ({invitedUsers.length})</h3>
              <p className="muted">Only these Google accounts can sign in (when using Supabase + Google).</p>
              <div className="scrollArea">
                <table>
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Added</th>
                      {role === 'owner' ? <th /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {invitedUsers.length === 0 ? (
                      <tr>
                        <td colSpan={role === 'owner' ? 4 : 3} className="muted">
                          No invites yet. First Google sign-in with an empty list becomes owner automatically.
                        </td>
                      </tr>
                    ) : (
                      invitedUsers
                        .slice()
                        .sort((a, b) => a.email.localeCompare(b.email))
                        .map((u) => (
                          <tr key={u.email}>
                            <td>{u.email}</td>
                            <td>{u.role.replace(/_/g, ' ')}</td>
                            <td className="muted" style={{ fontSize: '0.78rem' }}>
                              {new Date(u.addedAt).toLocaleString()}
                            </td>
                            {role === 'owner' ? (
                              <td>
                                <button type="button" className="secondary" onClick={() => removeInvitedUser(u.email)}>
                                  Remove
                                </button>
                              </td>
                            ) : null}
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="card">
              <h3>Profiles (synced)</h3>
              <div className="scrollArea">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Role</th>
                      <th>Id</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamProfiles.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="muted">
                          No profiles loaded yet. Data loads from Supabase after sign-in.
                        </td>
                      </tr>
                    ) : (
                      teamProfiles
                        .slice()
                        .sort((a, b) => a.fullName.localeCompare(b.fullName))
                        .map((p) => (
                          <tr key={p.id}>
                            <td>{p.fullName}</td>
                            <td>{p.role.replace(/_/g, ' ')}</td>
                            <td className="muted" style={{ fontSize: '0.78rem' }}>
                              {p.id}
                            </td>
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        )
      case 'admin_kpi':
        return (
          <section className="panel">
            <h2>KPI table</h2>
            <article className="card">
              <div className="rowBetween">
                <h3>Filters</h3>
                <div className="inlineFilters">
                  <input type="date" value={kpiDateFilter} onChange={(event) => setKpiDateFilter(event.target.value)} />
                  <select value={kpiSalesmanFilter} onChange={(event) => setKpiSalesmanFilter(event.target.value)}>
                    <option value="all">All salesmen</option>
                    {salesmen.map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="scrollArea">
                <table>
                  <thead>
                    <tr>
                      <th>Salesman</th>
                      <th>Date</th>
                      <th>Total working hrs</th>
                      <th>Last − first visit</th>
                      <th>Visits</th>
                      <th>Start</th>
                      <th>End</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredKpiRows.map((item) => (
                      <tr key={`${item.salesmanId}-${item.date}`}>
                        <td>{item.salesmanName}</td>
                        <td>{item.date}</td>
                        <td>{item.totalWorkingHours}</td>
                        <td>
                          {item.lastVisitTime} − {item.firstVisitTime}
                        </td>
                        <td>{item.visitCount}</td>
                        <td>{item.startTime}</td>
                        <td>{item.endTime}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        )
      case 'field_followups':
        return (
          <section className="panel">
            <h2>Pending follow-ups</h2>
            <article className="card">
              <ul className="list">
                {pendingFollowUpsForSalesman.map((item) => {
                  const customer = customers.find((entry) => entry.id === item.customerId)
                  return (
                    <li key={item.id}>
                      <div>
                        <strong>{customer?.name ?? 'Unknown customer'}</strong> — due {item.dueDate}
                        <p className="muted">{item.remarks}</p>
                      </div>
                      <span className={`statusTag ${item.priority === 'high' ? 'warning' : ''}`}>{item.priority}</span>
                    </li>
                  )
                })}
              </ul>
            </article>
          </section>
        )
      case 'field_tracking':
        return (
          <section className="panel">
            <h2>Live tracking</h2>
            <article className="card">
              <div className="inlineActions">
                <button type="button" onClick={startLiveTracking}>
                  Start tracking
                </button>
                <button type="button" className="secondary" onClick={stopLiveTracking}>
                  Stop tracking
                </button>
                <button type="button" className="secondary" onClick={() => void syncQueued()} disabled={syncing}>
                  {syncing ? 'Syncing…' : 'Sync offline visits'}
                </button>
              </div>
              <p className="muted">Latest pings (newest first):</p>
              <ul className="miniList">
                {mapLivePoints.slice(0, 8).map((point, index) => (
                  <li key={`${point.time}-${index}`}>
                    {new Date(point.time).toLocaleTimeString()} | {point.lat.toFixed(5)}, {point.lng.toFixed(5)} (±
                    {Math.round(point.accuracy)}m)
                  </li>
                ))}
              </ul>
            </article>
          </section>
        )
      case 'field_customers':
        return (
          <section className="panel">
            <h2>My customers</h2>
            <article className="card">
              <ul className="list">
                {customers
                  .filter((item) => item.assignedSalesmanId === activeSalesman.id)
                  .map((item) => (
                    <li key={item.id}>
                      <div>
                        <strong>{item.name}</strong> — {item.city}
                        <p className="muted">
                          {item.phone} | Tags: {item.tags.join(', ') || '—'}
                        </p>
                      </div>
                      <button type="button" className="secondary" onClick={() => setActiveView('map')}>
                        Show on map
                      </button>
                    </li>
                  ))}
              </ul>
            </article>
          </section>
        )
      case 'visits':
        return (
          <section className="panel">
            <h2>Visit history</h2>
            <article className="card">
              <div className="scrollArea">
                <table>
                  <thead>
                    <tr>
                      <th>Captured</th>
                      <th>Salesman</th>
                      <th>Customer</th>
                      <th>Type</th>
                      <th>GPS</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visitHistoryRows.map((visit) => (
                      <tr key={visit.id}>
                        <td>{new Date(visit.capturedAt).toLocaleString()}</td>
                        <td>{visit.salesmanName}</td>
                        <td>{visit.customerName}</td>
                        <td>{visit.visitType}</td>
                        <td>
                          {visit.lat.toFixed(4)}, {visit.lng.toFixed(4)} (±{Math.round(visit.accuracy)}m)
                        </td>
                        <td>{visit.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        )
      default:
        return null
    }
  })()

  const showMainApp = Boolean(supabaseEnabled && authSession)
  if (supabaseEnabled && !authHydrated) {
    return (
      <div className="authBootScreen">
        <p className="muted">Checking session…</p>
      </div>
    )
  }
  if (!showMainApp) {
    return (
      <LoginScreen
        supabaseConfigured={supabaseEnabled}
        message={loginMessage}
        onGoogleSignIn={() => void signInWithGoogle()}
      />
    )
  }

  const showLogOut = Boolean(supabaseEnabled && authSession)

  return (
    <div className={`appShell${mobileNavOpen ? ' appShell--navOpen' : ''}`}>
      {mobileNavOpen ? (
        <button
          type="button"
          className="sidebarBackdrop"
          aria-label="Close menu"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <aside
        id="app-sidebar"
        className={`sidebar${mobileNavOpen ? ' sidebar--open' : ''}`}
        aria-label="Main navigation"
      >
        <div className="sidebarBrand">
          <h1>Field Sales</h1>
          <p>Visits, tracking &amp; CRM</p>
        </div>
        <nav className="sidebarNav" aria-label="Sections">
          {navGrouped.map(([section, items]) => (
            <div key={section}>
              <div className="navSectionLabel">{section}</div>
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`navItem${activeView === item.id ? ' active' : ''}`}
                  onClick={() => {
                    setActiveView(item.id)
                    setMobileNavOpen(false)
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        {showLogOut ? (
          <div className="sidebarFooter">
            <button type="button" className="secondary sidebarLogoutBtn" onClick={() => void handleSignOut()}>
              Log out
            </button>
          </div>
        ) : null}
      </aside>

      <div className="mainArea">
        <header className="topBar">
          <div className="topBarLead">
            <button
              type="button"
              className="menuToggle"
              aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileNavOpen}
              aria-controls="app-sidebar"
              onClick={() => setMobileNavOpen((open) => !open)}
            >
              <span className="menuToggleIcon" aria-hidden />
            </button>
            <div className="topBarTitles">
              <h1 className="topBarTitle">Field Salesman</h1>
              <p className="muted topBarSubtitle">{activeViewLabel}</p>
            </div>
          </div>

          <div className="topControls">
            {authSession?.user?.email ? (
              <span className="topUserEmail" title="Signed in with Google">
                {authSession.user.email}
              </span>
            ) : null}
            <span className={online ? 'statusTag ok' : 'statusTag warning'}>{online ? 'Online' : 'Offline'}</span>
            <span className={`statusTag supabaseTag${supabaseEnabled ? ' ok' : ' warning'}`}>
              {supabaseEnabled ? 'Supabase' : 'Local'}
            </span>
            <span className="statusTag queueTag">Q:{queuedVisitCount}</span>
            {showLogOut ? (
              <button type="button" className="secondary topLogoutBtn" onClick={() => void handleSignOut()}>
                Log out
              </button>
            ) : null}
          </div>
        </header>

        <div className="contentArea">
          {message ? <p className="message">{message}</p> : null}
          {mainContent}
        </div>
      </div>
    </div>
  )
}

export default App
