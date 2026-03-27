import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { LoginScreen } from './components/LoginScreen'
import { findInviteForEmail, normalizeEmail, type InvitedUser } from './lib/invites'
import { addableRolesFor, type Role } from './lib/roles'
import { formatSignInError } from './lib/authMessages'
import { isValidPassword, PASSWORD_POLICY_HINT } from './lib/passwordPolicy'
import { supabase, supabaseEnabled } from './lib/supabase'
import { colorForSalesmanId, salesmanColorMap } from './mapColors'
import { googleMapsSearchUrl } from './lib/maps'

const DealerMap = lazy(async () => {
  const module = await import('./components/DealerMap')
  return { default: module.DealerMap }
})

async function resolveVisitPhotoSrc(client: SupabaseClient, stored: string): Promise<string | null> {
  const t = stored.trim()
  if (!t) return null
  if (t.startsWith('data:') || /^https?:\/\//i.test(t)) return t
  const { data, error } = await client.storage.from('visit-photos').createSignedUrl(t, 3600)
  if (error || !data?.signedUrl) {
    console.warn('visit photo signed URL:', error?.message)
    return null
  }
  return data.signedUrl
}

type TeamProfile = { id: string; fullName: string; role: Role; email?: string; phone?: string }
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
  /** When the rep tapped Start visit at arrival; `capturedAt` is end/leave (photo) time. */
  visitStartedAt?: string
}

type VisitSession = {
  startGeo: { lat: number; lng: number; accuracy: number; capturedAt: string }
  selectedCustomerId: string
  visitType: VisitType
  quickLead: {
    name: string
    phone: string
    address: string
  }
}
type MeetingResponse = {
  id: string
  customerName: string
  salesmanName: string
  response: string
  createdAt: string
  visitId?: string
}
type LivePoint = { lat: number; lng: number; accuracy: number; time: string; salesmanId?: string }
type KpiRow = {
  salesmanId: string
  salesmanName: string
  date: string
  totalWorkingHours: string
  firstVisitTime: string
  lastVisitTime: string
  visitCount: number
}
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
  { id: 'dashboard', label: 'Dashboard', section: 'Overview', show: (r) => r !== 'salesman' },
  { id: 'map', label: 'Map', section: 'Overview', show: () => true },
  {
    id: 'add_visit',
    label: 'Add visit',
    section: 'Field',
    show: (r) => r === 'salesman' || r === 'super_salesman',
  },
  { id: 'field_followups', label: 'Pending follow-ups', section: 'Field', show: (r) => r === 'salesman' || r === 'super_salesman' },
  { id: 'field_tracking', label: 'Live tracking', section: 'Field', show: (r) => r === 'super_salesman' },
  { id: 'field_customers', label: 'My customers', section: 'Field', show: (r) => r === 'salesman' || r === 'super_salesman' },
  { id: 'admin_overdue', label: 'Overdue follow-ups', section: 'Admin', show: (r) => r !== 'salesman' },
  { id: 'admin_meetings', label: 'Meeting responses', section: 'Admin', show: (r) => r !== 'salesman' },
  { id: 'admin_kpi', label: 'KPI table', section: 'Admin', show: (r) => r !== 'salesman' },
  { id: 'settings', label: 'Settings', section: 'Account', show: () => true },
  { id: 'visits', label: 'Visit history', section: 'Overview', show: () => true },
]

function isNavId(id: string): id is NavId {
  return NAV_ITEMS.some((item) => item.id === id)
}

function parseNavFromLocation(): NavId {
  if (typeof window === 'undefined') return 'field_followups'
  const raw = window.location.hash.replace(/^#\/?/, '').trim()
  if (raw && isNavId(raw)) return raw
  try {
    const s = sessionStorage.getItem('fs_active_view')
    if (s && isNavId(s)) return s
  } catch {
    /* private mode */
  }
  return 'field_followups'
}

function syncNavToLocation(view: NavId) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem('fs_active_view', view)
  } catch {
    /* ignore */
  }
  const nextHash = view === 'dashboard' ? '' : `#${view}`
  const base = `${window.location.pathname}${window.location.search}`
  const current = `${base}${window.location.hash}`
  const target = nextHash ? `${base}${nextHash}` : base
  if (current !== target) window.history.replaceState(null, '', target)
}

/** Max reported GPS uncertainty allowed when visiting an existing customer (tight geo-fence). */
const GPS_THRESHOLD_METERS = 30
/** New leads have no prior map pin — allow looser GPS (phones often 30–80m). */
const GPS_THRESHOLD_NEW_LEAD_METERS = 80
/** Max distance from customer map pin for existing-customer visits (GPS accuracy still ≤ 30m). */
const RADIUS_THRESHOLD_METERS = 100
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

function kpiDateTimeLabel(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

function kpiFromVisits(visits: VisitRecord[], salesmen: Salesman[]): KpiRow[] {
  const grouped = new Map<string, VisitRecord[]>()
  for (const visit of visits) {
    const key = `${visit.salesmanId}-${dateString(visit.capturedAt)}`
    grouped.set(key, [...(grouped.get(key) ?? []), visit])
  }
  return [...grouped.entries()].map(([, rows]) => {
    const salesmanId = rows[0].salesmanId
    const date = dateString(rows[0].capturedAt)
    const sorted = rows.slice().sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
    const firstIso = sorted[0].capturedAt
    const lastIso = sorted[sorted.length - 1].capturedAt
    const salesmanName = salesmen.find((s) => s.id === salesmanId)?.name ?? rows[0].salesmanName
    return {
      salesmanId,
      salesmanName,
      date,
      totalWorkingHours: hoursBetween(firstIso, lastIso),
      firstVisitTime: kpiDateTimeLabel(firstIso),
      lastVisitTime: kpiDateTimeLabel(lastIso),
      visitCount: sorted.length,
    }
  }).sort((a, b) => b.date.localeCompare(a.date))
}

function App() {
  const [authSession, setAuthSession] = useState<Session | null>(null)
  const [authHydrated, setAuthHydrated] = useState(() => !supabaseEnabled)
  const [loginMessage, setLoginMessage] = useState('')
  const [loginMessageIsError, setLoginMessageIsError] = useState(false)

  const [teamProfiles, setTeamProfiles] = useState<TeamProfile[]>([])
  const [invitedUsers, setInvitedUsers] = useState<InvitedUser[]>([])

  useEffect(() => {
    localStorage.removeItem('fs_offline_demo')
  }, [])
  const [customers, setCustomers] = useState<Customer[]>(() => (supabaseEnabled ? [] : INITIAL_CUSTOMERS))
  const [followUps, setFollowUps] = useState<FollowUp[]>(() => (supabaseEnabled ? [] : INITIAL_FOLLOWUPS))
  const [visits, setVisits] = useState<VisitRecord[]>([])
  const [meetingResponses, setMeetingResponses] = useState<MeetingResponse[]>([])
  const [livePoints, setLivePoints] = useState<LivePoint[]>([])

  const scheduleWorkspaceReloadRef = useRef<(() => void) | null>(null)
  const [online, setOnline] = useState<boolean>(navigator.onLine)
  const [geo, setGeo] = useState<{ lat: number; lng: number; accuracy: number; capturedAt: string } | null>(null)
  const [selectedCustomerId, setSelectedCustomerId] = useState('new')
  const [quickLeadPhone, setQuickLeadPhone] = useState('')
  const [quickLeadAddress, setQuickLeadAddress] = useState('')
  const [visitCustomerSearch, setVisitCustomerSearch] = useState('')
  const [notes, setNotes] = useState('')
  const [nextAction, setNextAction] = useState('')
  const [followUpDate, setFollowUpDate] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState('')
  /** True when image was taken from live camera with timestamp+GPS already drawn on canvas */
  const [photoHasEmbeddedWatermark, setPhotoHasEmbeddedWatermark] = useState(false)
  const [savingVisit, setSavingVisit] = useState(false)
  const [visitCameraOn, setVisitCameraOn] = useState(false)
  const [visitPhotoModal, setVisitPhotoModal] = useState<{ src: string; caption: string } | null>(null)
  const [visitPhotoOpeningId, setVisitPhotoOpeningId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  /** Shown only on Settings; avoids a global banner after the invitee signs in. */
  const [inviteSuccessMessage, setInviteSuccessMessage] = useState('')
  const [kpiDateFilter, setKpiDateFilter] = useState('')
  const [kpiSalesmanFilter, setKpiSalesmanFilter] = useState('all')
  const [activeView, setActiveView] = useState<NavId>(parseNavFromLocation)
  const [inviteSourceReady, setInviteSourceReady] = useState(() => !supabaseEnabled)
  const watchIdRef = useRef<number | null>(null)
  const visitLocationTimeoutRef = useRef<number | null>(null)
  const locationRequestIdRef = useRef(0)
  const visitCameraStreamRef = useRef<MediaStream | null>(null)
  const visitVideoRef = useRef<HTMLVideoElement>(null)
  const [locationLocking, setLocationLocking] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [visitSession, setVisitSession] = useState<VisitSession | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [invitePhone, setInvitePhone] = useState('')
  /** Default per product spec: owner/sub-admin assign access with Owner pre-selected (still changeable). */
  const [inviteRole, setInviteRole] = useState<Role>('owner')
  const [invitePassword, setInvitePassword] = useState('')
  const [invitePasswordConfirm, setInvitePasswordConfirm] = useState('')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [settingsNewPassword, setSettingsNewPassword] = useState('')
  const [settingsConfirmPassword, setSettingsConfirmPassword] = useState('')
  const [settingsPasswordMessage, setSettingsPasswordMessage] = useState('')
  const [visitHistoryDateFilter, setVisitHistoryDateFilter] = useState('')
  const [visitHistorySalesmanFilter, setVisitHistorySalesmanFilter] = useState('all')
  const [visitHistoryClientFilter, setVisitHistoryClientFilter] = useState('')
  const [visitHistoryCityFilter, setVisitHistoryCityFilter] = useState('')
  const [mapSalesmanFilter, setMapSalesmanFilter] = useState('all')
  const [overdueSalesmanFilter, setOverdueSalesmanFilter] = useState('all')
  const [meetingDateFilter, setMeetingDateFilter] = useState('')
  const [meetingSalesmanFilter, setMeetingSalesmanFilter] = useState('all')
  const [salesmanFollowUpDateFilter, setSalesmanFollowUpDateFilter] = useState('')
  const [editingFollowUp, setEditingFollowUp] = useState<FollowUp | null>(null)

  const salesmen = useMemo(
    () =>
      teamProfiles
        .filter((p) => p.role === 'salesman' || p.role === 'super_salesman')
        .map((p) => ({ id: p.id, name: p.fullName })),
    [teamProfiles],
  )

  const accessAllowed = useMemo(() => {
    const email = authSession?.user?.email
    if (!email) return false
    if (findInviteForEmail(invitedUsers, email)) return true
    /** While invites are still loading from Supabase, keep the shell open; sign-out waits until `inviteSourceReady`. */
    if (supabaseEnabled && !inviteSourceReady) return true
    /** First sign-in while invite list is empty becomes owner (effect uses functional update; only one wins). */
    if (invitedUsers.length === 0) return true
    return false
  }, [authSession, invitedUsers, inviteSourceReady])

  const role = useMemo<Role>(() => {
    const email = authSession?.user?.email
    const uid = authSession?.user?.id
    if (!email) return 'salesman'
    const inv = findInviteForEmail(invitedUsers, email)
    if (inv?.role) return inv.role
    if (uid) {
      const prof = teamProfiles.find((p) => p.id === uid)
      if (prof?.role) return prof.role
    }
    return 'salesman'
  }, [authSession, invitedUsers, teamProfiles])

  const addableTeamRoles = useMemo(() => addableRolesFor(role), [role])
  const canInviteTeam = addableTeamRoles.length > 0
  const canSeeTeamDirectory = role === 'owner' || role === 'sub_admin' || role === 'super_salesman'
  const canRemoveInvites = role === 'owner'

  const allowedNavIds = useMemo(() => NAV_ITEMS.filter((item) => item.show(role)).map((item) => item.id), [role])

  useEffect(() => {
    if (!allowedNavIds.includes(activeView)) setActiveView(allowedNavIds[0] ?? 'dashboard')
  }, [allowedNavIds, activeView])

  useEffect(() => {
    if (activeView !== 'settings') setInviteSuccessMessage('')
  }, [activeView])

  useEffect(() => {
    syncNavToLocation(activeView)
  }, [activeView])

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
    const uid = authSession?.user?.id ?? ''
    if (role === 'salesman' || role === 'super_salesman') return uid
    /** Owner / sub-admin record visits under their own profile id (same as logged-in account). */
    if (role === 'owner' || role === 'sub_admin') return uid
    return salesmen[0]?.id ?? uid
  }, [role, salesmen, authSession?.user?.id])

  const activeSalesman = useMemo(() => {
    const fromField = salesmen.find((item) => item.id === activeSalesmanId)
    if (fromField) return fromField
    const selfProfile = teamProfiles.find((p) => p.id === activeSalesmanId)
    if (selfProfile) return { id: selfProfile.id, name: selfProfile.fullName }
    const uid = authSession?.user?.id ?? ''
    const email = authSession?.user?.email
    if (activeSalesmanId && (activeSalesmanId === uid || !salesmen.length)) {
      return { id: activeSalesmanId, name: email ?? 'You' }
    }
    return salesmen[0] ?? { id: uid, name: email ?? '—' }
  }, [activeSalesmanId, salesmen, teamProfiles, authSession?.user?.id, authSession?.user?.email])

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
    if (!sb) {
      setInviteSourceReady(true)
      return
    }
    if (!authSession?.user) {
      setInviteSourceReady(true)
      return
    }

    let cancelled = false
    setInviteSourceReady(false)

    void (async () => {
      try {
        const { data, error } = await sb.from('app_invites').select('email, role, added_at')
        if (cancelled) return
        if (error) {
          console.warn('app_invites:', error.message)
          setInviteSourceReady(true)
          return
        }
        const rows = (data ?? []) as { email: string; role: string; added_at: string }[]
        if (rows.length > 0) {
          setInvitedUsers(
            rows.map((r) => ({
              email: normalizeEmail(r.email),
              role: r.role as Role,
              addedAt: r.added_at,
            })),
          )
          return
        }
        const raw = localStorage.getItem('fs_invited_users')
        let local: InvitedUser[] = []
        try {
          local = raw ? (JSON.parse(raw) as InvitedUser[]) : []
        } catch {
          local = []
        }
        if (local.length > 0) {
          const payload = local.map((u) => ({
            email: normalizeEmail(u.email),
            role: u.role,
            added_at: u.addedAt,
          }))
          const { error: upErr } = await sb.from('app_invites').upsert(payload, { onConflict: 'email' })
          if (upErr) console.warn('app_invites migrate from localStorage:', upErr.message)
          if (!cancelled) {
            setInvitedUsers(
              local.map((u) => ({
                email: normalizeEmail(u.email),
                role: u.role,
                addedAt: u.addedAt,
              })),
            )
          }
        }
      } finally {
        if (!cancelled) setInviteSourceReady(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [authSession?.user, authSession?.user?.id])

  useEffect(() => {
    const sb = supabase
    if (!inviteSourceReady) return
    if (!sb || !authSession?.user?.email) return
    const email = authSession.user.email
    let cancelled = false

    void (async () => {
      const { data: allRows, error: fetchErr } = await sb
        .from('app_invites')
        .select('email, role, added_at')
        .order('added_at', { ascending: true })
      if (cancelled) return
      if (fetchErr) {
        console.warn('app_invites access check:', fetchErr.message)
        return
      }
      const mapped: InvitedUser[] = (allRows ?? []).map((r) => ({
        email: normalizeEmail(r.email as string),
        role: r.role as Role,
        addedAt: r.added_at as string,
      }))
      if (findInviteForEmail(mapped, email)) {
        setInvitedUsers(mapped)
        return
      }
      if (mapped.length === 0) {
        const norm = normalizeEmail(email)
        const addedAt = new Date().toISOString()
        const { error } = await sb.from('app_invites').upsert(
          { email: norm, role: 'owner', added_at: addedAt },
          { onConflict: 'email' },
        )
        if (error) console.warn('Bootstrap owner invite:', error.message)
        setInvitedUsers([{ email: norm, role: 'owner', addedAt }])
        return
      }
      void sb.auth.signOut()
      setLoginMessageIsError(true)
      setLoginMessage('You are not authorized. Only added members can sign in. Contact your admin.')
    })()

    return () => {
      cancelled = true
    }
  }, [authSession?.user, authSession?.user?.id, authSession?.user?.email, inviteSourceReady])

  useEffect(() => {
    if (!supabase || !authSession?.user) return
    const matched = findInviteForEmail(invitedUsers, authSession.user.email)
    if (!matched) return
    const displayName =
      (authSession.user.user_metadata?.full_name as string | undefined) || authSession.user.email || 'User'
    const accountPhone = String((authSession.user.user_metadata?.phone as string | undefined) ?? '').trim()
    const uid = authSession.user.id
    void (async () => {
      const accountEmail = normalizeEmail(authSession.user.email ?? '')
      const { data: existing } = await supabase.from('profiles').select('id').eq('id', uid).maybeSingle()
      if (!existing) {
        const { error } = await supabase.from('profiles').upsert(
          { id: uid, full_name: displayName, role: matched.role, email: accountEmail, phone: accountPhone || null },
          { onConflict: 'id' },
        )
        if (error) console.warn('Profile bootstrap:', error.message)
      } else {
        const { error } = await supabase
          .from('profiles')
          .update({ full_name: displayName, email: accountEmail, phone: accountPhone || null })
          .eq('id', uid)
        if (error) console.warn('Profile name update:', error.message)
      }
    })()
  }, [authSession?.user, authSession?.user?.id, authSession?.user?.email, invitedUsers])

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
    if (!inviteSourceReady) return
    if (!authSession?.user?.email) return
    if (!accessAllowed) return

    let closed = false
    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    const loadDomain = async () => {
      const [
        { data: inviteRows, error: invitesErr },
        { data: profileRows, error: profilesErr },
        { data: customerRows, error: customersErr },
        { data: followupRows, error: followupsErr },
        { data: visitRows, error: visitsErr },
        meetingResult,
        { data: liveRows, error: liveErr },
      ] = await Promise.all([
        sb.from('app_invites').select('email, role, added_at').order('added_at', { ascending: true }),
        sb.from('profiles').select('id, full_name, role, email, phone'),
        sb.from('customers').select('*').order('created_at', { ascending: false }),
        sb.from('followups').select('*').order('due_date', { ascending: true }),
        sb.from('visits').select('*').order('captured_at', { ascending: false }).limit(200),
        sb.from('meeting_responses').select('*').order('created_at', { ascending: false }).limit(100),
        sb.from('live_locations').select('*').order('captured_at', { ascending: false }).limit(200),
      ])
      if (closed) return
      if (invitesErr) console.warn('app_invites:', invitesErr.message)
      if (profilesErr) console.warn('profiles:', profilesErr.message)
      if (customersErr) console.warn('customers:', customersErr.message)
      if (followupsErr) console.warn('followups:', followupsErr.message)
      if (visitsErr) console.warn('visits:', visitsErr.message)
      if (meetingResult.error) console.warn('meeting_responses:', meetingResult.error.message)
      if (liveErr) console.warn('live_locations:', liveErr.message)

      const meetingRows = meetingResult.error ? [] : (meetingResult.data ?? [])
      const safeProfileRows = profilesErr ? [] : (profileRows ?? [])

      let inviteRowsForState = inviteRows ?? []
      if (!invitesErr && inviteRowsForState.length && safeProfileRows.length) {
        const emailToRole = new Map<string, string>()
        for (const p of safeProfileRows) {
          const raw = (p as { email?: string | null }).email
          if (raw && typeof raw === 'string') emailToRole.set(normalizeEmail(raw), p.role as string)
        }
        inviteRowsForState = [...inviteRowsForState]
        for (let i = 0; i < inviteRowsForState.length; i++) {
          const row = inviteRowsForState[i] as { email: string; role: string; added_at: string }
          const em = normalizeEmail(row.email)
          const want = emailToRole.get(em)
          if (want && want !== row.role) {
            const { error: upErr } = await sb.from('app_invites').update({ role: want }).eq('email', em)
            if (upErr) console.warn('reconcile invite role to profile:', upErr.message)
            else inviteRowsForState[i] = { ...row, role: want }
          }
        }
      }

      if (!invitesErr) {
        setInvitedUsers(
          inviteRowsForState.map((r) => ({
            email: normalizeEmail((r as { email: string }).email),
            role: (r as { role: string }).role as Role,
            addedAt: (r as { added_at: string }).added_at,
          })),
        )
      }

      const safeCustomerRows = customersErr ? [] : (customerRows ?? [])
      const safeFollowupRows = followupsErr ? [] : (followupRows ?? [])
      const safeVisitRows = visitsErr ? [] : (visitRows ?? [])
      const safeLiveRows = liveErr ? [] : (liveRows ?? [])

      const profileNameById = new Map<string, string>()
      setTeamProfiles(
        safeProfileRows.map((r) => {
          const name = (r.full_name as string) ?? 'User'
          profileNameById.set(r.id as string, name)
          const rawEmail = (r as { email?: string | null }).email
          const rawPhone = (r as { phone?: string | null }).phone
          return {
            id: r.id as string,
            fullName: name,
            role: (r.role as Role) ?? 'salesman',
            email: rawEmail && typeof rawEmail === 'string' ? normalizeEmail(rawEmail) : undefined,
            phone: rawPhone && typeof rawPhone === 'string' ? rawPhone : undefined,
          }
        }),
      )

      const customersMapped = safeCustomerRows.map((r) => ({
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
      }))
      setCustomers(customersMapped)

      const customerNameById = new Map(customersMapped.map((c) => [c.id, c.name]))

      setFollowUps(
        safeFollowupRows.map((r) => ({
          id: r.id as string,
          customerId: r.customer_id as string,
          dueDate: r.due_date as string,
          priority: r.priority as FollowUp['priority'],
          status: r.status as FollowUpStatus,
          remarks: (r.remarks as string) ?? '',
          salesmanId: r.salesman_id as string,
        })),
      )

      const fromServer: VisitRecord[] = safeVisitRows.map((r) => {
        const row = r as Record<string, unknown>
        const started = row.visit_started_at
        return {
          id: r.id as string,
          customerId: r.customer_id as string,
          customerName: customerNameById.get(r.customer_id as string) ?? 'Customer',
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
          status: 'synced' as const,
          visitStartedAt: typeof started === 'string' && started ? started : undefined,
        }
      })

      setVisits((previous) => {
        const queued = previous.filter((v) => v.status === 'queued')
        const serverIds = new Set(fromServer.map((v) => v.id))
        const merged = [...fromServer, ...queued.filter((q) => !serverIds.has(q.id))]
        const byId = new Map<string, VisitRecord>()
        for (const v of merged) {
          if (!byId.has(v.id)) byId.set(v.id, v)
        }
        const deduped = [...byId.values()]
        deduped.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
        return deduped
      })

      setMeetingResponses(
        (meetingRows ?? []).map((r) => ({
          id: r.id as string,
          customerName: r.customer_name as string,
          salesmanName: r.salesman_name as string,
          response: r.response as string,
          createdAt: r.created_at as string,
          visitId: (r.visit_id as string) ?? undefined,
        })),
      )

      setLivePoints(
        safeLiveRows.map((r) => ({
          lat: Number(r.lat),
          lng: Number(r.lng),
          accuracy: Number(r.accuracy_meters),
          time: r.captured_at as string,
          salesmanId: r.salesman_id as string,
        })),
      )
    }

    const scheduleReload = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        void loadDomain()
      }, 220)
    }

    scheduleWorkspaceReloadRef.current = scheduleReload

    void loadDomain()

    const realtimeTables = [
      'app_invites',
      'profiles',
      'customers',
      'followups',
      'visits',
      'meeting_responses',
      'live_locations',
    ] as const

    const channel = sb.channel('fs-domain-sync')
    for (const table of realtimeTables) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleReload)
    }

    const reloadOnOnline = () => scheduleReload()
    window.addEventListener('online', reloadOnOnline)
    const periodicReloadId = window.setInterval(() => {
      if (document.visibilityState === 'visible') scheduleReload()
    }, 15000)

    void channel.subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('Whiterock Field Salesman realtime:', status)
      }
    })

    return () => {
      closed = true
      scheduleWorkspaceReloadRef.current = null
      window.removeEventListener('online', reloadOnOnline)
      window.clearInterval(periodicReloadId)
      if (debounceTimer) clearTimeout(debounceTimer)
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current)
      void sb.removeChannel(channel)
    }
  }, [authSession?.user, authSession?.user?.id, authSession?.user?.email, inviteSourceReady, accessAllowed, invitedUsers.length])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') scheduleWorkspaceReloadRef.current?.()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current)
    }
  }, [])

  const pendingFollowUpsForSalesman = useMemo(
    () => followUps.filter((item) => item.salesmanId === activeSalesman.id && item.status !== 'closed').sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [activeSalesman.id, followUps],
  )
  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers])
  const visitById = useMemo(() => new Map(visits.map((v) => [v.id, v])), [visits])
  const latestVisitByCustomerId = useMemo(() => {
    const map = new Map<string, VisitRecord>()
    for (const v of visits) {
      const current = map.get(v.customerId)
      if (!current || v.capturedAt > current.capturedAt) map.set(v.customerId, v)
    }
    return map
  }, [visits])
  const overdueRowsDetailed = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    return followUps
      .filter((item) => item.status !== 'closed' && item.dueDate < today)
      .map((item) => {
        const customer = customerById.get(item.customerId)
        const lastVisit = latestVisitByCustomerId.get(item.customerId)
        const salesmanName = salesmen.find((s) => s.id === item.salesmanId)?.name ?? 'Salesman'
        return {
          ...item,
          salesmanName,
          customerName: customer?.name ?? 'Unknown customer',
          customerCity: customer?.city ?? '—',
          customerPhone: customer?.phone ?? '—',
          lastVisitType: lastVisit?.visitType ?? '—',
          lastVisitAt: lastVisit?.capturedAt ?? '',
          lastVisitNotes: lastVisit?.notes ?? '',
        }
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  }, [followUps, customerById, latestVisitByCustomerId, salesmen])
  const filteredOverdueRowsDetailed = useMemo(
    () =>
      overdueRowsDetailed.filter((row) =>
        overdueSalesmanFilter === 'all' ? true : row.salesmanId === overdueSalesmanFilter,
      ),
    [overdueRowsDetailed, overdueSalesmanFilter],
  )
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const followUpsDueTodayForSalesman = useMemo(
    () => pendingFollowUpsForSalesman.filter((item) => item.dueDate === todayIso),
    [pendingFollowUpsForSalesman, todayIso],
  )
  const overdueFollowUpsForSalesman = useMemo(
    () => pendingFollowUpsForSalesman.filter((item) => item.dueDate < todayIso),
    [pendingFollowUpsForSalesman, todayIso],
  )
  const filteredPendingFollowUpsForSalesman = useMemo(
    () =>
      pendingFollowUpsForSalesman.filter((item) =>
        salesmanFollowUpDateFilter ? item.dueDate === salesmanFollowUpDateFilter : true,
      ),
    [pendingFollowUpsForSalesman, salesmanFollowUpDateFilter],
  )
  const kpiRows = useMemo(() => kpiFromVisits(visits, salesmen), [visits, salesmen])
  const filteredKpiRows = useMemo(
    () => kpiRows.filter((row) => (!kpiDateFilter || row.date === kpiDateFilter) && (kpiSalesmanFilter === 'all' || row.salesmanId === kpiSalesmanFilter)),
    [kpiDateFilter, kpiRows, kpiSalesmanFilter],
  )

  const dedupedCustomers = useMemo(() => {
    const seen = new Map<string, Customer>()
    for (const c of customers) {
      if (!seen.has(c.id)) seen.set(c.id, c)
    }
    return [...seen.values()]
  }, [customers])

  const myCustomers = useMemo(() => {
    if (role === 'salesman' || role === 'super_salesman') {
      const mine = dedupedCustomers.filter((c) => c.assignedSalesmanId === activeSalesman.id)
      return mine.length ? mine : dedupedCustomers
    }
    return dedupedCustomers
  }, [role, dedupedCustomers, activeSalesman.id])

  const filteredCustomerSuggestions = useMemo(() => {
    const q = visitCustomerSearch.trim().toLowerCase()
    return dedupedCustomers
      .filter((item) => {
        if (!q) return true
        return (
          item.name.toLowerCase().includes(q) ||
          item.phone.toLowerCase().includes(q) ||
          item.city.toLowerCase().includes(q)
        )
      })
      .slice(0, 20)
  }, [dedupedCustomers, visitCustomerSearch])

  const handleCustomerSearchChange = (value: string) => {
    setVisitCustomerSearch(value)
    const q = value.trim().toLowerCase()
    if (!q) {
      setSelectedCustomerId('new')
      return
    }
    const matched = dedupedCustomers.find((item) => {
      const label = `${item.name} (${item.city})`.toLowerCase()
      return label === q || item.name.toLowerCase() === q
    })
    setSelectedCustomerId(matched ? matched.id : 'new')
  }

  const mapCustomers = useMemo(() => {
    if (role === 'salesman' || role === 'super_salesman') {
      const mine = dedupedCustomers.filter((c) => c.assignedSalesmanId === activeSalesman.id)
      return mine.length ? mine : dedupedCustomers
    }
    return dedupedCustomers
  }, [role, dedupedCustomers, activeSalesman.id])
  const filteredMapCustomers = useMemo(() => {
    if (role !== 'owner' && role !== 'sub_admin') return mapCustomers
    if (mapSalesmanFilter === 'all') return mapCustomers
    return mapCustomers.filter((c) => c.assignedSalesmanId === mapSalesmanFilter)
  }, [role, mapCustomers, mapSalesmanFilter])

  const mapLivePoints = useMemo(() => {
    if (role === 'salesman') return livePoints.filter((p) => p.salesmanId === activeSalesman.id)
    return livePoints
  }, [role, livePoints, activeSalesman.id])

  const mapRecentVisits = useMemo(() => {
    const isFieldSalesmanVisit = (v: VisitRecord) => {
      const p = teamProfiles.find((x) => x.id === v.salesmanId)
      if (!p) return true
      return p.role === 'salesman' || p.role === 'super_salesman'
    }
    const slice = visits.filter(isFieldSalesmanVisit).slice(0, 40)
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
  }, [role, visits, activeSalesman.id, teamProfiles])
  const filteredMapRecentVisits = useMemo(() => {
    if (role !== 'owner' && role !== 'sub_admin') return mapRecentVisits
    if (mapSalesmanFilter === 'all') return mapRecentVisits
    return mapRecentVisits.filter((v) => v.salesmanId === mapSalesmanFilter)
  }, [role, mapRecentVisits, mapSalesmanFilter])

  const visitHistoryRows = useMemo(() => {
    const rows = role === 'salesman' ? visits.filter((v) => v.salesmanId === activeSalesman.id) : visits
    const seen = new Set<string>()
    const out: VisitRecord[] = []
    for (const v of rows) {
      if (seen.has(v.id)) continue
      seen.add(v.id)
      out.push(v)
    }
    const filtered = out.filter((v) => {
      const d = v.capturedAt.slice(0, 10)
      const city = (customerById.get(v.customerId)?.city ?? '').toLowerCase()
      const client = v.customerName.toLowerCase()
      const cityQ = visitHistoryCityFilter.trim().toLowerCase()
      const clientQ = visitHistoryClientFilter.trim().toLowerCase()
      return (
        (!visitHistoryDateFilter || d === visitHistoryDateFilter) &&
        (visitHistorySalesmanFilter === 'all' || v.salesmanId === visitHistorySalesmanFilter) &&
        (!clientQ || client.includes(clientQ)) &&
        (!cityQ || city.includes(cityQ))
      )
    })
    return filtered.slice(0, 100)
  }, [role, visits, activeSalesman.id, customerById, visitHistoryDateFilter, visitHistorySalesmanFilter, visitHistoryClientFilter, visitHistoryCityFilter])
  const clientWiseVisitRows = useMemo(() => {
    const grouped = new Map<
      string,
      {
        customerId: string
        customerName: string
        city: string
        visits: number
        firstVisitAt: string
        lastVisitAt: string
        lastVisitType: VisitType
        lastSalesmanName: string
        lat: number
        lng: number
      }
    >()
    for (const visit of visitHistoryRows) {
      const city = customerById.get(visit.customerId)?.city ?? '—'
      const current = grouped.get(visit.customerId)
      if (!current) {
        grouped.set(visit.customerId, {
          customerId: visit.customerId,
          customerName: visit.customerName,
          city,
          visits: 1,
          firstVisitAt: visit.capturedAt,
          lastVisitAt: visit.capturedAt,
          lastVisitType: visit.visitType,
          lastSalesmanName: visit.salesmanName,
          lat: visit.lat,
          lng: visit.lng,
        })
        continue
      }
      current.visits += 1
      if (visit.capturedAt < current.firstVisitAt) current.firstVisitAt = visit.capturedAt
      if (visit.capturedAt > current.lastVisitAt) {
        current.lastVisitAt = visit.capturedAt
        current.lastVisitType = visit.visitType
        current.lastSalesmanName = visit.salesmanName
        current.lat = visit.lat
        current.lng = visit.lng
      }
    }
    return [...grouped.values()].sort((a, b) => b.lastVisitAt.localeCompare(a.lastVisitAt))
  }, [visitHistoryRows, customerById])
  const meetingSalesmanOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const m of meetingResponses) {
      const n = m.salesmanName.trim()
      if (n) seen.add(n)
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  }, [meetingResponses])
  const filteredMeetingResponses = useMemo(
    () =>
      meetingResponses.filter((m) => {
        const dateOk = meetingDateFilter ? m.createdAt.slice(0, 10) === meetingDateFilter : true
        const salesmanOk = meetingSalesmanFilter === 'all' ? true : m.salesmanName === meetingSalesmanFilter
        return dateOk && salesmanOk
      }),
    [meetingResponses, meetingDateFilter, meetingSalesmanFilter],
  )

  useEffect(() => {
    if (!visitPhotoModal) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setVisitPhotoModal(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visitPhotoModal])

  const openVisitPhoto = async (visit: VisitRecord) => {
    setMessage('')
    const raw = visit.photoDataUrl?.trim() ?? ''
    if (!raw) {
      setMessage('No photo stored for this visit.')
      return
    }
    const caption = `${visit.customerName} · ${visit.salesmanName} · ${new Date(visit.capturedAt).toLocaleString()}`
    if (raw.startsWith('data:') || /^https?:\/\//i.test(raw)) {
      setVisitPhotoModal({ src: raw, caption })
      return
    }
    if (!supabase) {
      setMessage('Configure Supabase to open photos saved to Storage.')
      return
    }
    setVisitPhotoOpeningId(visit.id)
    try {
      const url = await resolveVisitPhotoSrc(supabase, raw)
      if (!url) {
        setMessage('Could not load photo. Check the visit-photos bucket and Storage policies.')
        return
      }
      setVisitPhotoModal({ src: url, caption })
    } finally {
      setVisitPhotoOpeningId(null)
    }
  }

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
      setVisitSession(null)
    }
  }, [activeView, clearVisitLocationWatch])

  const lockVisitLocation = async (phase: 'arrival' | 'leave') => {
    setMessage('')
    clearVisitLocationWatch()

    if (!navigator.geolocation) {
      setMessage('This browser does not support geolocation.')
      return null
    }

    const requestId = ++locationRequestIdRef.current
    setLocationLocking(true)

    return await new Promise<{ lat: number; lng: number; accuracy: number; capturedAt: string } | null>((resolve) => {
      let settled = false
      const finish = (value: { lat: number; lng: number; accuracy: number; capturedAt: string } | null) => {
        if (settled) return
        settled = true
        if (visitLocationTimeoutRef.current !== null) {
          clearTimeout(visitLocationTimeoutRef.current)
          visitLocationTimeoutRef.current = null
        }
        setLocationLocking(false)
        resolve(value)
      }

      visitLocationTimeoutRef.current = window.setTimeout(() => {
        visitLocationTimeoutRef.current = null
        if (locationRequestIdRef.current !== requestId) return finish(null)
        setMessage(
          'Location is taking too long. Allow location for this site (address bar -> site settings), use a secure app URL, enable system Location/GPS, and try again - desktop often needs Wi-Fi location or a phone hotspot.',
        )
        finish(null)
      }, 22000)

      try {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            if (locationRequestIdRef.current !== requestId) return finish(null)
            const acc = position.coords.accuracy
            const lat = position.coords.latitude
            const lng = position.coords.longitude
            const capturedAt = new Date().toISOString()
            const point = { lat, lng, accuracy: acc, capturedAt }
            setGeo(point)
            if (phase === 'leave') {
              setMessage(
                acc <= GPS_THRESHOLD_METERS
                  ? `Leave location locked: ±${Math.round(acc)}m — OK to capture photo and end visit.`
                  : acc <= GPS_THRESHOLD_NEW_LEAD_METERS
                    ? `Leave location locked: ±${Math.round(acc)}m — OK if this visit is a new lead (existing customer needs ≤${GPS_THRESHOLD_METERS}m).`
                    : `Leave location locked: ±${Math.round(acc)}m — tighten GPS (≤${visitSession?.selectedCustomerId === 'new' ? GPS_THRESHOLD_NEW_LEAD_METERS : GPS_THRESHOLD_METERS}m) before ending.`,
              )
            } else {
              setMessage(
                acc <= GPS_THRESHOLD_METERS
                  ? `Arrival locked: ±${Math.round(acc)}m — OK for existing customers and new leads.`
                  : acc <= GPS_THRESHOLD_NEW_LEAD_METERS
                    ? `Arrival locked: ±${Math.round(acc)}m — OK for new lead only (existing customer visits need ≤${GPS_THRESHOLD_METERS}m).`
                    : `Arrival locked: ±${Math.round(acc)}m — need ≤${GPS_THRESHOLD_NEW_LEAD_METERS}m for new lead, ≤${GPS_THRESHOLD_METERS}m for existing customer.`,
              )
            }
            finish(point)
          },
          (error) => {
            if (locationRequestIdRef.current !== requestId) return finish(null)
            const geoError = error as GeolocationPositionError
            let hint = error.message
            if (geoError.code === 1) {
              hint = 'Permission denied — allow Location for this page (lock icon in the address bar).'
            } else if (geoError.code === 2) {
              hint = 'Position unavailable — turn on device location / GPS services.'
            } else if (geoError.code === 3) {
              hint = 'Request timed out — try outdoors or a stronger GPS/Wi-Fi signal.'
            }
            setMessage(`Could not lock location: ${hint}`)
            finish(null)
          },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 18000 },
        )
      } catch {
        if (locationRequestIdRef.current !== requestId) return finish(null)
        setMessage('Geolocation failed unexpectedly. Try another browser or check HTTPS.')
        finish(null)
      }
    })
  }

  /**
   * Manual location lock is kept for arrival.
   */
  const markVisitLocation = () => {
    void lockVisitLocation(visitSession ? 'leave' : 'arrival')
  }

  const cancelMarkLocation = () => {
    locationRequestIdRef.current += 1
    clearVisitLocationWatch()
    setMessage('')
  }

  const startVisitCamera = async () => {
    setMessage('')
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage('Camera API not available. Use HTTPS and a device with a camera.')
      return
    }
    stopVisitCamera()
    const attempts: MediaStreamConstraints[] = [
      { video: { facingMode: { ideal: 'environment' } }, audio: false },
      { video: { facingMode: 'environment' }, audio: false },
      { video: true, audio: false },
      { video: { facingMode: 'user' }, audio: false },
    ]
    let stream: MediaStream | null = null
    let lastErr: unknown
    for (const constraints of attempts) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints)
        break
      } catch (e) {
        lastErr = e
      }
    }
    if (!stream) {
      setMessage(`Cannot open camera: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`)
      return
    }
    try {
      visitCameraStreamRef.current = stream
      const el = visitVideoRef.current
      if (el) {
        el.setAttribute('playsinline', 'true')
        el.setAttribute('webkit-playsinline', 'true')
        el.muted = true
        el.srcObject = stream
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve())
        })
        await el.play().catch(() => undefined)
      }
      setVisitCameraOn(true)
    } catch (error) {
      stream.getTracks().forEach((t) => t.stop())
      visitCameraStreamRef.current = null
      setMessage(`Cannot open camera: ${(error as Error).message}`)
    }
  }

  const captureVisitPhoto = async () => {
    setMessage('')
    let currentGeo = geo
    if (visitSession && !currentGeo) currentGeo = await lockVisitLocation('leave')
    const video = visitVideoRef.current
    if (!video || !currentGeo) return
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
    const lines = [`Photo time: ${new Date().toLocaleString()}`]
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
    setMessage('Photo saved. Use Retake if you want another shot, or End visit & save below.')
  }

  const clearVisitPhoto = () => {
    setPhotoFile(null)
    setPhotoPreview('')
    setPhotoHasEmbeddedWatermark(false)
    stopVisitCamera()
  }

  const cancelVisitSession = () => {
    setVisitSession(null)
    setGeo(null)
    clearVisitPhoto()
    setMessage('Visit cancelled.')
  }

  const markFollowUpComplete = async (id: string) => {
    setFollowUps((prev) => prev.map((f) => (f.id === id ? { ...f, status: 'closed' as FollowUpStatus } : f)))
    if (supabase && online) {
      const { error } = await supabase.from('followups').update({ status: 'closed' }).eq('id', id)
      if (error) setMessage(`Could not mark complete: ${error.message}`)
      else scheduleWorkspaceReloadRef.current?.()
    }
  }

  const saveFollowUpEdit = async (updated: FollowUp) => {
    setFollowUps((prev) => prev.map((f) => (f.id === updated.id ? updated : f)))
    setEditingFollowUp(null)
    if (supabase && online) {
      const { error } = await supabase.from('followups').update({
        due_date: updated.dueDate,
        priority: updated.priority,
        status: updated.status,
        remarks: updated.remarks,
      }).eq('id', updated.id)
      if (error) setMessage(`Could not save follow-up: ${error.message}`)
      else scheduleWorkspaceReloadRef.current?.()
    }
  }

  const startVisitSession = () => {
    setMessage('')
    if (visitSession) return
    if (!geo) return setMessage('Mark your arrival location first.')
    const maxGpsAccuracy =
      selectedCustomerId === 'new' ? GPS_THRESHOLD_NEW_LEAD_METERS : GPS_THRESHOLD_METERS
    if (geo.accuracy > maxGpsAccuracy) {
      return setMessage(
        selectedCustomerId === 'new'
          ? `GPS accuracy must be under ${GPS_THRESHOLD_NEW_LEAD_METERS}m to start a new lead visit. Current: ${Math.round(geo.accuracy)}m`
          : `GPS accuracy must be under ${GPS_THRESHOLD_METERS}m to start an existing-customer visit. Current: ${Math.round(geo.accuracy)}m`,
      )
    }
    if (selectedCustomerId === 'new') {
      if (!visitCustomerSearch.trim() || !quickLeadPhone.trim()) {
        return setMessage('Enter customer name and phone before starting a new lead visit.')
      }
    } else {
      const selectedCustomer = customers.find((item) => item.id === selectedCustomerId)
      if (!selectedCustomer) return setMessage('Customer not found.')
      const radius = distanceMeters(geo.lat, geo.lng, selectedCustomer.lat, selectedCustomer.lng)
      if (radius > RADIUS_THRESHOLD_METERS) {
        return setMessage(
          `Outside ${RADIUS_THRESHOLD_METERS}m of the customer pin — move closer to start the visit. Current distance: ${Math.round(radius)}m`,
        )
      }
    }
    const selectedVisitType: VisitType = selectedCustomerId === 'new' ? 'New lead' : 'Existing customer'
    setVisitSession({
      startGeo: { ...geo },
      selectedCustomerId,
      visitType: selectedVisitType,
      quickLead: {
        name: visitCustomerSearch.trim(),
        phone: quickLeadPhone.trim(),
        address: quickLeadAddress.trim() || 'Address pending',
      },
    })
    setGeo(null)
    clearVisitPhoto()
    setMessage('Visit started. Open camera, capture, and then tap End visit & save.')
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

  const signInWithEmailPassword = async (email: string, password: string) => {
    if (signingIn) return
    setSigningIn(true)
    setLoginMessage('')
    setLoginMessageIsError(false)
    if (!supabase) {
      setSigningIn(false)
      return
    }
    const emailNorm = normalizeEmail(email)
    if (!emailNorm || !password) {
      setLoginMessageIsError(true)
      setLoginMessage('Enter email and password.')
      setSigningIn(false)
      return
    }
    try {
      /** Do not enforce password *format* on sign-in — only Supabase knows the real rules; client rules caused false rejects after a valid password change. */
      const { error } = await supabase.auth.signInWithPassword({ email: emailNorm, password })
      if (error) {
        setLoginMessageIsError(true)
        setLoginMessage(formatSignInError(error))
      }
    } catch (error) {
      setLoginMessageIsError(true)
      setLoginMessage(`Sign-in failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSigningIn(false)
    }
  }

  const updateAccountPassword = async () => {
    setSettingsPasswordMessage('')
    if (!supabase || !authSession) return
    if (settingsNewPassword !== settingsConfirmPassword) {
      setSettingsPasswordMessage('New passwords do not match.')
      return
    }
    if (!isValidPassword(settingsNewPassword)) {
      setSettingsPasswordMessage(PASSWORD_POLICY_HINT)
      return
    }
    const { error } = await supabase.auth.updateUser({ password: settingsNewPassword })
    if (error) {
      setSettingsPasswordMessage(error.message)
      return
    }
    setSettingsNewPassword('')
    setSettingsConfirmPassword('')
    setSettingsPasswordMessage('Password updated.')
  }

  const handleSignOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    setMessage('')
    try {
      if (supabase) {
        // Local scope avoids logout hangs on flaky mobile networks.
        const localResult = await supabase.auth.signOut({ scope: 'local' })
        if (localResult.error) {
          console.warn('signOut(local):', localResult.error.message)
          const globalResult = await supabase.auth.signOut()
          if (globalResult.error) console.warn('signOut(global fallback):', globalResult.error.message)
        }
      }
    } catch (error) {
      console.warn('signOut unexpected:', error)
    } finally {
      setInviteSuccessMessage('')
      setAuthSession(null)
      setLoginMessage('')
      setLoginMessageIsError(false)
      localStorage.removeItem('fs_offline_demo')
      localStorage.removeItem('fs_invited_users')
      setInvitedUsers([])
      setTeamProfiles([])
      setCustomers(supabaseEnabled ? [] : INITIAL_CUSTOMERS)
      setFollowUps(supabaseEnabled ? [] : INITIAL_FOLLOWUPS)
      setVisits([])
      setMeetingResponses([])
      setLivePoints([])
      setActiveView('field_followups')
      setMobileNavOpen(false)
      setSigningOut(false)
    }
  }

  const addInvitedUser = () => {
    setMessage('')
    setInviteSuccessMessage('')
    const fullName = inviteName.trim()
    const email = normalizeEmail(inviteEmail)
    const phone = invitePhone.trim()
    if (!fullName) {
      setMessage('Enter full name.')
      return
    }
    if (!email.includes('@')) {
      setMessage('Enter a valid email address.')
      return
    }
    if (phone && !/^[0-9+\-\s]{7,20}$/.test(phone)) {
      setMessage('Enter a valid phone number (digits, +, -, space).')
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
    const addedAt = new Date().toISOString()
    if (supabase) {
      if (invitePassword !== invitePasswordConfirm) {
        setMessage('Initial password and confirmation do not match.')
        return
      }
      if (!isValidPassword(invitePassword)) {
        setMessage(`Initial password: ${PASSWORD_POLICY_HINT}`)
        return
      }
      void (async () => {
        const { data, error } = await supabase.functions.invoke('invite-user-with-password', {
          body: { fullName, email, phone, role: inviteRole, password: invitePassword },
        })
        if (error) {
          const status = error instanceof FunctionsHttpError ? error.context?.status : undefined
          if (status === 401) {
            setMessage(
              'Invite failed: the function gateway rejected your session (401). Redeploy with `supabase/config.toml` setting `[functions.invite-user-with-password] verify_jwt = false` (then `npm run deploy:function:invite`). Auth is still enforced inside the function.',
            )
            return
          }
          setMessage(
            error.message.includes('Failed to fetch') || error.message.includes('404')
              ? 'Invite failed: deploy the Edge Function `invite-user-with-password` and run `supabase functions deploy invite-user-with-password` (or `npm run deploy:function:invite`).'
              : `Invite failed: ${error.message}`,
          )
          return
        }
        const payload = data as { ok?: boolean; error?: string } | null
        if (!payload?.ok) {
          setMessage(`Invite failed: ${payload?.error ?? 'Unknown error'}`)
          return
        }
        setInvitedUsers((previous) => {
          if (previous.some((u) => normalizeEmail(u.email) === email)) return previous
          return [...previous, { email, role: inviteRole, addedAt }]
        })
        setInviteName('')
        setInviteEmail('')
        setInvitePhone('')
        setInvitePassword('')
        setInvitePasswordConfirm('')
        setInviteSuccessMessage(
          `Invited ${fullName} (${email}) as ${inviteRole.replace(/_/g, ' ')}. They can sign in with that email and the password you set (they can change it under Settings).`,
        )
        scheduleWorkspaceReloadRef.current?.()
      })()
      return
    }
    setInvitedUsers((previous) => [...previous, { email, role: inviteRole, addedAt }])
    setInviteName('')
    setInviteEmail('')
    setInvitePhone('')
    setInviteSuccessMessage(`Invited ${fullName} (${email}) as ${inviteRole.replace(/_/g, ' ')} (offline demo).`)
  }

  const removeInvitedUser = (email: string) => {
    if (role !== 'owner') return
    const n = normalizeEmail(email)
    if (supabase) {
      void (async () => {
        const { error } = await supabase.from('app_invites').delete().eq('email', n)
        if (error) {
          setMessage(`Could not remove invite: ${error.message}`)
          return
        }
        setInvitedUsers((previous) => previous.filter((u) => normalizeEmail(u.email) !== n))
        scheduleWorkspaceReloadRef.current?.()
      })()
      return
    }
    setInvitedUsers((previous) => previous.filter((u) => normalizeEmail(u.email) !== n))
  }

  const failVisitSave = (text: string) => {
    setMessage(text)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const saveVisit = async () => {
    if (savingVisit) return
    setSavingVisit(true)
    try {
    setMessage('')
    if (!activeSalesman.id) return failVisitSave('Sign in again, then save the visit.')
    if (!visitSession) return failVisitSave('Start a visit at arrival first, then end it when you leave.')
    let leaveGeo = geo
    if (!leaveGeo) {
      leaveGeo = await lockVisitLocation('leave')
      if (!leaveGeo) return failVisitSave('Could not get leave location. Allow GPS and try again.')
    }
    const session = visitSession
    const maxGpsAccuracy =
      session.selectedCustomerId === 'new' ? GPS_THRESHOLD_NEW_LEAD_METERS : GPS_THRESHOLD_METERS
    if (leaveGeo.accuracy > maxGpsAccuracy) {
      return failVisitSave(
        session.selectedCustomerId === 'new'
          ? `GPS accuracy must be under ${GPS_THRESHOLD_NEW_LEAD_METERS}m when ending a new lead visit. Current: ${Math.round(leaveGeo.accuracy)}m`
          : `GPS accuracy must be under ${GPS_THRESHOLD_METERS}m when ending an existing-customer visit. Current: ${Math.round(leaveGeo.accuracy)}m`,
      )
    }
    if (!photoFile) return failVisitSave('Take a mandatory photo using the camera (gallery upload is not allowed).')
    if (!photoHasEmbeddedWatermark || !photoPreview.startsWith('data:image')) {
      return failVisitSave('Use Open camera and Capture photo. Images must come from the live camera with timestamp and location on the picture.')
    }
    if (!notes.trim()) return failVisitSave('Meeting notes are required.')

    if (supabase && online) {
      const displayName =
        (authSession?.user?.user_metadata?.full_name as string | undefined) ||
        authSession?.user?.email ||
        activeSalesman.name
      const { error: profileErr } = await supabase.from('profiles').upsert(
        { id: activeSalesman.id, full_name: displayName, role, email: normalizeEmail(authSession?.user?.email ?? '') },
        { onConflict: 'id' },
      )
      if (profileErr) {
        return failVisitSave(
          `Profile sync failed (required before saving customers): ${profileErr.message}`,
        )
      }
    }

    let customerName = ''
    let customerId = session.selectedCustomerId
    let selectedCustomer: Customer | undefined
    const visitStartedAt = session.startGeo.capturedAt

    if (session.selectedCustomerId === 'new') {
      const ql = session.quickLead
      const newCustomer: Customer = {
        id: `c-${Date.now()}`,
        name: ql.name,
        phone: ql.phone,
        whatsapp: ql.phone,
        address: ql.address,
        city: 'Unknown',
        tags: [],
        assignedSalesmanId: activeSalesman.id,
        lat: leaveGeo.lat,
        lng: leaveGeo.lng,
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
        if (error) return failVisitSave(`Customer save failed: ${error.message}`)
      }
    } else {
      selectedCustomer = customers.find((item) => item.id === session.selectedCustomerId)
      if (!selectedCustomer) return failVisitSave('Customer not found.')
      customerName = selectedCustomer.name
    }

    if (selectedCustomer && session.selectedCustomerId !== 'new') {
      const radius = distanceMeters(leaveGeo.lat, leaveGeo.lng, selectedCustomer.lat, selectedCustomer.lng)
      if (radius > RADIUS_THRESHOLD_METERS) {
        return failVisitSave(`Outside ${RADIUS_THRESHOLD_METERS}m radius at leave time. Current distance: ${Math.round(radius)}m`)
      }
    }

    const watermarkedPhoto = photoPreview
    const visitId = `v-${Date.now()}`
    const capturedAt = leaveGeo.capturedAt
    let photoPath = watermarkedPhoto

    if (supabase && online) {
      try {
        photoPath = await uploadVisitPhoto(visitId, watermarkedPhoto)
      } catch (error) {
        return failVisitSave(`Photo upload failed: ${(error as Error).message}`)
      }
    }

    const payload: VisitRecord = {
      id: visitId,
      customerId,
      customerName,
      salesmanId: activeSalesman.id,
      salesmanName: activeSalesman.name,
      lat: leaveGeo.lat,
      lng: leaveGeo.lng,
      accuracy: leaveGeo.accuracy,
      capturedAt,
      photoDataUrl: photoPath,
      visitType: session.visitType,
      notes: notes.trim(),
      nextAction: nextAction.trim(),
      followUpDate: followUpDate || undefined,
      status: online ? 'synced' : 'queued',
      maxGpsAccuracyMeters: maxGpsAccuracy,
      visitStartedAt,
    }

    setVisits((previous) => {
      if (previous.some((v) => v.id === payload.id)) return previous
      return [payload, ...previous]
    })
    if (!supabase || !online) {
      setMeetingResponses((previous) => [
        { id: `m-${Date.now()}`, customerName, salesmanName: activeSalesman.name, response: notes.trim(), createdAt: capturedAt },
        ...previous,
      ])
    }
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
      const { data: createdVisit, error } = await supabase.rpc('create_visit_enforced', {
        p_visit_id: payload.id,
        p_customer_id: payload.customerId,
        p_salesman_id: payload.salesmanId,
        p_visit_type: payload.visitType,
        p_captured_at: payload.capturedAt,
        p_lat: payload.lat,
        p_lng: payload.lng,
        p_accuracy_meters: payload.accuracy,
        p_photo_path: payload.photoDataUrl,
        p_notes: payload.notes,
        p_next_action: payload.nextAction || null,
        p_follow_up_date: payload.followUpDate || null,
        p_visit_started_at: payload.visitStartedAt ?? null,
        p_max_gps_accuracy_meters: payload.maxGpsAccuracyMeters ?? GPS_THRESHOLD_METERS,
      })
      if (error) {
        setVisits((previous) => previous.filter((v) => v.id !== payload.id))
        return failVisitSave(`Visit rejected by server: ${error.message}`)
      }
      const visitRowId =
        createdVisit && typeof createdVisit === 'object' && 'id' in createdVisit
          ? String((createdVisit as { id: string }).id)
          : visitId
      const meetingId = `m-${visitId}`
      const { error: meetingErr } = await supabase.from('meeting_responses').insert({
        id: meetingId,
        customer_name: customerName,
        salesman_name: activeSalesman.name,
        response: notes.trim(),
        created_at: capturedAt,
        visit_id: visitRowId,
      })
      if (meetingErr) {
        console.warn('meeting_responses insert:', meetingErr.message)
      }
      if (visitRowId !== payload.id) {
        setVisits((previous) =>
          previous.map((v) => (v.id === payload.id ? { ...v, id: visitRowId } : v)),
        )
      }
    }

    setVisitSession(null)
    setGeo(null)
    setSelectedCustomerId('new')
    setQuickLeadPhone('')
    setQuickLeadAddress('')
    setVisitCustomerSearch('')
    setNotes('')
    setNextAction('')
    setFollowUpDate('')
    setPhotoFile(null)
    setPhotoPreview('')
    setPhotoHasEmbeddedWatermark(false)
    stopVisitCamera()
    setMessage(online ? 'Visit saved and synced.' : 'Visit saved offline. Sync later with same captured time.')
    } catch (error) {
      failVisitSave(`Could not save visit: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSavingVisit(false)
    }
  }

  const visitSessionCustomerLabel = visitSession
    ? visitSession.selectedCustomerId === 'new'
      ? visitSession.quickLead.name
      : customers.find((c) => c.id === visitSession.selectedCustomerId)?.name ?? 'Customer'
    : ''

  const visitFormCard = (
    <article className="card visitFormCard">
      <h3>Record visit</h3>
      {!activeSalesman.id ? (
        <p className="muted visit-camera-warn">Could not resolve your user id for this visit. Refresh the page or sign in again.</p>
      ) : null}

      {visitSession ? (
        <div className="visit-session-banner" role="status">
          <p>
            <strong>Visit in progress</strong> — {visitSessionCustomerLabel} · {visitSession.visitType} · arrived{' '}
            {new Date(visitSession.startGeo.capturedAt).toLocaleString()}
          </p>
          <div className="inlineActions">
            <button type="button" className="secondary" onClick={cancelVisitSession}>
              Cancel visit
            </button>
          </div>
        </div>
      ) : null}

      {!visitSession ? (
        <>
          <p className="muted">
            <strong>Step 1 — Arrival.</strong> Mark where you arrived. <strong>Existing customer:</strong> GPS uncertainty
            must be ≤ {GPS_THRESHOLD_METERS}m and you must be within {RADIUS_THRESHOLD_METERS}m of their pin.{' '}
            <strong>New lead:</strong> GPS uncertainty can be up to {GPS_THRESHOLD_NEW_LEAD_METERS}m. Then choose customer
            and tap <strong>Start visit</strong>.
          </p>
          <div className="inlineActions">
            <button type="button" onClick={markVisitLocation} disabled={locationLocking}>
              {locationLocking ? 'Fetching location…' : 'Fetch location'}
            </button>
            {locationLocking ? (
              <button type="button" className="secondary" onClick={cancelMarkLocation}>
                Cancel
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <p className="muted">
            <strong>Step 2 — Capture &amp; end.</strong> Open camera, capture photo, and tap <strong>End visit &amp; save</strong>.
            Leave location is captured automatically during capture/save.
          </p>
        </>
      )}

      {locationLocking ? (
        <p className="muted">
          Requesting location (usually under 20s). If this never finishes, check site permissions on your secure app URL.
        </p>
      ) : null}
      {geo && !locationLocking ? (
        <p className="muted">
          {visitSession ? 'Leave' : 'Arrival'} locked {new Date(geo.capturedAt).toLocaleString()} | {geo.lat.toFixed(6)},{' '}
          {geo.lng.toFixed(6)} | ±{Math.round(geo.accuracy)}m
        </p>
      ) : null}

      {!visitSession ? (
        <div className="formGrid">
          <label>
            Customer
            <input
              list="existing-customer-suggestions"
              value={visitCustomerSearch}
              onChange={(event) => handleCustomerSearchChange(event.target.value)}
              placeholder="Type customer name (suggestions for existing customers)"
            />
            <datalist id="existing-customer-suggestions">
              {filteredCustomerSuggestions.map((item) => (
                <option key={item.id} value={`${item.name} (${item.city})`} />
              ))}
            </datalist>
          </label>

          {selectedCustomerId === 'new' ? (
            <>
              <label>
                Phone
                <input value={quickLeadPhone} onChange={(event) => setQuickLeadPhone(event.target.value)} />
              </label>
              <label>
                Address
                <input value={quickLeadAddress} onChange={(event) => setQuickLeadAddress(event.target.value)} />
              </label>
            </>
          ) : null}

        </div>
      ) : (
        <div className="formGrid">
          <p className="muted">
            <strong>Customer:</strong> {visitSessionCustomerLabel}
            <br />
            <strong>Visit type:</strong> {visitSession.visitType}
          </p>
          <label>
            Notes
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>

          <label>
            Next action / remarks
            <textarea value={nextAction} onChange={(event) => setNextAction(event.target.value)} />
          </label>

          <label>
            Follow-up date
            <input type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} />
          </label>
        </div>
      )}

      {!visitSession ? (
        <div className="inlineActions">
          <button
            type="button"
            onClick={startVisitSession}
            disabled={!geo || locationLocking || !activeSalesman.id}
          >
            Start visit
          </button>
        </div>
      ) : (
        <>
          <div className="visit-camera-block">
            <h4 className="visit-camera-title">
              <strong>Photo</strong> (camera only)
            </h4>
            <p className="muted">
              Open the camera and capture. The image includes timestamp and your <strong>leave</strong> location GPS.
              Gallery is not used. After a shot you can <strong>Retake</strong> or <strong>End visit &amp; save</strong> below.
            </p>
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
                  disabled={locationLocking}
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
            <button type="button" onClick={() => void saveVisit()} disabled={savingVisit}>
              {savingVisit ? 'Saving visit…' : 'End visit & save'}
            </button>
          </div>
        </>
      )}
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
                  {role !== 'salesman' ? (
                    <>
                      <button type="button" className="secondary" onClick={() => setActiveView('admin_overdue')}>
                        Overdue follow-ups
                      </button>
                      <button type="button" className="secondary" onClick={() => setActiveView('admin_meetings')}>
                        Meeting responses
                      </button>
                    </>
                  ) : null}
                  {NAV_ITEMS.find((i) => i.id === 'add_visit')?.show(role) ? (
                    <button type="button" onClick={() => setActiveView('add_visit')}>
                      Add visit
                    </button>
                  ) : null}
                </div>
              </article>
              {(role === 'owner' || role === 'sub_admin') && (
                <article className="card">
                  <h3>Admin metrics</h3>
                  <p className="muted">Field salesmen: {salesmen.length}</p>
                  <p className="muted">Total visits: {visits.length}</p>
                  <p className="muted">Visits today: {visits.filter((v) => v.capturedAt.slice(0, 10) === todayIso).length}</p>
                </article>
              )}
              {(role === 'salesman' || role === 'super_salesman') && (
                <article className="card">
                  <h3>Follow-up snapshot</h3>
                  <div className="inlineFilters">
                    <label>
                      Follow-up date
                      <input
                        type="date"
                        value={salesmanFollowUpDateFilter}
                        onChange={(event) => setSalesmanFollowUpDateFilter(event.target.value)}
                      />
                    </label>
                  </div>
                  <p className="muted">Due today: {followUpsDueTodayForSalesman.length}</p>
                  <p className="muted">Overdue: {overdueFollowUpsForSalesman.length}</p>
                  <p className="muted">Matching selected date: {filteredPendingFollowUpsForSalesman.length}</p>
                </article>
              )}
            </div>
          </section>
        )
      case 'map':
        return (
          <section className="panel">
            <h2>Map</h2>
            <p className="muted">
              Each salesman has a consistent color on customer pins and on recent visit dots (field salesmen only).
              Unassigned customers use gray. Live GPS pings are on the Live tracking screen, not here.
            </p>
            {(role === 'owner' || role === 'sub_admin') && salesmen.length ? (
              <div className="inlineFilters">
                <label>
                  Field salesman
                  <select value={mapSalesmanFilter} onChange={(event) => setMapSalesmanFilter(event.target.value)}>
                    <option value="all">All field salesmen</option>
                    {salesmen.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
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
            <Suspense fallback={<p className="muted">Loading map...</p>}>
              <DealerMap
                customers={filteredMapCustomers.map((c) => ({
                  id: c.id,
                  name: c.name,
                  city: c.city,
                  lat: c.lat,
                  lng: c.lng,
                  assignedSalesmanId: c.assignedSalesmanId,
                  salesmanName: salesmen.find((x) => x.id === c.assignedSalesmanId)?.name,
                }))}
                livePoints={[]}
                recentVisits={filteredMapRecentVisits}
                salesmen={salesmen}
              />
            </Suspense>
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
              <div className="inlineFilters">
                <label>
                  Salesman
                  <select value={overdueSalesmanFilter} onChange={(event) => setOverdueSalesmanFilter(event.target.value)}>
                    <option value="all">All field salesmen</option>
                    {salesmen.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="scrollArea">
                <table>
                  <thead>
                    <tr>
                      <th>Salesman</th>
                      <th>Client</th>
                      <th>City</th>
                      <th>Phone</th>
                      <th>Due date</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th>Remarks</th>
                      <th>Last visit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOverdueRowsDetailed.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="muted">
                          No overdue follow-ups.
                        </td>
                      </tr>
                    ) : (
                      filteredOverdueRowsDetailed.map((row) => (
                        <tr key={row.id}>
                          <td>{row.salesmanName}</td>
                          <td>{row.customerName}</td>
                          <td>{row.customerCity}</td>
                          <td>{row.customerPhone}</td>
                          <td>{row.dueDate}</td>
                          <td>{row.priority}</td>
                          <td>{row.status}</td>
                          <td>{row.remarks || '—'}</td>
                          <td>
                            {row.lastVisitAt ? `${new Date(row.lastVisitAt).toLocaleDateString()} (${row.lastVisitType})` : '—'}
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
      case 'admin_meetings':
        return (
          <section className="panel">
            <h2>Meeting responses</h2>
            <article className="card">
              <div className="inlineFilters">
                <label>
                  Date
                  <input type="date" value={meetingDateFilter} onChange={(event) => setMeetingDateFilter(event.target.value)} />
                </label>
                <label>
                  Salesman
                  <select value={meetingSalesmanFilter} onChange={(event) => setMeetingSalesmanFilter(event.target.value)}>
                    <option value="all">All</option>
                    {meetingSalesmanOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="scrollArea">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Salesman</th>
                      <th>Customer</th>
                      <th>Response</th>
                      <th>Next action</th>
                      <th>Photo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMeetingResponses.slice(0, 80).map((item) => {
                      const linkedVisit = item.visitId ? visitById.get(item.visitId) : undefined
                      return (
                        <tr key={item.id}>
                          <td>{new Date(item.createdAt).toLocaleString()}</td>
                          <td>{item.salesmanName}</td>
                          <td>{item.customerName}</td>
                          <td>{item.response}</td>
                          <td>{linkedVisit?.nextAction || '—'}</td>
                          <td>
                            {linkedVisit?.photoDataUrl ? (
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => void openVisitPhoto(linkedVisit)}
                                disabled={visitPhotoOpeningId === linkedVisit.id}
                              >
                                {visitPhotoOpeningId === linkedVisit.id ? 'Opening…' : 'View photo'}
                              </button>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        )
      case 'settings':
        return (
          <section className="panel settingsPanel">
            <div className="settingsHeader">
              <h2>Settings</h2>
              <p className="muted settingsLead">Account security and team access for Whiterock Field Salesman.</p>
            </div>

            <article className="card settingsCard">
              <h3>Account</h3>
              <p className="muted">
                Your role comes from the invite list. Sign in with <strong>email and password</strong> using the same
                email you were invited with.
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
                  <button type="button" className="secondary" onClick={() => void handleSignOut()} disabled={signingOut}>
                    {signingOut ? 'Logging out...' : 'Log out'}
                  </button>
                ) : null}
              </div>
            </article>

            {supabaseEnabled && authSession ? (
              <article className="card settingsCard">
                <h3>Change password</h3>
                <p className="muted">Use a new password that meets the same rules as at sign-up. You can change it anytime.</p>
                {settingsPasswordMessage ? <p className="muted">{settingsPasswordMessage}</p> : null}
                <div className="formGrid">
                  <label>
                    New password
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={settingsNewPassword}
                      onChange={(event) => setSettingsNewPassword(event.target.value)}
                    />
                  </label>
                  <label>
                    Confirm new password
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={settingsConfirmPassword}
                      onChange={(event) => setSettingsConfirmPassword(event.target.value)}
                    />
                  </label>
                </div>
                <p className="muted" style={{ fontSize: '0.85rem' }}>
                  {PASSWORD_POLICY_HINT}
                </p>
                <div className="inlineActions">
                  <button type="button" onClick={() => void updateAccountPassword()}>
                    Update password
                  </button>
                </div>
              </article>
            ) : null}

            {canInviteTeam ? (
              <article className="card settingsCard">
                {inviteSuccessMessage ? (
                  <p className="message messageSuccess" role="status">
                    {inviteSuccessMessage}
                  </p>
                ) : null}
                <h3>Add user (invite)</h3>
                <p className="muted">
                  {supabaseEnabled ? (
                    <>
                      Set their <strong>initial password</strong> here (they can change it later under Settings). Requires the
                      deployed Edge Function <code>invite-user-with-password</code>.{' '}
                    </>
                  ) : null}
                  <strong>Owner</strong> can invite owner, salesman, sub-admin, and super-salesman.{' '}
                  <strong>Sub-admin</strong> can invite salesman and super-salesman. <strong>Super-salesman</strong> can
                  invite salesman.
                </p>
                <div className="formGrid">
                  <label>
                    Full name
                    <input
                      value={inviteName}
                      onChange={(event) => setInviteName(event.target.value)}
                      placeholder="User full name"
                    />
                  </label>
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
                  <label>
                    Phone number
                    <input
                      value={invitePhone}
                      onChange={(event) => setInvitePhone(event.target.value)}
                      placeholder="+91 98xxxxxx"
                    />
                  </label>
                  {supabaseEnabled ? (
                    <>
                      <label>
                        Initial password
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={invitePassword}
                          onChange={(event) => setInvitePassword(event.target.value)}
                        />
                      </label>
                      <label>
                        Confirm initial password
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={invitePasswordConfirm}
                          onChange={(event) => setInvitePasswordConfirm(event.target.value)}
                        />
                      </label>
                    </>
                  ) : null}
                </div>
                {supabaseEnabled ? (
                  <p className="muted" style={{ fontSize: '0.85rem' }}>
                    {PASSWORD_POLICY_HINT}
                  </p>
                ) : null}
                <div className="inlineActions">
                  <button type="button" onClick={addInvitedUser}>
                    Add invited user
                  </button>
                </div>
              </article>
            ) : null}

            {canSeeTeamDirectory ? (
              <article className="card settingsCard">
                <h3>Invited emails ({invitedUsers.length})</h3>
                <p className="muted">
                  Only these invited emails can access the app. Admins assign the initial password when adding a user.
                </p>
                <div className="scrollArea settingsTableWrap">
                  <table className="settingsTable">
                    <thead>
                      <tr>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Added</th>
                        {canRemoveInvites ? <th aria-label="Actions" /> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {invitedUsers.length === 0 ? (
                        <tr>
                          <td colSpan={canRemoveInvites ? 4 : 3} className="muted">
                            No invites yet. The first sign-in while this list is empty is added as <strong>owner</strong>.
                            After that, owners add everyone (including more owners) here under Add user.
                          </td>
                        </tr>
                      ) : (
                        invitedUsers
                          .slice()
                          .sort((a, b) => a.email.localeCompare(b.email))
                          .map((u) => (
                            <tr key={u.email}>
                              <td className="settingsEmailCell">{u.email}</td>
                              <td>
                                <span className="roleBadge">{u.role.replace(/_/g, ' ')}</span>
                              </td>
                              <td className="muted settingsDateCell">{new Date(u.addedAt).toLocaleString()}</td>
                              {canRemoveInvites ? (
                                <td className="settingsActionsCell">
                                  <button type="button" className="secondary danger" onClick={() => removeInvitedUser(u.email)}>
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
            ) : null}

            {canSeeTeamDirectory ? (
              <article className="card settingsCard">
                <h3>Profiles (synced)</h3>
                <p className="muted">Live roles from Supabase <code>profiles</code> (used for visits and permissions).</p>
                <div className="scrollArea settingsTableWrap">
                  <table className="settingsTable">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th>Role</th>
                        <th>User id</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teamProfiles.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="muted">
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
                              <td className="muted settingsEmailCell">{p.email ?? '—'}</td>
                              <td>{p.phone || '—'}</td>
                              <td>
                                <span className="roleBadge">{p.role.replace(/_/g, ' ')}</span>
                              </td>
                              <td className="muted idCell" title={p.id}>
                                {p.id.slice(0, 8)}…
                              </td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
              </article>
            ) : null}
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
              <div className="inlineFilters">
                <label>
                  Follow-up date
                  <input
                    type="date"
                    value={salesmanFollowUpDateFilter}
                    onChange={(event) => setSalesmanFollowUpDateFilter(event.target.value)}
                  />
                </label>
              </div>
              <p className="muted">
                Due today: {followUpsDueTodayForSalesman.length} · Overdue: {overdueFollowUpsForSalesman.length}
              </p>
              <ul className="list">
                {filteredPendingFollowUpsForSalesman.map((item) => {
                  const customer = customers.find((entry) => entry.id === item.customerId)
                  const isEditing = editingFollowUp?.id === item.id
                  return (
                    <li key={item.id} style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <strong>{customer?.name ?? 'Unknown customer'}</strong> — due {item.dueDate}
                          <p className="muted">{item.remarks}</p>
                        </div>
                        <span className={`statusTag ${item.priority === 'high' ? 'warning' : ''}`}>{item.priority}</span>
                      </div>
                      {isEditing && editingFollowUp ? (
                        <div className="formGrid" style={{ marginTop: '4px' }}>
                          <label>
                            Due date
                            <input
                              type="date"
                              value={editingFollowUp.dueDate}
                              onChange={(e) => setEditingFollowUp({ ...editingFollowUp, dueDate: e.target.value })}
                            />
                          </label>
                          <label>
                            Priority
                            <select
                              value={editingFollowUp.priority}
                              onChange={(e) => setEditingFollowUp({ ...editingFollowUp, priority: e.target.value as FollowUp['priority'] })}
                            >
                              <option value="low">Low</option>
                              <option value="medium">Medium</option>
                              <option value="high">High</option>
                            </select>
                          </label>
                          <label>
                            Status
                            <select
                              value={editingFollowUp.status}
                              onChange={(e) => setEditingFollowUp({ ...editingFollowUp, status: e.target.value as FollowUpStatus })}
                            >
                              <option value="pending">Pending</option>
                              <option value="in_progress">In progress</option>
                              <option value="closed">Closed</option>
                            </select>
                          </label>
                          <label>
                            Remarks
                            <textarea
                              value={editingFollowUp.remarks}
                              onChange={(e) => setEditingFollowUp({ ...editingFollowUp, remarks: e.target.value })}
                            />
                          </label>
                          <div className="inlineActions">
                            <button type="button" onClick={() => void saveFollowUpEdit(editingFollowUp)}>Save</button>
                            <button type="button" className="secondary" onClick={() => setEditingFollowUp(null)}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="inlineActions">
                          <button type="button" onClick={() => void markFollowUpComplete(item.id)}>Mark complete</button>
                          <button type="button" className="secondary" onClick={() => setEditingFollowUp({ ...item })}>Edit</button>
                        </div>
                      )}
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
              <p className="muted">
                Share your real-time GPS position while in the field. Your location is recorded every few seconds
                and visible to admins on the map.
              </p>
              <div className="rowBetween">
                <p>
                  Status:{' '}
                  <span className={watchIdRef.current !== null ? 'statusTag ok' : 'statusTag warning'}>
                    {watchIdRef.current !== null ? 'Tracking active' : 'Stopped'}
                  </span>
                </p>
                <div className="inlineActions">
                  {watchIdRef.current === null ? (
                    <button type="button" onClick={startLiveTracking}>
                      Start tracking
                    </button>
                  ) : (
                    <button type="button" className="secondary" onClick={stopLiveTracking}>
                      Stop tracking
                    </button>
                  )}
                </div>
              </div>
            </article>
            {mapLivePoints.length > 0 ? (
              <article className="card">
                <h3>Recent pings</h3>
                <ul className="miniList">
                  {mapLivePoints.slice(0, 12).map((point, index) => (
                    <li key={`${point.time}-${index}`}>
                      {new Date(point.time).toLocaleTimeString()} — {point.lat.toFixed(5)}, {point.lng.toFixed(5)} (±{Math.round(point.accuracy)}m)
                    </li>
                  ))}
                </ul>
              </article>
            ) : null}
          </section>
        )
      case 'field_customers':
        return (
          <section className="panel">
            <h2>My customers</h2>
            <article className="card">
              <ul className="list">
                {myCustomers.map((item) => (
                    <li key={item.id}>
                      <div>
                        <strong>{item.name}</strong> — {item.city}
                        <p className="muted">
                          {item.phone} | Tags: {item.tags.join(', ') || '—'}
                        </p>
                      </div>
                      <div className="inlineActions">
                        <a
                          className="secondary"
                          href={googleMapsSearchUrl(item.lat, item.lng)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Google Maps
                        </a>
                        <button type="button" className="secondary" onClick={() => setActiveView('map')}>
                          In-app map
                        </button>
                      </div>
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
              <div className="inlineFilters">
                <label>
                  Date
                  <input type="date" value={visitHistoryDateFilter} onChange={(event) => setVisitHistoryDateFilter(event.target.value)} />
                </label>
                <label>
                  Salesman
                  <select
                    value={visitHistorySalesmanFilter}
                    onChange={(event) => setVisitHistorySalesmanFilter(event.target.value)}
                  >
                    <option value="all">All</option>
                    {salesmen.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Client name
                  <input
                    value={visitHistoryClientFilter}
                    onChange={(event) => setVisitHistoryClientFilter(event.target.value)}
                    placeholder="Search client"
                  />
                </label>
                <label>
                  City
                  <input
                    value={visitHistoryCityFilter}
                    onChange={(event) => setVisitHistoryCityFilter(event.target.value)}
                    placeholder="Search city"
                  />
                </label>
              </div>
              <div className="scrollArea">
                <table>
                  <thead>
                    <tr>
                      <th>Arrived</th>
                      <th>Ended</th>
                      <th>Salesman</th>
                      <th>Customer</th>
                      <th>City</th>
                      <th>Type</th>
                      <th>GPS</th>
                      <th>Status</th>
                      <th>Photo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visitHistoryRows.map((visit) => (
                      <tr key={visit.id}>
                        <td>
                          {visit.visitStartedAt ? new Date(visit.visitStartedAt).toLocaleString() : '—'}
                        </td>
                        <td>{new Date(visit.capturedAt).toLocaleString()}</td>
                        <td>{visit.salesmanName}</td>
                        <td>{visit.customerName}</td>
                        <td>{customerById.get(visit.customerId)?.city ?? '—'}</td>
                        <td>{visit.visitType}</td>
                        <td>
                          {visit.lat.toFixed(4)}, {visit.lng.toFixed(4)} (±{Math.round(visit.accuracy)}m){' '}
                          <a
                            href={googleMapsSearchUrl(visit.lat, visit.lng)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="muted"
                            style={{ fontSize: '0.78rem', marginLeft: '0.35rem' }}
                          >
                            Maps
                          </a>
                        </td>
                        <td>{visit.status}</td>
                        <td>
                          <button
                            type="button"
                            className="secondary"
                            disabled={!visit.photoDataUrl?.trim() || visitPhotoOpeningId === visit.id}
                            onClick={() => void openVisitPhoto(visit)}
                          >
                            {visitPhotoOpeningId === visit.id ? 'Opening…' : 'View'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
            <article className="card">
              <h3>Client-wise Visit History</h3>
              <div className="scrollArea">
                <table>
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>City</th>
                      <th>Total visits</th>
                      <th>First visit</th>
                      <th>Last visit</th>
                      <th>Last visit type</th>
                      <th>Last salesman</th>
                      <th>Map</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clientWiseVisitRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="muted">
                          No visits found for the selected filters.
                        </td>
                      </tr>
                    ) : (
                      clientWiseVisitRows.map((row) => (
                        <tr key={row.customerId}>
                          <td>{row.customerName}</td>
                          <td>{row.city}</td>
                          <td>{row.visits}</td>
                          <td>{new Date(row.firstVisitAt).toLocaleString()}</td>
                          <td>{new Date(row.lastVisitAt).toLocaleString()}</td>
                          <td>{row.lastVisitType}</td>
                          <td>{row.lastSalesmanName}</td>
                          <td>
                            <a
                              href={googleMapsSearchUrl(row.lat, row.lng)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Maps
                            </a>
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
      default:
        return null
    }
  })()

  const showMainApp = Boolean(supabaseEnabled && accessAllowed)
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
        messageIsError={loginMessageIsError}
        isSigningIn={signingIn}
        onEmailSignIn={(email, password) => void signInWithEmailPassword(email, password)}
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
          <h1>Whiterock Field Salesman</h1>
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
              <h1 className="topBarTitle">Whiterock Field Salesman</h1>
              <p className="muted topBarSubtitle">{activeViewLabel}</p>
            </div>
          </div>

          <div className="topControls">
            {authSession?.user?.email ? (
              <span className="topUserEmail" title="Signed-in account">
                {authSession.user.email}
              </span>
            ) : null}
            <span className={online ? 'statusTag ok' : 'statusTag warning'}>{online ? 'Online' : 'Offline'}</span>
            {showLogOut ? (
              <button type="button" className="secondary topLogoutBtn" onClick={() => void handleSignOut()} disabled={signingOut}>
                {signingOut ? 'Logging out...' : 'Log out'}
              </button>
            ) : null}
          </div>
        </header>

        <div className="contentArea">
          {message ? <p className="message">{message}</p> : null}
          {mainContent}
        </div>
      </div>

      {visitPhotoModal ? (
        <div
          className="visitPhotoModalOverlay"
          role="dialog"
          aria-modal="true"
          aria-label="Visit photo"
          onClick={() => setVisitPhotoModal(null)}
        >
          <div className="visitPhotoModal" onClick={(e) => e.stopPropagation()}>
            <div className="visitPhotoModalHeader rowBetween">
              <p className="visitPhotoModalCaption">{visitPhotoModal.caption}</p>
              <button type="button" className="secondary" onClick={() => setVisitPhotoModal(null)}>
                Close
              </button>
            </div>
            <img
              src={visitPhotoModal.src}
              alt="Visit photo captured in the field"
              className="visitPhotoModalImg"
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default App
