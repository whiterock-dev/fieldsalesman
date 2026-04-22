import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { LoginScreen } from './components/LoginScreen'
import { findInviteForEmail, normalizeEmail, type InvitedUser } from './lib/invites'
import { addableRolesFor, type Role } from './lib/roles'
import { formatSignInError } from './lib/authMessages'
import { clampTenDigitMobileInput, parseTenDigitMobile } from './lib/mobilePhone'
import { isValidPassword, PASSWORD_POLICY_HINT } from './lib/passwordPolicy'
import { supabase, supabaseEnabled } from './lib/supabase'
import { colorForSalesmanId, salesmanColorMap } from './mapColors'
import { googleMapsSearchUrl } from './lib/maps'
import { formatDate, formatDateTime } from './lib/dateUtils'
import { exportToCsv } from './lib/exportUtils'

const DealerMap = lazy(async () => {
  const module = await import('./components/DealerMap')
  return { default: module.DealerMap }
})
const OFFLINE_VISIT_QUEUE_KEY = 'fs_offline_queued_visits'

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
  dynamicFields?: Record<string, string>
}
type FollowUp = {
  id: string
  customerId: string
  dueDate: string
  priority: 'low' | 'medium' | 'high'
  status: FollowUpStatus
  archived: boolean
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
  dynamicFields?: Record<string, string>
}

type VisitSession = {
  startGeo: { lat: number; lng: number; accuracy: number; capturedAt: string }
  selectedCustomerId: string
  visitType: VisitType
  quickLead: {
    name: string
    phone: string
    address: string
    city: string
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
type EditingMeetingResponse = {
  id: string
  response: string
}
type FormField = {
  id: string
  label: string
  key: string
  type: 'text' | 'textarea' | 'number' | 'date' | 'select'
  required: boolean
  options: string[]
  order: number
  active: boolean
  isDeleted: boolean
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
  { id: 'admin_meetings', label: 'Meeting responses', section: 'Admin', show: () => true },
  { id: 'admin_kpi', label: 'KPI table', section: 'Admin', show: (r) => r !== 'salesman' },
  { id: 'settings', label: 'Settings', section: 'Account', show: () => true },
  { id: 'visits', label: 'Visit history', section: 'Overview', show: () => true },
]

function isNavId(id: string): id is NavId {
  return NAV_ITEMS.some((item) => item.id === id)
}

function defaultViewForRole(role: Role): NavId {
  return role === 'salesman' ? 'field_followups' : 'dashboard'
}

function parseNavFromLocation(): NavId {
  if (typeof window === 'undefined') return 'dashboard'
  const raw = window.location.hash.replace(/^#\/?/, '').trim()
  if (raw && isNavId(raw)) return raw
  try {
    const s = sessionStorage.getItem('fs_active_view')
    if (s && isNavId(s)) return s
  } catch {
    /* private mode */
  }
  return 'dashboard'
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

/** Max reported GPS uncertainty allowed for existing-customer visit flows. */
const GPS_THRESHOLD_METERS = 100
/** New leads have no prior map pin — keep a slightly tighter GPS expectation. */
const GPS_THRESHOLD_NEW_LEAD_METERS = 80
/** Max distance from customer map pin for existing-customer visits. */
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
  { id: 'f1', customerId: 'c1', dueDate: '2026-03-16', priority: 'high', status: 'pending', archived: false, remarks: 'Collection pending', salesmanId: 's1' },
  { id: 'f2', customerId: 'c2', dueDate: '2026-03-20', priority: 'medium', status: 'pending', archived: false, remarks: 'Quotation follow-up', salesmanId: 's2' },
]

function dateString(isoDate: string) {
  return new Date(isoDate).toISOString().slice(0, 10)
}

function hoursBetween(startIso: string, endIso: string) {
  const diff = Math.max(0, new Date(endIso).getTime() - new Date(startIso).getTime())
  const mins = Math.floor(diff / 60000)
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}

function toDynamicFieldsObject(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const entries = Object.entries(value as Record<string, unknown>).flatMap(([key, raw]) => {
    if (typeof raw === 'string') return [[key, raw]]
    if (raw === null || raw === undefined) return []
    return [[key, String(raw)]]
  })
  return Object.fromEntries(entries)
}

function normalizeFormFieldKey(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function generateUuidV4() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function isDataUrl(value: string) {
  return value.startsWith('data:image')
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

function kpiTimeLabel(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
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
      firstVisitTime: kpiTimeLabel(firstIso),
      lastVisitTime: kpiTimeLabel(lastIso),
      visitCount: sorted.length,
    }
  }).sort((a, b) => b.date.localeCompare(a.date))
}

function App() {
  const [authSession, setAuthSession] = useState<Session | null>(null)
  const [authHydrated, setAuthHydrated] = useState(() => !supabaseEnabled)
  const [loginMessage, setLoginMessage] = useState('')
  const [loginMessageIsError, setLoginMessageIsError] = useState(false)
  const [forgotPasswordMessage, setForgotPasswordMessage] = useState('')
  const [forgotPasswordMessageIsError, setForgotPasswordMessageIsError] = useState(false)
  const [forgotPasswordBusy, setForgotPasswordBusy] = useState(false)

  const [teamProfiles, setTeamProfiles] = useState<TeamProfile[]>([])
  const [invitedUsers, setInvitedUsers] = useState<InvitedUser[]>([])

  useEffect(() => {
    localStorage.removeItem('fs_offline_demo')
  }, [])
  const [customers, setCustomers] = useState<Customer[]>(() => (supabaseEnabled ? [] : INITIAL_CUSTOMERS))
  const [followUps, setFollowUps] = useState<FollowUp[]>(() => (supabaseEnabled ? [] : INITIAL_FOLLOWUPS))
  const [visits, setVisits] = useState<VisitRecord[]>([])
  const [meetingResponses, setMeetingResponses] = useState<MeetingResponse[]>([])
  const [formFields, setFormFields] = useState<FormField[]>([])
  const [livePoints, setLivePoints] = useState<LivePoint[]>([])

  const scheduleWorkspaceReloadRef = useRef<(() => void) | null>(null)
  const [online, setOnline] = useState<boolean>(navigator.onLine)
  const [geo, setGeo] = useState<{ lat: number; lng: number; accuracy: number; capturedAt: string } | null>(null)
  const [selectedCustomerId, setSelectedCustomerId] = useState('new')
  const [quickLeadPhone, setQuickLeadPhone] = useState('')
  const [quickLeadAddress, setQuickLeadAddress] = useState('')
  const [quickLeadCity, setQuickLeadCity] = useState('')
  const [visitCustomerSearch, setVisitCustomerSearch] = useState('')
  const [notes, setNotes] = useState('')
  const [nextAction, setNextAction] = useState('')
  const [followUpDate, setFollowUpDate] = useState('')
  const [dynamicData, setDynamicData] = useState<Record<string, string>>({})
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
  const lastResolvedUserIdRef = useRef<string | null>(null)
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
  const [_settingsPasswordMessage, setSettingsPasswordMessage] = useState('')
  const [visitHistoryDateFilter, setVisitHistoryDateFilter] = useState('')
  const [visitHistorySalesmanFilter, setVisitHistorySalesmanFilter] = useState('all')
  const [visitHistoryClientFilter, setVisitHistoryClientFilter] = useState('')
  const [visitHistoryCityFilter, setVisitHistoryCityFilter] = useState('')
  const [selectedVisitClientId, setSelectedVisitClientId] = useState<string | null>(null)
  const [selectedVisitHistoryRowId, setSelectedVisitHistoryRowId] = useState<string | null>(null)
  const [mapSalesmanFilter, setMapSalesmanFilter] = useState('all')
  const [overdueSalesmanFilter, setOverdueSalesmanFilter] = useState('all')
  const [meetingDateFilter, setMeetingDateFilter] = useState('')
  const [meetingSalesmanFilter, setMeetingSalesmanFilter] = useState('all')
  const [newFieldLabel, setNewFieldLabel] = useState('')
  const [newFieldType, setNewFieldType] = useState<FormField['type']>('text')
  const [newFieldRequired, setNewFieldRequired] = useState(false)
  const [newFieldOptions, setNewFieldOptions] = useState('')
  const [savingFormField, setSavingFormField] = useState(false)
  const syncingQueuedVisitsRef = useRef(false)
  const [salesmanFollowUpDateFrom, setSalesmanFollowUpDateFrom] = useState('')
  const [salesmanFollowUpDateTo, setSalesmanFollowUpDateTo] = useState('')
  const [salesmanFollowUpPriorityFilter, setSalesmanFollowUpPriorityFilter] = useState<'all' | FollowUp['priority']>('all')
  const [salesmanFollowUpArchiveFilter, setSalesmanFollowUpArchiveFilter] = useState(false)
  const [myCustomersNameFilter, setMyCustomersNameFilter] = useState('')
  const [myCustomersNameFilterDebounced, setMyCustomersNameFilterDebounced] = useState('')
  const [editingFollowUp, setEditingFollowUp] = useState<FollowUp | null>(null)
  const [editingMeetingResponse, setEditingMeetingResponse] = useState<EditingMeetingResponse | null>(null)
  const [archivingFollowUpId, setArchivingFollowUpId] = useState<string | null>(null)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setMyCustomersNameFilterDebounced(myCustomersNameFilter)
    }, 800)
    return () => window.clearTimeout(timeoutId)
  }, [myCustomersNameFilter])

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
    if (!allowedNavIds.includes(activeView)) {
      const preferred = defaultViewForRole(role)
      setActiveView(allowedNavIds.includes(preferred) ? preferred : (allowedNavIds[0] ?? 'dashboard'))
    }
  }, [allowedNavIds, activeView, role])

  useEffect(() => {
    const uid = authSession?.user?.id ?? null
    if (!uid) {
      lastResolvedUserIdRef.current = null
      return
    }
    if (lastResolvedUserIdRef.current === uid) return
    lastResolvedUserIdRef.current = uid
    setActiveView(defaultViewForRole(role))
  }, [authSession?.user?.id, role])

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
      console.log(session)
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
    try {
      const raw = localStorage.getItem(OFFLINE_VISIT_QUEUE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      const queued = parsed
        .map((item) => item as Partial<VisitRecord>)
        .filter((item): item is VisitRecord => item.status === 'queued' && typeof item.id === 'string')
      if (!queued.length) return
      setVisits((previous) => {
        const byId = new Map<string, VisitRecord>()
        for (const visit of [...previous, ...queued]) byId.set(visit.id, visit)
        const merged = [...byId.values()]
        merged.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
        return merged
      })
    } catch (error) {
      console.warn('offline visit queue parse:', error)
    }
  }, [])

  useEffect(() => {
    const queued = visits.filter((item) => item.status === 'queued')
    if (!queued.length) {
      localStorage.removeItem(OFFLINE_VISIT_QUEUE_KEY)
      return
    }
    localStorage.setItem(OFFLINE_VISIT_QUEUE_KEY, JSON.stringify(queued))
  }, [visits])

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
        formFieldResult,
        { data: liveRows, error: liveErr },
      ] = await Promise.all([
        sb.from('app_invites').select('email, role, added_at').order('added_at', { ascending: true }),
        sb.from('profiles').select('id, full_name, role, email, phone'),
        sb.from('customers').select('*').order('created_at', { ascending: false }),
        sb.from('followups').select('*').order('due_date', { ascending: true }),
        sb.from('visits').select('*').order('captured_at', { ascending: false }).limit(200),
        sb.from('meeting_responses').select('*').order('created_at', { ascending: false }).limit(100),
        sb.from('form_fields').select('*').order('order', { ascending: true }).order('created_at', { ascending: true }),
        sb.from('live_locations').select('*').order('captured_at', { ascending: false }).limit(200),
      ])
      if (closed) return
      if (invitesErr) console.warn('app_invites:', invitesErr.message)
      if (profilesErr) console.warn('profiles:', profilesErr.message)
      if (customersErr) console.warn('customers:', customersErr.message)
      if (followupsErr) console.warn('followups:', followupsErr.message)
      if (visitsErr) console.warn('visits:', visitsErr.message)
      if (meetingResult.error) console.warn('meeting_responses:', meetingResult.error.message)
      if (formFieldResult.error) console.warn('form_fields:', formFieldResult.error.message)
      if (liveErr) console.warn('live_locations:', liveErr.message)

      const meetingRows = meetingResult.error ? [] : (meetingResult.data ?? [])
      const formFieldRows = formFieldResult.error ? [] : (formFieldResult.data ?? [])
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
        dynamicFields: toDynamicFieldsObject(r.dynamic_fields),
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
          archived: typeof (r as Record<string, unknown>).archived === 'boolean'
            ? Boolean((r as Record<string, unknown>).archived)
            : (r.status as FollowUpStatus) === 'closed',
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
          dynamicFields: toDynamicFieldsObject(row.dynamic_fields),
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

      setFormFields(
        (formFieldRows ?? []).map((r) => ({
          id: r.id as string,
          label: (r.label as string) ?? '',
          key: (r.key as string) ?? '',
          type: ((r.type as FormField['type']) ?? 'text'),
          required: Boolean(r.required),
          options: Array.isArray(r.options)
            ? (r.options as unknown[]).map((item) => String(item).trim()).filter(Boolean)
            : [],
          order: Number((r as Record<string, unknown>).order ?? 0),
          active: r.active !== false,
          isDeleted: Boolean(r.is_deleted),
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
      'form_fields',
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

  const followUpsForSalesman = useMemo(
    () => followUps.filter((item) => item.salesmanId === activeSalesman.id).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [activeSalesman.id, followUps],
  )
  const pendingFollowUpsForSalesman = useMemo(
    () => followUpsForSalesman.filter((item) => !item.archived && item.status !== 'closed'),
    [followUpsForSalesman],
  )
  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers])
  const customerByName = useMemo(() => {
    const map = new Map<string, Customer>()
    for (const customer of customers) {
      const key = customer.name.trim().toLowerCase()
      if (key && !map.has(key)) map.set(key, customer)
    }
    return map
  }, [customers])
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
          customerDynamicFields: customer?.dynamicFields ?? {},
          lastVisitDynamicFields: lastVisit?.dynamicFields ?? {},
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
    () => {
      return pendingFollowUpsForSalesman.filter((item) => {
        const onOrAfterFrom = salesmanFollowUpDateFrom ? item.dueDate >= salesmanFollowUpDateFrom : true
        const onOrBeforeTo = salesmanFollowUpDateTo ? item.dueDate <= salesmanFollowUpDateTo : true
        const priorityOk = salesmanFollowUpPriorityFilter === 'all' ? true : item.priority === salesmanFollowUpPriorityFilter
        return onOrAfterFrom && onOrBeforeTo && priorityOk
      })
    },
    [
      pendingFollowUpsForSalesman,
      salesmanFollowUpDateFrom,
      salesmanFollowUpDateTo,
      salesmanFollowUpPriorityFilter,
    ],
  )
  const filteredFollowUpsForSalesman = useMemo(
    () => {
      return followUpsForSalesman.filter((item) => {
        const onOrAfterFrom = salesmanFollowUpDateFrom ? item.dueDate >= salesmanFollowUpDateFrom : true
        const onOrBeforeTo = salesmanFollowUpDateTo ? item.dueDate <= salesmanFollowUpDateTo : true
        const priorityOk = salesmanFollowUpPriorityFilter === 'all' ? true : item.priority === salesmanFollowUpPriorityFilter
        const archiveOk = salesmanFollowUpArchiveFilter ? item.archived : !item.archived
        return onOrAfterFrom && onOrBeforeTo && priorityOk && archiveOk
      })
    },
    [
      followUpsForSalesman,
      salesmanFollowUpDateFrom,
      salesmanFollowUpDateTo,
      salesmanFollowUpPriorityFilter,
      salesmanFollowUpArchiveFilter,
    ],
  )
  const openFollowUpsCount = useMemo(() => {
    const byId = new Map<string, FollowUp>()
    for (const f of followUps) byId.set(f.id, f)
    let count = 0
    for (const f of byId.values()) {
      if (f.status !== 'closed') count += 1
    }
    return count
  }, [followUps])
  const archivedFollowUpsForSalesman = useMemo(
    () =>
      followUpsForSalesman
        .filter((item) => item.archived)
        .sort((a, b) => b.dueDate.localeCompare(a.dueDate)),
    [followUpsForSalesman],
  )
  const syncedVisits = useMemo(() => {
    const byId = new Map<string, VisitRecord>()
    for (const v of visits) {
      if (v.status === 'synced') byId.set(v.id, v)
    }
    return [...byId.values()]
  }, [visits])
  const syncedVisitsTodayCount = useMemo(
    () => syncedVisits.filter((v) => v.capturedAt.slice(0, 10) === todayIso).length,
    [syncedVisits, todayIso],
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
    if (role === 'salesman') {
      return dedupedCustomers.filter((c) => c.assignedSalesmanId === activeSalesman.id)
    }
    if (role === 'super_salesman') {
      return dedupedCustomers
    }
    return dedupedCustomers
  }, [role, dedupedCustomers, activeSalesman.id])

  const myCustomerIds = useMemo(() => new Set(myCustomers.map((c) => c.id)), [myCustomers])
  const myCustomerNames = useMemo(
    () => new Set(myCustomers.map((c) => c.name.trim().toLowerCase())),
    [myCustomers],
  )

  const profileNameById = useMemo(() => {
    const byId = new Map<string, string>()
    for (const profile of teamProfiles) {
      byId.set(profile.id, profile.fullName)
    }
    return byId
  }, [teamProfiles])

  const filteredMyCustomers = useMemo(() => {
    const q = myCustomersNameFilterDebounced.trim().toLowerCase()
    if (!q) return myCustomers
    return myCustomers.filter((item) => item.name.toLowerCase().includes(q))
  }, [myCustomers, myCustomersNameFilterDebounced])

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
      setQuickLeadPhone('')
      setQuickLeadAddress('')
      setQuickLeadCity('')
      setNotes('')
      setNextAction('')
      return
    }
    const matched = dedupedCustomers.find((item) => {
      const label = `${item.name} (${item.city})`.toLowerCase()
      return label === q || item.name.toLowerCase() === q
    })

    if (matched) {
      setSelectedCustomerId(matched.id)
      // Pre-fill customer phone and address
      setQuickLeadPhone(matched.phone)
      setQuickLeadAddress(matched.address)
      setQuickLeadCity(matched.city)

      // Pre-fill notes and next action from last visit
      const lastVisit = latestVisitByCustomerId.get(matched.id)
      setNotes(lastVisit?.notes ?? '')
      setNextAction(lastVisit?.nextAction ?? '')
    } else {
      setSelectedCustomerId('new')
      setQuickLeadPhone('')
      setQuickLeadAddress('')
      setQuickLeadCity('')
      setNotes('')
      setNextAction('')
    }
  }

  const mapCustomers = useMemo(() => {
    if (role === 'salesman') {
      return dedupedCustomers.filter((c) => c.assignedSalesmanId === activeSalesman.id)
    }
    if (role === 'super_salesman') {
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

  const mapVisibleSalesmen = useMemo(() => {
    if (role !== 'salesman') return salesmen
    const mine = salesmen.find((item) => item.id === activeSalesman.id)
    if (mine) return [mine]
    if (activeSalesman.id) return [{ id: activeSalesman.id, name: activeSalesman.name }]
    return []
  }, [role, salesmen, activeSalesman.id, activeSalesman.name])

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
  const selectedVisitClientVisits = useMemo(() => {
    if (!selectedVisitClientId) return []
    return visitHistoryRows
      .filter((visit) => visit.customerId === selectedVisitClientId)
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
  }, [visitHistoryRows, selectedVisitClientId])
  const selectedVisitClient = selectedVisitClientId ? customerById.get(selectedVisitClientId) : undefined
  const meetingSalesmanOptions = useMemo(() => {
    const scopedRows =
      role === 'salesman'
        ? meetingResponses.filter((m) => {
          const linkedVisit = m.visitId ? visitById.get(m.visitId) : undefined
          if (linkedVisit) return myCustomerIds.has(linkedVisit.customerId)
          return myCustomerNames.has(m.customerName.trim().toLowerCase())
        })
        : meetingResponses
    const seen = new Set<string>()
    for (const m of scopedRows) {
      const n = m.salesmanName.trim()
      if (n) seen.add(n)
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  }, [role, meetingResponses, visitById, myCustomerIds, myCustomerNames])
  const filteredMeetingResponses = useMemo(
    () => {
      const roleScopedRows =
        role === 'salesman'
          ? meetingResponses.filter((m) => {
            const linkedVisit = m.visitId ? visitById.get(m.visitId) : undefined
            if (linkedVisit) return myCustomerIds.has(linkedVisit.customerId)
            return myCustomerNames.has(m.customerName.trim().toLowerCase())
          })
          : meetingResponses
      return roleScopedRows.filter((m) => {
        const dateOk = meetingDateFilter ? m.createdAt.slice(0, 10) === meetingDateFilter : true
        const salesmanOk = role === 'salesman' ? true : meetingSalesmanFilter === 'all' ? true : m.salesmanName === meetingSalesmanFilter
        return dateOk && salesmanOk
      })
    },
    [
      role,
      meetingResponses,
      visitById,
      myCustomerIds,
      myCustomerNames,
      meetingDateFilter,
      meetingSalesmanFilter,
    ],
  )
  const exportVisitHistoryCsv = () => {
    const exportDynamicFields = formFields
      .filter((field) => field.active && !field.isDeleted)
      .sort((a, b) => a.order - b.order)
    const headers = [
      'Arrived',
      'Ended',
      'Salesman',
      'Customer',
      'City',
      'Type',
      'GPS',
      'Status',
      ...exportDynamicFields.map((field) => field.label),
    ]
    const rows = visitHistoryRows.map((visit) => {
      const customerDynamicFields = customerById.get(visit.customerId)?.dynamicFields ?? {}
      const dynamicValues = exportDynamicFields.map(
        (field) => visit.dynamicFields?.[field.key] || customerDynamicFields[field.key] || '—',
      )
      return [
        visit.visitStartedAt ? formatDateTime(visit.visitStartedAt) : '—',
        formatDateTime(visit.capturedAt),
        visit.salesmanName,
        visit.customerName,
        customerById.get(visit.customerId)?.city ?? '—',
        visit.visitType,
        `${visit.lat.toFixed(4)}, ${visit.lng.toFixed(4)} (±${Math.round(visit.accuracy)}m)`,
        visit.status,
        ...dynamicValues,
      ]
    })
    exportToCsv(`visit_history_${new Date().toISOString().slice(0, 10)}`, headers, rows)
  }

  useEffect(() => {
    if (!selectedVisitClientId) return
    const stillVisible = visitHistoryRows.some((visit) => visit.customerId === selectedVisitClientId)
    if (!stillVisible) {
      setSelectedVisitClientId(null)
      setSelectedVisitHistoryRowId(null)
    }
  }, [visitHistoryRows, selectedVisitClientId])
  const messageLooksLikeError = useMemo(() => {
    if (!message) return false
    return /(failed|error|rejected|could not|cannot|required|must|denied|outside|not found|invalid|timed out|warning)/i.test(message)
  }, [message])
  const displayedGpsThreshold = visitSession
    ? visitSession.selectedCustomerId === 'new'
      ? GPS_THRESHOLD_NEW_LEAD_METERS
      : GPS_THRESHOLD_METERS
    : selectedCustomerId === 'new'
      ? GPS_THRESHOLD_NEW_LEAD_METERS
      : GPS_THRESHOLD_METERS

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
    const caption = `${visit.customerName} · ${visit.salesmanName} · ${formatDateTime(visit.capturedAt)}`
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
      if (/^(Arrival|Leave) locked/i.test(message)) setMessage('')
    }
  }, [activeView, clearVisitLocationWatch, message])

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
    const customerName =
      visitSession?.selectedCustomerId === 'new'
        ? visitSession.quickLead.name
        : customers.find((c) => c.id === visitSession?.selectedCustomerId)?.name ?? 'Customer'
    const customerCity =
      visitSession?.selectedCustomerId === 'new'
        ? visitSession.quickLead.city
        : customers.find((c) => c.id === visitSession?.selectedCustomerId)?.city ?? '—'
    const lines = [
      `Client: ${customerName}`,
      `City: ${customerCity}`,
      `Photo time: ${formatDateTime(new Date())}`,
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
    setDynamicData({})
    setNotes('')
    setNextAction('')
    setFollowUpDate('')
    clearVisitPhoto()
    setMessage('Visit cancelled.')
  }

  const markFollowUpComplete = async (id: string) => {
    setFollowUps((prev) => prev.map((f) => (f.id === id ? { ...f, status: 'closed' as FollowUpStatus, archived: true } : f)))
    if (supabase && online) {
      const { error } = await supabase.from('followups').update({ status: 'closed', archived: true }).eq('id', id)
      if (error) setMessage(`Could not mark complete: ${error.message}`)
      else scheduleWorkspaceReloadRef.current?.()
    }
  }

  const toggleFollowUpArchived = async (id: string, archived: boolean) => {
    const original = followUps.find((f) => f.id === id)
    if (!original) return
    setArchivingFollowUpId(id)
    setFollowUps((prev) => prev.map((f) => (f.id === id ? { ...f, archived } : f)))
    setEditingFollowUp((prev) => (prev && prev.id === id ? { ...prev, archived } : prev))
    if (supabase && online) {
      const { error } = await supabase.from('followups').update({ archived }).eq('id', id)
      if (error) {
        setFollowUps((prev) => prev.map((f) => (f.id === id ? { ...f, archived: original.archived } : f)))
        setEditingFollowUp((prev) => (prev && prev.id === id ? { ...prev, archived: original.archived } : prev))
        setMessage(`Could not update archived status: ${error.message}`)
      }
    }
    setArchivingFollowUpId(null)
  }

  const saveFollowUpEdit = async (updatedParam: FollowUp) => {
    const updated = updatedParam.status === 'closed' ? { ...updatedParam, archived: true } : updatedParam

    setFollowUps((prev) => prev.map((f) => (f.id === updated.id ? updated : f)))
    setEditingFollowUp(null)
    if (supabase && online) {
      const { error } = await supabase.from('followups').update({
        due_date: updated.dueDate,
        priority: updated.priority,
        status: updated.status,
        remarks: updated.remarks,
        archived: updated.archived,
      }).eq('id', updated.id)
      if (error) setMessage(`Could not save follow-up: ${error.message}`)
      else scheduleWorkspaceReloadRef.current?.()
    }
  }
  const saveMeetingResponseEdit = async (updated: EditingMeetingResponse) => {
    const response = updated.response.trim()
    if (!response) {
      setMessage('Meeting response cannot be empty.')
      return
    }
    setMeetingResponses((prev) => prev.map((item) => (item.id === updated.id ? { ...item, response } : item)))
    setEditingMeetingResponse(null)
    if (supabase && online) {
      const { error } = await supabase.from('meeting_responses').update({ response }).eq('id', updated.id)
      if (error) setMessage(`Could not save meeting response: ${error.message}`)
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
    let leadPhoneForSession = quickLeadPhone.trim()
    if (selectedCustomerId === 'new') {
      if (!visitCustomerSearch.trim() || !quickLeadPhone.trim()) {
        return setMessage('Enter customer name and phone before starting a new lead visit.')
      }
      const leadMobile = parseTenDigitMobile(quickLeadPhone)
      if (!leadMobile) {
        return setMessage('Enter a valid 10-digit mobile number.')
      }
      leadPhoneForSession = leadMobile
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
        phone: leadPhoneForSession,
        address: quickLeadAddress.trim() || 'Address pending',
        city: quickLeadCity.trim() || 'Unknown',
      },
    })
    setGeo(null)

    // Pre-fill dynamic fields and other data from existing customer
    const initialDynamic: Record<string, string> = {}
    if (selectedCustomerId !== 'new') {
      const selectedCustomer = customers.find((item) => item.id === selectedCustomerId)
      if (selectedCustomer) {
        // Pre-fill dynamic fields
        for (const field of formFields) {
          if (field.active && !field.isDeleted) {
            initialDynamic[field.key] = selectedCustomer.dynamicFields?.[field.key] ?? ''
          }
        }
      }
    } else {
      for (const field of formFields) {
        if (field.active && !field.isDeleted) {
          initialDynamic[field.key] = ''
        }
      }
    }
    setDynamicData(initialDynamic)
    clearVisitPhoto()
    setMessage('Visit started. Open camera, capture, and then tap End visit & save.')
  }

  const retakeVisitPhoto = () => {
    clearVisitPhoto()
    void startVisitCamera()
  }

  const uploadVisitPhoto = useCallback(async (visitId: string, dataUrl: string) => {
    if (!supabase) return dataUrl
    const blob = await fetch(dataUrl).then((res) => res.blob())
    const filePath = `${activeSalesman.id}/${visitId}.jpg`
    const { error } = await supabase.storage.from('visit-photos').upload(filePath, blob, {
      upsert: true,
      contentType: 'image/jpeg',
    })
    if (error) throw new Error(error.message)
    return filePath
  }, [supabase, activeSalesman.id])

  const syncQueuedVisits = useCallback(async () => {
    if (!supabase || !online || syncingQueuedVisitsRef.current) return
    const queued = visits
      .filter((item) => item.status === 'queued')
      .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
    if (!queued.length) return
    syncingQueuedVisitsRef.current = true
    try {
      for (const queuedVisit of queued) {
        let pendingVisit = queuedVisit
        const customer = customerById.get(pendingVisit.customerId)
        if (!customer) continue
        if (isDataUrl(pendingVisit.photoDataUrl)) {
          const uploadedPath = await uploadVisitPhoto(pendingVisit.id, pendingVisit.photoDataUrl)
          pendingVisit = { ...pendingVisit, photoDataUrl: uploadedPath }
          setVisits((previous) =>
            previous.map((item) => (item.id === pendingVisit.id ? pendingVisit : item)),
          )
        }
        const { error } = await supabase.rpc('create_visit_enforced', {
          p_visit_id: pendingVisit.id,
          p_customer_id: pendingVisit.customerId,
          p_salesman_id: pendingVisit.salesmanId,
          p_visit_type: pendingVisit.visitType,
          p_captured_at: pendingVisit.capturedAt,
          p_lat: pendingVisit.lat,
          p_lng: pendingVisit.lng,
          p_accuracy_meters: pendingVisit.accuracy,
          p_photo_path: pendingVisit.photoDataUrl,
          p_notes: pendingVisit.notes,
          p_next_action: pendingVisit.nextAction || null,
          p_follow_up_date: pendingVisit.followUpDate || null,
          p_visit_started_at: pendingVisit.visitStartedAt ?? null,
          p_dynamic_fields: pendingVisit.dynamicFields ?? {},
          p_max_gps_accuracy_meters: pendingVisit.maxGpsAccuracyMeters ?? GPS_THRESHOLD_METERS,
        })
        if (error) {
          console.warn(`offline visit sync failed (${pendingVisit.id}):`, error.message)
          continue
        }
        const { error: customerUpdateError } = await supabase
          .from('customers')
          .update({ dynamic_fields: { ...(customerById.get(pendingVisit.customerId)?.dynamicFields || {}), ...(pendingVisit.dynamicFields || {}) } })
          .eq('id', pendingVisit.customerId)
        if (customerUpdateError) console.warn('offline customer dynamic_fields sync:', customerUpdateError.message)
        setVisits((previous) =>
          previous.map((item) => (item.id === pendingVisit.id ? { ...item, status: 'synced' } : item)),
        )
      }
      scheduleWorkspaceReloadRef.current?.()
    } finally {
      syncingQueuedVisitsRef.current = false
    }
  }, [supabase, online, visits, customerById, uploadVisitPhoto])

  useEffect(() => {
    if (!supabase || !authSession?.user || !online) return
    void syncQueuedVisits()
  }, [supabase, authSession?.user, online, syncQueuedVisits])

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

  const invokeForgotPassword = async (
    body: Record<string, unknown>,
  ): Promise<{ ok: boolean; error?: string; message?: string }> => {
    if (!supabase) return { ok: false, error: 'Supabase is not configured.' }
    const { data, error } = await supabase.functions.invoke('forgot-password-whatsapp-otp', { body })
    if (error) {
      const status = error instanceof FunctionsHttpError ? error.context?.status : undefined
      if (status === 401) {
        return {
          ok: false,
          error:
            'Forgot password failed: function JWT verification blocked the request (401). Set `[functions.forgot-password-whatsapp-otp] verify_jwt = false` in `supabase/config.toml` and redeploy the function.',
        }
      }
      return {
        ok: false,
        error:
          error.message.includes('Failed to fetch') ||
            error.message.includes('404') ||
            error.message.includes('Failed to send a request to the Edge Function')
            ? 'Forgot password failed: deploy the Edge Function `forgot-password-whatsapp-otp`.'
            : `Forgot password failed: ${error.message}`,
      }
    }
    return (data as { ok: boolean; error?: string; message?: string }) ?? { ok: false, error: 'Unknown server response.' }
  }

  const sendForgotPasswordOtp = async (mobile: string): Promise<boolean> => {
    setForgotPasswordBusy(true)
    setForgotPasswordMessage('')
    setForgotPasswordMessageIsError(false)
    const normalizedMobile = parseTenDigitMobile(mobile)
    if (!normalizedMobile) {
      setForgotPasswordBusy(false)
      setForgotPasswordMessageIsError(true)
      setForgotPasswordMessage('Enter a valid 10-digit mobile number.')
      return false
    }
    try {
      const payload = await invokeForgotPassword({ intent: 'sendOtp', mobile: normalizedMobile })
      if (!payload.ok) {
        setForgotPasswordMessageIsError(true)
        setForgotPasswordMessage(payload.error ?? 'Could not send OTP.')
        return false
      }
      setForgotPasswordMessage(payload.message ?? 'OTP sent to your WhatsApp.')
      return true
    } finally {
      setForgotPasswordBusy(false)
    }
  }

  const verifyForgotPasswordOtp = async (mobile: string, otp: string): Promise<boolean> => {
    setForgotPasswordBusy(true)
    setForgotPasswordMessage('')
    setForgotPasswordMessageIsError(false)
    try {
      const payload = await invokeForgotPassword({ intent: 'verifyOtp', mobile, otp })
      if (!payload.ok) {
        setForgotPasswordMessageIsError(true)
        setForgotPasswordMessage(payload.error ?? 'Invalid OTP.')
        return false
      }
      setForgotPasswordMessage(payload.message ?? 'OTP verified.')
      return true
    } finally {
      setForgotPasswordBusy(false)
    }
  }

  const resetForgotPassword = async (mobile: string, otp: string, newPassword: string): Promise<boolean> => {
    setForgotPasswordBusy(true)
    setForgotPasswordMessage('')
    setForgotPasswordMessageIsError(false)
    if (!isValidPassword(newPassword)) {
      setForgotPasswordBusy(false)
      setForgotPasswordMessageIsError(true)
      setForgotPasswordMessage(PASSWORD_POLICY_HINT)
      return false
    }
    try {
      const payload = await invokeForgotPassword({ intent: 'resetPassword', mobile, otp, newPassword })
      if (!payload.ok) {
        setForgotPasswordMessageIsError(true)
        setForgotPasswordMessage(payload.error ?? 'Could not reset password.')
        return false
      }
      setForgotPasswordMessage(payload.message ?? 'Password reset successful.')
      return true
    } finally {
      setForgotPasswordBusy(false)
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
      localStorage.removeItem(OFFLINE_VISIT_QUEUE_KEY)
      setInvitedUsers([])
      setTeamProfiles([])
      setCustomers(supabaseEnabled ? [] : INITIAL_CUSTOMERS)
      setFollowUps(supabaseEnabled ? [] : INITIAL_FOLLOWUPS)
      setVisits([])
      setMeetingResponses([])
      setFormFields([])
      setLivePoints([])
      setActiveView('field_followups')
      setMobileNavOpen(false)
      setDynamicData({})
      setSigningOut(false)
    }
  }

  const addInvitedUser = () => {
    setMessage('')
    setInviteSuccessMessage('')
    const fullName = inviteName.trim()
    const email = normalizeEmail(inviteEmail)
    const phoneRaw = invitePhone.trim()
    let phone = ''
    if (phoneRaw) {
      const parsed = parseTenDigitMobile(phoneRaw)
      if (!parsed) {
        setMessage('Enter a valid 10-digit mobile number, or leave phone blank.')
        return
      }
      phone = parsed
    }
    if (!fullName) {
      setMessage('Enter full name.')
      return
    }
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

  const addDynamicField = async () => {
    setMessage('')
    if (savingFormField) return
    if (!(role === 'owner' || role === 'sub_admin')) return
    const label = newFieldLabel.trim()
    const key = normalizeFormFieldKey(label)
    if (!label) {
      setMessage('Field label is required.')
      return
    }
    if (!key) {
      setMessage('Field label must include letters or numbers.')
      return
    }
    if (formFields.some((item) => item.key === key && !item.isDeleted)) {
      setMessage('Field key already exists. Use a different label.')
      return
    }
    const options =
      newFieldType === 'select'
        ? newFieldOptions
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
        : []
    if (newFieldType === 'select' && options.length < 2) {
      setMessage('Select fields need at least 2 options (comma separated).')
      return
    }

    const order = formFields.length + 1
    const next: FormField = {
      id: generateUuidV4(),
      label,
      key,
      type: newFieldType,
      required: newFieldRequired,
      options,
      order,
      active: true,
      isDeleted: false,
    }
    setSavingFormField(true)
    try {
      setFormFields((previous) => [...previous, next])
      if (supabase && online) {
        const { error } = await supabase.from('form_fields').insert({
          id: next.id,
          label: next.label,
          key: next.key,
          type: next.type,
          required: next.required,
          options: next.options,
          active: next.active,
          is_deleted: false,
          order: next.order,
        })
        if (error) {
          setFormFields((previous) => previous.filter((item) => item.id !== next.id))
          setMessage(`Could not add field: ${error.message}`)
          return
        }
      }
      setNewFieldLabel('')
      setNewFieldType('text')
      setNewFieldRequired(false)
      setNewFieldOptions('')
      setMessage('Dynamic field added.')
      scheduleWorkspaceReloadRef.current?.()
    } finally {
      setSavingFormField(false)
    }
  }

  const softDeleteDynamicField = async (field: FormField) => {
    if (!(role === 'owner' || role === 'sub_admin')) return
    setFormFields((previous) =>
      previous.map((item) =>
        item.id === field.id ? { ...item, isDeleted: true, active: false } : item,
      ),
    )
    if (supabase && online) {
      const { error } = await supabase
        .from('form_fields')
        .update({ is_deleted: true, active: false })
        .eq('id', field.id)
      if (error) {
        setMessage(`Could not delete field: ${error.message}`)
      } else {
        scheduleWorkspaceReloadRef.current?.()
      }
    }
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
      for (const field of activeDynamicFields) {
        if (field.required && !String(dynamicData[field.key] ?? '').trim()) {
          return failVisitSave(`"${field.label}" is required.`)
        }
      }

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
          city: ql.city.trim() || 'Unknown',
          tags: [],
          dynamicFields: dynamicData,
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
            dynamic_fields: dynamicData,
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
        dynamicFields: dynamicData,
      }

      setCustomers((previous) =>
        previous.map((item) =>
          item.id === customerId ? { ...item, dynamicFields: { ...(item.dynamicFields || {}), ...(payload.dynamicFields || {}) } } : item,
        ),
      )

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
          archived: false,
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
            archived: nextFollowUp.archived,
            remarks: nextFollowUp.remarks,
          })
          if (error) setMessage(`Follow-up save warning: ${error.message}`)
        }
      }

      if (supabase && online) {
        const { error: customerDynamicFieldsError } = await supabase
          .from('customers')
          .update({ dynamic_fields: { ...(customerById.get(payload.customerId)?.dynamicFields || {}), ...(payload.dynamicFields || {}) } })
          .eq('id', payload.customerId)
        if (customerDynamicFieldsError) {
          console.warn('customer dynamic_fields update:', customerDynamicFieldsError.message)
        }
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
          p_dynamic_fields: payload.dynamicFields ?? {},
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
      setQuickLeadCity('')
      setVisitCustomerSearch('')
      setNotes('')
      setNextAction('')
      setFollowUpDate('')
      setDynamicData({})
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
  const activeDynamicFields = useMemo(
    () =>
      formFields
        .filter((field) => field.active && !field.isDeleted)
        .sort((a, b) => a.order - b.order),
    [formFields],
  )
  const meetingRowsDetailed = useMemo(
    () =>
      filteredMeetingResponses.map((item) => {
        const linkedVisit = item.visitId ? visitById.get(item.visitId) : undefined
        const customer = linkedVisit ? customerById.get(linkedVisit.customerId) : customerByName.get(item.customerName.trim().toLowerCase())
        return {
          item,
          linkedVisit,
          customerPhone: customer?.phone || customer?.whatsapp || '—',
          dynamicValues: activeDynamicFields.map((field) => {
            const value = linkedVisit?.dynamicFields?.[field.key] ?? customer?.dynamicFields?.[field.key]
            return value || '—'
          }),
        }
      }),
    [filteredMeetingResponses, visitById, customerById, customerByName, activeDynamicFields],
  )



  const visitFormCard = (
    <article className="card visitFormCard">
      <div className="visitFormHeader">
        <h3>Record visit</h3>
      </div>
      {!activeSalesman.id ? (
        <p className="muted visit-camera-warn">Could not resolve your user id for this visit. Refresh the page or sign in again.</p>
      ) : null}

      {visitSession ? (
        <div className="visit-session-banner" role="status">
          <div className="visitSessionMeta">
            <p>
              <strong>Visit in progress</strong> — {visitSessionCustomerLabel} · {visitSession.visitType}
            </p>
            <p className="visitSessionStat">Arrived: {formatDateTime(visitSession.startGeo.capturedAt)}</p>
          </div>
          <div className="inlineActions visitSessionActions">
            <button type="button" className="secondary" onClick={cancelVisitSession}>
              Cancel visit
            </button>
          </div>
        </div>
      ) : null}

      {!visitSession ? (
        <>
          <p className="muted visitStepIntro">
            <strong>Step 1 — Arrival.</strong> Mark where you arrived. <strong>Existing customer:</strong> GPS uncertainty
            must be ≤ {GPS_THRESHOLD_METERS}m and you must be within {RADIUS_THRESHOLD_METERS}m of their pin.{' '}
            <strong>New lead:</strong> GPS uncertainty can be up to {GPS_THRESHOLD_NEW_LEAD_METERS}m. Then choose customer
            and tap <strong>Start visit</strong>.
          </p>
          <div className="inlineActions visitStartActions">
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
          <p className="muted visitStepIntro">
            <strong>Step 2 — Capture &amp; end.</strong> Open camera, capture photo, and tap <strong>End visit &amp; save</strong>.
            Leave location is captured automatically during capture/save.
          </p>
        </>
      )}

      {locationLocking ? (
        <p className="muted visitLockHint">
          Requesting location (usually under 20s). If this never finishes, check site permissions on your secure app URL.
        </p>
      ) : null}
      {geo && !locationLocking ? (
        <p className={`muted locationLockNote ${geo.accuracy <= displayedGpsThreshold ? 'ok' : 'warn'}`}>
          {visitSession ? 'Leave' : 'Arrival'} locked {formatDateTime(geo.capturedAt)} | {geo.lat.toFixed(6)},{' '}
          {geo.lng.toFixed(6)} | ±{Math.round(geo.accuracy)}m
        </p>
      ) : null}

      {!visitSession ? (
        <div className="formGrid visitStagePanel">
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
                Phone (10 digits)
                <input
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="9876543210"
                  value={quickLeadPhone}
                  onChange={(event) => setQuickLeadPhone(clampTenDigitMobileInput(event.target.value))}
                  title="10 digits; optional +91 is normalized automatically"
                />
              </label>
              <label>
                City
                <input value={quickLeadCity} onChange={(event) => setQuickLeadCity(event.target.value)} />
              </label>
              <label>
                Address
                <input value={quickLeadAddress} onChange={(event) => setQuickLeadAddress(event.target.value)} />
              </label>
            </>
          ) : null}

        </div>
      ) : (
        <div className="formGrid visitStagePanel">
          <div className="visitStageMain">
            <p className="muted">
              <strong>Customer:</strong> {visitSessionCustomerLabel}
              <br />
              <strong>Visit type:</strong> {visitSession.visitType}
              <br />
              <strong>Phone:</strong> {visitSession.quickLead.phone}
              <br />
              <strong>Address:</strong> {visitSession.quickLead.address}
              <br />
              <strong>City:</strong> {visitSession.quickLead.city}
            </p>
          </div>
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
          {activeDynamicFields.length ? (
            <div className="dynamic-fields-section">
              <p className="muted visitDynamicHeading">
                <strong>Additional visit details</strong>
              </p>
              <div className="dynamic-fields-grid">
                {activeDynamicFields.map((field) => {
                  const value = dynamicData[field.key] ?? ''
                  const requiredMark = field.required ? ' *' : ''
                  return (
                    <label key={field.id}>
                      {field.label}
                      {requiredMark}
                      {field.type === 'textarea' ? (
                        <textarea
                          value={value}
                          onChange={(event) =>
                            setDynamicData((prev) => ({ ...prev, [field.key]: event.target.value }))
                          }
                        />
                      ) : field.type === 'select' ? (
                        <select
                          value={value}
                          onChange={(event) =>
                            setDynamicData((prev) => ({ ...prev, [field.key]: event.target.value }))
                          }
                        >
                          <option value="">Select</option>
                          {field.options.map((option) => (
                            <option key={`${field.id}-${option}`} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                          value={value}
                          onChange={(event) =>
                            setDynamicData((prev) => ({ ...prev, [field.key]: event.target.value }))
                          }
                        />
                      )}
                    </label>
                  )
                })}
              </div>
            </div>
          ) : null}
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
            <div className="visitCameraHeader">
              <h4 className="visit-camera-title">
                <strong>Photo</strong> (camera only)
              </h4>
              <p className="muted">
                Open the camera and capture. The image includes timestamp and your <strong>leave</strong> location GPS.
                Gallery is not used. After a shot you can <strong>Retake</strong> or <strong>End visit &amp; save</strong> below.
              </p>
            </div>
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

          {photoPreview ? (
            <div className="visitCameraPreviewWrap">
              <img src={photoPreview} alt="Saved visit photo" className="photoPreview" />
            </div>
          ) : null}

          <div className="inlineActions visit-submit-actions">
            <button type="button" className="visit-submit-btn" onClick={() => void saveVisit()} disabled={savingVisit}>
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
                <div className="dashboardMetricGrid">
                  <div className="dashboardMetricTile softBlue">
                    <p className="dashboardMetricLabel">Customers</p>
                    <p className="dashboardMetricValue">{dedupedCustomers.length}</p>
                    <p className="dashboardMetricDesc">Unique customer records synced in CRM.</p>
                  </div>
                  <div className="dashboardMetricTile softPeach">
                    <p className="dashboardMetricLabel">Open follow-ups</p>
                    <p className="dashboardMetricValue">{openFollowUpsCount}</p>
                    <p className="dashboardMetricDesc">Pending and in-progress follow-up tasks.</p>
                  </div>
                  <div className="dashboardMetricTile softMint">
                    <p className="dashboardMetricLabel">Visits logged</p>
                    <p className="dashboardMetricValue">{syncedVisits.length}</p>
                    <p className="dashboardMetricDesc">Successfully synced field visits only.</p>
                  </div>
                </div>
                <p className="muted">Live updates: realtime sync with periodic 15s refresh fallback.</p>
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
                  <div className="dashboardMetricGrid">
                    <div className="dashboardMetricTile softLavender">
                      <p className="dashboardMetricLabel">Field salesmen</p>
                      <p className="dashboardMetricValue">{salesmen.length}</p>
                      <p className="dashboardMetricDesc">Active salesman/super-salesman profiles.</p>
                    </div>
                    <div className="dashboardMetricTile softSky">
                      <p className="dashboardMetricLabel">Total visits</p>
                      <p className="dashboardMetricValue">{syncedVisits.length}</p>
                      <p className="dashboardMetricDesc">All synced visits across your team.</p>
                    </div>
                    <div className="dashboardMetricTile softRose">
                      <p className="dashboardMetricLabel">Visits today</p>
                      <p className="dashboardMetricValue">{syncedVisitsTodayCount}</p>
                      <p className="dashboardMetricDesc">Synced visits captured on today&apos;s date.</p>
                    </div>
                  </div>
                </article>
              )}
              {(role === 'salesman' || role === 'super_salesman') && (
                <article className="card">
                  <h3>Follow-up snapshot</h3>
                  <div className="inlineFilters">
                    <label>
                      Follow-up from
                      <input
                        type="date"
                        value={salesmanFollowUpDateFrom}
                        onChange={(event) => setSalesmanFollowUpDateFrom(event.target.value)}
                      />
                    </label>
                    <label>
                      Follow-up to
                      <input
                        type="date"
                        value={salesmanFollowUpDateTo}
                        onChange={(event) => setSalesmanFollowUpDateTo(event.target.value)}
                      />
                    </label>
                  </div>
                  <p className="muted">Due today: {followUpsDueTodayForSalesman.length}</p>
                  <p className="muted">Overdue: {overdueFollowUpsForSalesman.length}</p>
                  <p className="muted">Matching selected range: {filteredPendingFollowUpsForSalesman.length}</p>
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
            {mapVisibleSalesmen.length ? (
              <div className="mapColorKey">
                {mapVisibleSalesmen.map((s) => (
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
                  salesmanName: mapVisibleSalesmen.find((x) => x.id === c.assignedSalesmanId)?.name,
                }))}
                livePoints={[]}
                recentVisits={filteredMapRecentVisits}
                salesmen={mapVisibleSalesmen}
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
              <div className="scrollArea overdueTableWrap">
                <table className="overdueTable">
                  <thead>
                    <tr>
                      <th className="overdueCompactCell">Salesman</th>
                      <th className="overdueCompactCell">Client</th>
                      <th className="overdueCompactCell">City</th>
                      <th className="overdueCompactCell">Phone</th>
                      <th className="overdueCompactCell">Due date</th>
                      <th className="overdueCompactCell">Priority</th>
                      <th className="overdueCompactCell">Status</th>
                      <th className="overdueLongCell">Remarks</th>
                      {activeDynamicFields.map((f) => (
                        <th key={f.id} className="dynamicFieldCol" title={f.label}>
                          {f.label}
                        </th>
                      ))}
                      <th className="overdueCompactCell">Last visit</th>
                      <th className="overdueCompactCell">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOverdueRowsDetailed.length === 0 ? (
                      <tr>
                        <td colSpan={10 + activeDynamicFields.length} className="muted">
                          No overdue follow-ups.
                        </td>
                      </tr>
                    ) : (
                      filteredOverdueRowsDetailed.flatMap((row) => {
                        const followUp = followUps.find((item) => item.id === row.id)
                        const isEditing = editingFollowUp?.id === row.id
                        const rows = [
                          <tr key={row.id}>
                            <td className="overdueCompactCell">{row.salesmanName}</td>
                            <td className="overdueCompactCell">{row.customerName}</td>
                            <td className="overdueCompactCell">{row.customerCity}</td>
                            <td className="overdueCompactCell">{row.customerPhone}</td>
                            <td className="overdueCompactCell">{formatDate(row.dueDate)}</td>
                            <td className="overdueCompactCell">{row.priority}</td>
                            <td className="overdueCompactCell">{row.status}</td>
                            <td className="overdueLongCell">{row.remarks || '—'}</td>
                            {activeDynamicFields.map((field) => {
                              const val = row.lastVisitDynamicFields?.[field.key] || row.customerDynamicFields?.[field.key]
                              return (
                                <td key={field.id} className="dynamicFieldCol" title={val || '—'}>
                                  {val || '—'}
                                </td>
                              )
                            })}
                            <td className="overdueCompactCell">
                              {row.lastVisitAt ? `${formatDate(row.lastVisitAt)} (${row.lastVisitType})` : '—'}
                            </td>
                            <td className="overdueCompactCell">
                              {followUp ? (
                                <div className="followupActions">
                                  {followUp.status !== 'closed' ? (
                                    <button type="button" onClick={() => void markFollowUpComplete(followUp.id)}>
                                      Complete
                                    </button>
                                  ) : null}
                                  <button type="button" className="secondary" onClick={(event) => {
                                    setEditingFollowUp({ ...followUp })
                                    const tableWrap = event.currentTarget.closest('.overdueTableWrap')
                                    requestAnimationFrame(() => {
                                      requestAnimationFrame(() => {
                                        const scopedEditRow =
                                          tableWrap instanceof HTMLElement
                                            ? tableWrap.querySelector('.followupEditRow')
                                            : document.querySelector('.followupEditRow')
                                        if (scopedEditRow instanceof HTMLElement) {
                                          scopedEditRow.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' })
                                        }
                                      })
                                    })
                                  }}>
                                    Edit
                                  </button>
                                </div>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>,
                        ]
                        if (isEditing && editingFollowUp) {
                          rows.push(
                            <tr key={`${row.id}-edit`} className="followupEditRow">
                              <td colSpan={10 + activeDynamicFields.length}>
                                <div className="followupEditCard">
                                  <div className="followupEditHeader">
                                    <div>
                                      <strong>Edit follow-up</strong>
                                      <p className="muted">Update the due date, status, priority, and remarks in one place.</p>
                                    </div>
                                  </div>
                                  <div className="followupEditGrid">
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
                                        onChange={(e) =>
                                          setEditingFollowUp({ ...editingFollowUp, priority: e.target.value as FollowUp['priority'] })
                                        }
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
                                        onChange={(e) =>
                                          setEditingFollowUp({ ...editingFollowUp, status: e.target.value as FollowUpStatus })
                                        }
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
                                  </div>
                                  <div className="followupEditActions">
                                    <button type="button" onClick={() => void saveFollowUpEdit(editingFollowUp)}>
                                      Save
                                    </button>
                                    <button type="button" className="secondary" onClick={() => setEditingFollowUp(null)}>
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>,
                          )
                        }
                        return rows
                      })
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
            <div className="rowBetween" style={{ alignItems: 'center' }}>
              <h2>Meeting responses</h2>
            </div>
            {(role === 'owner' || role === 'sub_admin') ? (
              <article className="card">
                <h3>Dynamic form fields</h3>
                <p className="muted">
                  Add or delete dynamic visit fields. Existing fields are intentionally non-editable for safety.
                </p>
                <div className="dynamic-fields-admin-form">
                  <label>
                    Field label
                    <input
                      value={newFieldLabel}
                      onChange={(event) => setNewFieldLabel(event.target.value)}
                      placeholder="e.g. Dealer category"
                    />
                  </label>
                  <label>
                    Type
                    <select value={newFieldType} onChange={(event) => setNewFieldType(event.target.value as FormField['type'])}>
                      <option value="text">Text</option>
                      <option value="textarea">Textarea</option>
                      <option value="number">Number</option>
                      <option value="date">Date</option>
                      <option value="select">Select</option>
                    </select>
                  </label>
                  <label>
                    Required
                    <select
                      value={newFieldRequired ? 'yes' : 'no'}
                      onChange={(event) => setNewFieldRequired(event.target.value === 'yes')}
                    >
                      <option value="no">No</option>
                      <option value="yes">Yes</option>
                    </select>
                  </label>
                  {newFieldType === 'select' ? (
                    <label>
                      Options (comma separated)
                      <input
                        value={newFieldOptions}
                        onChange={(event) => setNewFieldOptions(event.target.value)}
                        placeholder="A, B, C"
                      />
                    </label>
                  ) : null}
                </div>
                <div className="inlineActions">
                  <button type="button" onClick={() => void addDynamicField()} disabled={savingFormField}>
                    {savingFormField ? 'Adding…' : 'Add new field'}
                  </button>
                </div>
                <div className="scrollAreaSettings">
                  <table>
                    <thead>
                      <tr>
                        <th>Label</th>
                        <th>Key</th>
                        <th>Type</th>
                        <th>Required</th>
                        <th>Options</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeDynamicFields.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="muted">
                            No active dynamic fields.
                          </td>
                        </tr>
                      ) : (
                        activeDynamicFields.map((field) => (
                          <tr key={field.id}>
                            <td>{field.label}</td>
                            <td>{field.key}</td>
                            <td>{field.type}</td>
                            <td>{field.required ? 'Yes' : 'No'}</td>
                            <td>{field.options.length ? field.options.join(', ') : '—'}</td>
                            <td>
                              <button
                                type="button"
                                className="secondary danger"
                                onClick={() => void softDeleteDynamicField(field)}
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </article>
            ) : null}
            <article className="card">
              <div className="inlineFilters">
                <label>
                  Date
                  <input type="date" value={meetingDateFilter} onChange={(event) => setMeetingDateFilter(event.target.value)} />
                </label>
                {role !== 'salesman' ? (
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
                ) : null}
                {role === 'owner' && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      const headers = ['Time', 'Salesman', 'Customer', 'Phone', 'Response', 'Next action', ...activeDynamicFields.map((f) => f.label)];
                      const rows = meetingRowsDetailed.map(({ item, linkedVisit, customerPhone, dynamicValues }) => {
                        return [
                          formatDateTime(item.createdAt),
                          item.salesmanName,
                          item.customerName,
                          customerPhone,
                          item.response,
                          linkedVisit?.nextAction || '—',
                          ...dynamicValues,
                        ];
                      });
                      exportToCsv(`meeting_responses_${new Date().toISOString().slice(0, 10)}`, headers, rows);
                    }}
                    style={{ display: 'flex', alignItems: 'center', marginLeft: 'auto' }}
                  >
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ marginRight: '6px' }}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                    Export Data
                  </button>
                )}
              </div>
              <div className="scrollArea meetingResponsesTableWrap">
                <table className="meetingResponsesTable">
                  <thead>
                    <tr>
                      <th className="meetingCompactCell">Time</th>
                      {role !== 'salesman' ? <th className="meetingCompactCell">Salesman</th> : null}
                      <th className="meetingCompactCell">Customer</th>
                      <th className="meetingCompactCell">Phone</th>
                      <th className="meetingCompactCell">Due date</th>
                      <th className="meetingCompactCell">Priority</th>
                      <th className="meetingCompactCell">Status</th>
                      <th className="meetingLongCell">Notes / Response</th>
                      <th className="meetingLongCell">Next action</th>
                      {activeDynamicFields.map((field) => (
                        <th key={field.id} className="dynamicFieldCol" title={field.label}>
                          {field.label}
                        </th>
                      ))}
                      <th className="meetingCompactCell">Photo</th>
                      <th className="meetingCompactCell">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {meetingRowsDetailed.slice(0, 80).flatMap(({ item, linkedVisit, customerPhone, dynamicValues }) => {
                      const isEditing = editingMeetingResponse?.id === item.id
                      const linkedCustomerId = linkedVisit?.customerId
                      const linkedFollowUp = linkedCustomerId
                        ? followUps.find((f) => f.customerId === linkedCustomerId)
                        : undefined
                      const rows = [
                        <tr key={item.id}>
                          <td className="meetingCompactCell">{formatDateTime(item.createdAt)}</td>
                          {role !== 'salesman' ? <td className="meetingCompactCell">{item.salesmanName}</td> : null}
                          <td className="meetingCompactCell">{item.customerName}</td>
                          <td className="meetingCompactCell">{customerPhone}</td>
                          <td className="meetingCompactCell">
                            {linkedFollowUp ? formatDate(linkedFollowUp.dueDate) : '—'}
                          </td>
                          <td className="meetingCompactCell">
                            {linkedFollowUp ? (
                              <span className={`followupPill followupPill--${linkedFollowUp.priority}`}>
                                {linkedFollowUp.priority}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="meetingCompactCell">
                            {linkedFollowUp ? (
                              <span className={`followupStatus followupStatus--${linkedFollowUp.status}`}>
                                {linkedFollowUp.status.replace(/_/g, ' ')}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="meetingLongCell">{item.response}</td>
                          <td className="meetingLongCell">{linkedVisit?.nextAction || '—'}</td>
                          {dynamicValues.map((value, idx) => (
                            <td
                              key={`${item.id}-dynamic-${activeDynamicFields[idx]?.id ?? idx}`}
                              className="dynamicFieldCol"
                              title={value}
                            >
                              {value}
                            </td>
                          ))}
                          <td className="meetingCompactCell">
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
                          <td className="meetingCompactCell">
                            <div className="followupActions">
                              <button
                                type="button"
                                className="secondary"
                                onClick={(event) => {
                                  setEditingMeetingResponse({ id: item.id, response: item.response })
                                  if (linkedFollowUp) setEditingFollowUp({ ...linkedFollowUp })
                                  const tableWrap = event.currentTarget.closest('.meetingResponsesTableWrap')
                                  requestAnimationFrame(() => {
                                    requestAnimationFrame(() => {
                                      const scopedEditRow =
                                        tableWrap instanceof HTMLElement
                                          ? tableWrap.querySelector('.followupEditRow')
                                          : document.querySelector('.followupEditRow')
                                      if (scopedEditRow instanceof HTMLElement) {
                                        scopedEditRow.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' })
                                      }
                                    })
                                  })
                                }}
                              >
                                Edit
                              </button>
                            </div>
                          </td>
                        </tr>,
                      ]
                      if (isEditing && editingMeetingResponse) {
                        rows.push(
                          <tr key={`${item.id}-edit`} className="followupEditRow">
                            <td colSpan={(role !== 'salesman' ? 11 : 10) + activeDynamicFields.length}>
                              <div className="followupEditCard">
                                <div className="followupEditHeader">
                                  <div>
                                    <strong>Edit meeting response</strong>
                                    <p className="muted">Update the response and linked follow-up details in one place.</p>
                                  </div>
                                </div>
                                <div className="followupEditGrid meetingEditGrid">
                                  {editingFollowUp && editingFollowUp.customerId === linkedCustomerId ? (
                                    <>
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
                                          onChange={(e) =>
                                            setEditingFollowUp({ ...editingFollowUp, priority: e.target.value as FollowUp['priority'] })
                                          }
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
                                          onChange={(e) =>
                                            setEditingFollowUp({ ...editingFollowUp, status: e.target.value as FollowUpStatus })
                                          }
                                        >
                                          <option value="pending">Pending</option>
                                          <option value="in_progress">In progress</option>
                                          <option value="closed">Closed</option>
                                        </select>
                                      </label>
                                    </>
                                  ) : null}
                                  <label className="meetingResponseLabel">
                                    Response
                                    <textarea
                                      value={editingMeetingResponse.response}
                                      onChange={(event) =>
                                        setEditingMeetingResponse({ ...editingMeetingResponse, response: event.target.value })
                                      }
                                    />
                                  </label>
                                </div>
                                <div className="followupEditActions">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void saveMeetingResponseEdit(editingMeetingResponse)
                                      if (editingFollowUp && editingFollowUp.customerId === linkedCustomerId) {
                                        void saveFollowUpEdit(editingFollowUp)
                                      }
                                    }}
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    className="secondary"
                                    onClick={() => {
                                      setEditingMeetingResponse(null)
                                      setEditingFollowUp(null)
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>,
                        )
                      }
                      return rows
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
              {/* <p className="muted settingsLead">Account security and team access for Whiterock Field Salesman.</p> */}
            </div>

            <article className="card settingsCard">
              <h3>Account</h3>
              {/* <p className="muted">
                Your role comes from the invite list. Sign in with <strong>email and password</strong> using the same
                email you were invited with.
              </p> */}
              {authSession?.user?.user_metadata?.full_name ? (
                <p>
                  <strong>Name:</strong> {authSession.user.user_metadata.full_name}
                </p>
              ) : null}
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
                {/* <p className="muted">Use a new password that meets the same rules as at sign-up. You can change it anytime.</p>
                {settingsPasswordMessage ? <p className="muted">{settingsPasswordMessage}</p> : null} */}
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
                {/* <p className="muted">
                  {supabaseEnabled ? (
                    <>
                      Set their <strong>initial password</strong> here (they can change it later under Settings). 
                    </>
                  ) : null}
                  <strong>Owner</strong> can invite owner, salesman, sub-admin, and super-salesman.{' '}
                  <strong>Sub-admin</strong> can invite salesman and super-salesman. <strong>Super-salesman</strong> can
                  invite salesman.
                </p> */}
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
                    Phone number (optional, 10 digits)
                    <input
                      inputMode="numeric"
                      autoComplete="tel"
                      value={invitePhone}
                      onChange={(event) => setInvitePhone(clampTenDigitMobileInput(event.target.value))}
                      placeholder="9876543210 or +91 9876543210"
                      title="Up to 10 digits; optional +91 is normalized automatically"
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
                {/* <p className="muted">
                  Only these invited emails can access the app. Admins assign the initial password when adding a user.
                </p> */}
                <div className="scrollAreaSettings settingsTableWrap">
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
                              <td className="muted settingsDateCell">{formatDateTime(u.addedAt)}</td>
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
                {/* <p className="muted">Live roles from Supabase <code>profiles</code> (used for visits and permissions).</p> */}
                <div className="scrollAreaSettings settingsTableWrap">
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
                      <th>Date</th>
                      <th>Salesman</th>
                      <th>Total Visits</th>
                      <th>First meeting</th>
                      <th>Last meeting</th>
                      <th>Total working hrs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredKpiRows.map((item) => (
                      <tr key={`${item.salesmanId}-${item.date}`}>
                        <td>{formatDate(item.date)}</td>
                        <td>{item.salesmanName}</td>
                        <td>{item.visitCount}</td>
                        <td>{item.firstVisitTime}</td>
                        <td>{item.lastVisitTime}</td>
                        <td>{item.totalWorkingHours}</td>
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
                  Follow-up from
                  <input
                    type="date"
                    value={salesmanFollowUpDateFrom}
                    onChange={(event) => setSalesmanFollowUpDateFrom(event.target.value)}
                  />
                </label>
                <label>
                  Follow-up to
                  <input
                    type="date"
                    value={salesmanFollowUpDateTo}
                    onChange={(event) => setSalesmanFollowUpDateTo(event.target.value)}
                  />
                </label>
                <label>
                  Priority
                  <select
                    value={salesmanFollowUpPriorityFilter}
                    onChange={(event) =>
                      setSalesmanFollowUpPriorityFilter(event.target.value as 'all' | FollowUp['priority'])
                    }
                  >
                    <option value="all">All priorities</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>
                <label>
                  Archived
                  <button
                    type="button"
                    className={`switchToggle${salesmanFollowUpArchiveFilter ? ' isOn' : ''}`}
                    role="switch"
                    aria-checked={salesmanFollowUpArchiveFilter}
                    aria-label="Show archived follow-ups"
                    onClick={() => setSalesmanFollowUpArchiveFilter((prev) => !prev)}
                  >
                    <span className="switchTrack" aria-hidden><span className="switchThumb" /></span>
                  </button>
                </label>
              </div>
              <p className="muted">
                Due today: {followUpsDueTodayForSalesman.length} · Overdue: {overdueFollowUpsForSalesman.length} · Archived:{' '}
                {archivedFollowUpsForSalesman.length}
              </p>
              <div className="followupTableWrap">
                <table className="followupTable">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      {role !== 'salesman' ? <th>Salesman</th> : null}
                      <th>City</th>
                      <th>Due date</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th className="followupRemarksCell">Remarks</th>
                      {activeDynamicFields.map((f) => <th key={f.id} className='dynamicFieldCol'>{f.label}</th>)}
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFollowUpsForSalesman.length === 0 ? (
                      <tr>
                        <td colSpan={(role !== 'salesman' ? 8 : 7) + activeDynamicFields.length} className="muted">
                          No follow-ups match the selected filters.
                        </td>
                      </tr>
                    ) : (
                      filteredFollowUpsForSalesman.flatMap((item) => {
                        const customer = customers.find((entry) => entry.id === item.customerId)
                        const salesmanName = salesmen.find((entry) => entry.id === item.salesmanId)?.name ?? 'Salesman'
                        const customerCity = customer?.city ?? 'Unknown city'
                        const isEditing = editingFollowUp?.id === item.id
                        const rows = [
                          <tr key={item.id}>
                            <td className="followupCustomerCell">
                              <div className="followupCustomerHead">
                                <div className="followupCustomerName">{customer?.name ?? 'Unknown customer'}</div>
                                <div className="followupArchiveToggle">
                                  <button
                                    type="button"
                                    className={`switchToggle switchToggle--compact${item.archived ? ' isOn' : ''}`}
                                    role="switch"
                                    aria-checked={item.archived}
                                    aria-label="Archive follow-up"
                                    disabled={archivingFollowUpId === item.id}
                                    onClick={() => void toggleFollowUpArchived(item.id, !item.archived)}
                                  >
                                    <span className="switchTrack" aria-hidden><span className="switchThumb" /></span>
                                  </button>
                                  <span>Archive</span>
                                </div>
                              </div>
                            </td>
                            {role !== 'salesman' ? (
                              <td className="followupSalesmanCell followupCompactCell">{salesmanName}</td>
                            ) : null}
                            <td className="followupCityCell followupCompactCell">{customerCity}</td>
                            <td className="followupDateCell followupCompactCell">{formatDate(item.dueDate)}</td>
                            <td className="followupCompactCell">
                              <span className={`followupPill followupPill--${item.priority}`}>
                                {item.priority}
                              </span>
                            </td>
                            <td className="followupCompactCell">
                              <span className={`followupStatus followupStatus--${item.status}`}>
                                {item.status.replace(/_/g, ' ')}
                              </span>
                            </td>
                            <td className="followupRemarksCell">
                              <div className="followupRemarks">{item.remarks || 'No remarks added'}</div>
                            </td>
                            {activeDynamicFields.map((field) => {
                              const vFields = latestVisitByCustomerId.get(item.customerId)?.dynamicFields
                              const cFields = customer?.dynamicFields
                              const val = vFields?.[field.key] || cFields?.[field.key]
                              return <td key={field.id} className="followupCompactCell dynamicFieldCol">{val || '—'}</td>
                            })}
                            <td>
                              <div className="followupActions">
                                {item.status !== 'closed' ? (
                                  <button type="button" onClick={() => void markFollowUpComplete(item.id)}>
                                    Complete
                                  </button>
                                ) : null}
                                <button type="button" className="secondary" onClick={(event) => {
                                  setEditingFollowUp({ ...item })
                                  const tableWrap = event.currentTarget.closest('.followupTableWrap')
                                  requestAnimationFrame(() => {
                                    requestAnimationFrame(() => {
                                      const scopedEditRow =
                                        tableWrap instanceof HTMLElement
                                          ? tableWrap.querySelector('.followupEditRow')
                                          : document.querySelector('.followupEditRow')
                                      if (scopedEditRow instanceof HTMLElement) {
                                        scopedEditRow.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' })
                                      }
                                    })
                                  })
                                }}>
                                  Edit
                                </button>
                              </div>
                            </td>
                          </tr>,
                        ]
                        if (isEditing && editingFollowUp) {
                          rows.push(
                            <tr key={`${item.id}-edit`} className="followupEditRow">
                              <td colSpan={(role !== 'salesman' ? 8 : 7) + activeDynamicFields.length}>
                                <div className="followupEditCard">
                                  <div className="followupEditHeader">
                                    <div>
                                      <strong>Edit follow-up</strong>
                                      <p className="muted">Update the due date, status, priority, and remarks in one place.</p>
                                    </div>
                                  </div>
                                  <div className="followupEditGrid">
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
                                        onChange={(e) =>
                                          setEditingFollowUp({ ...editingFollowUp, priority: e.target.value as FollowUp['priority'] })
                                        }
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
                                        onChange={(e) =>
                                          setEditingFollowUp({ ...editingFollowUp, status: e.target.value as FollowUpStatus })
                                        }
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
                                  </div>
                                  <div className="followupEditActions">
                                    <button type="button" onClick={() => void saveFollowUpEdit(editingFollowUp)}>
                                      Save
                                    </button>
                                    <button type="button" className="secondary" onClick={() => setEditingFollowUp(null)}>
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>,
                          )
                        }
                        return rows
                      })
                    )}
                  </tbody>
                </table>
              </div>
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
                      {formatDateTime(point.time)} — {point.lat.toFixed(5)}, {point.lng.toFixed(5)} (±{Math.round(point.accuracy)}m)
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
            <div className="myCustomersHeader">
              <h2>My customers</h2>
              <label className="myCustomersSearchWrap">
                <input
                  className="myCustomersSearchInput"
                  value={myCustomersNameFilter}
                  onChange={(event) => setMyCustomersNameFilter(event.target.value)}
                  placeholder="Search customer by name"
                />
              </label>
            </div>
            <article className="card">
              <div className="customersTableWrap">
                <table className="customersTable">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>City</th>
                      <th>Phone</th>
                      {/* <th>Tags</th> */}
                      {role !== 'salesman' ? <th>Salesperson</th> : null}
                      {activeDynamicFields.map((f) => <th key={f.id} className="dynamicFieldCol">{f.label}</th>)}
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMyCustomers.length === 0 ? (
                      <tr>
                        <td colSpan={(role !== 'salesman' ? 5 : 4) + activeDynamicFields.length} className="muted">
                          No customers match this search.
                        </td>
                      </tr>
                    ) : (
                      filteredMyCustomers.map((item) => (
                        <tr key={item.id}>
                          <td className="customersNameCell"><strong>{item.name}</strong></td>
                          <td className="customersCompactCell">{item.city}</td>
                          <td className="customersCompactCell">{item.phone}</td>
                          {/* <td className="customersTagsCell">
                            {item.tags.length ? (
                              <div className="customerTagChips">
                                {item.tags.map((tag, index) => (
                                  <span key={`${item.id}-${tag}-${index}`} className="customerTagChip">
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="customerEmptyChip">—</span>
                            )}
                          </td> */}
                          {role !== 'salesman' ? (
                            <td className="customersSalesmanCell">
                              <span className="customerMetaPill customerMetaPill--subtle">
                                {profileNameById.get(item.assignedSalesmanId) ?? 'Unassigned'}
                              </span>
                            </td>
                          ) : null}
                          {activeDynamicFields.map((field) => {
                            const val = item.dynamicFields?.[field.key]
                            return (
                              <td key={field.id} className="customersTagsCell dynamicFieldCol">
                                {val ? val : <span className="customerEmptyChip">—</span>}
                              </td>
                            )
                          })}
                          <td>
                            <div className="customerActions">
                              <a
                                className="customerActionBtn"
                                href={googleMapsSearchUrl(item.lat, item.lng)}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                Google Maps
                              </a>
                              <button type="button" className="customerActionBtn" onClick={() => setActiveView('map')}>
                                In-app map
                              </button>
                            </div>
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
      case 'visits':
        return (
          <section className="panel">
            <article className="card">
              <div className="rowBetween" style={{ alignItems: 'center' }}>
                <h3>Visit history</h3>
                {role === 'owner' ? (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void exportVisitHistoryCsv()}
                    style={{ display: 'flex', alignItems: 'center' }}
                  >
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ marginRight: '6px' }}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                    Export Data
                  </button>
                ) : null}
              </div>
              <div className="inlineFilters">
                <label>
                  Date
                  <input type="date" value={visitHistoryDateFilter} onChange={(event) => setVisitHistoryDateFilter(event.target.value)} />
                </label>
                {role !== 'salesman' ? (
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
                ) : null}
                <label>
                  Client name
                  <input
                    value={visitHistoryClientFilter}
                    onChange={(event) => setVisitHistoryClientFilter(event.target.value)}
                    placeholder="Search client"
                  />
                </label>
                {role !== 'salesman' ? (
                  <label>
                    City
                    <input
                      value={visitHistoryCityFilter}
                      onChange={(event) => setVisitHistoryCityFilter(event.target.value)}
                      placeholder="Search city"
                    />
                  </label>
                ) : null}
              </div>
              <div className="scrollArea visitsTableWrap">
                <table className="visitsTable">
                  <thead>
                    <tr>
                      <th>Arrived</th>
                      <th>Ended</th>
                      {role !== 'salesman' ? <th>Salesman</th> : null}
                      <th>Customer</th>
                      <th>City</th>
                      <th>Type</th>
                      <th>GPS</th>
                      <th>Status</th>
                      {activeDynamicFields.map((f) => <th key={f.id} className="dynamicFieldCol">{f.label}</th>)}
                      <th>Photo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visitHistoryRows.length === 0 ? (
                      <tr>
                        <td colSpan={(role !== 'salesman' ? 9 : 8) + activeDynamicFields.length} className="muted">
                          No visits found for the selected filters.
                        </td>
                      </tr>
                    ) : (
                      visitHistoryRows.flatMap((visit) => {
                        const customer = customerById.get(visit.customerId)
                        const isExpanded = selectedVisitHistoryRowId === visit.id && selectedVisitClientId === visit.customerId
                        const parentRow = (
                          <tr key={visit.id}>
                            <td>
                              {visit.visitStartedAt ? formatDateTime(visit.visitStartedAt) : '—'}
                            </td>
                            <td>{formatDateTime(visit.capturedAt)}</td>
                            {role !== 'salesman' ? <td>{visit.salesmanName}</td> : null}
                            <td>
                              <div className="visitCustomerCell">
                                <span>{visit.customerName}</span>
                                <button
                                  type="button"
                                  className={`secondary visitHistoryToggle${isExpanded ? ' isOpen' : ''}`}
                                  title={isExpanded ? 'Hide client history' : 'View client history'}
                                  aria-label={isExpanded ? 'Hide client history' : 'View client history'}
                                  onClick={() => {
                                    if (isExpanded) {
                                      setSelectedVisitClientId(null)
                                      setSelectedVisitHistoryRowId(null)
                                      return
                                    }
                                    setSelectedVisitClientId(visit.customerId)
                                    setSelectedVisitHistoryRowId(visit.id)
                                  }}
                                >
                                  <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-3.3-6.9M21 4v5h-5" />
                                  </svg>
                                </button>
                              </div>
                            </td>
                            <td>{customer?.city ?? '—'}</td>
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
                            {activeDynamicFields.map((field) => {
                              const val = visit.dynamicFields?.[field.key] || customer?.dynamicFields?.[field.key]
                              return <td key={field.id} className="dynamicFieldCol">{val || '—'}</td>
                            })}
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
                        )
                        if (!isExpanded) return [parentRow]
                        const expandedRow = (
                          <tr key={`${visit.id}-history`} className="visitHistoryExpandedRow">
                            <td colSpan={(role !== 'salesman' ? 9 : 8) + activeDynamicFields.length}>
                              <div className="visitHistoryMeta">
                                <strong>{visit.customerName}</strong>
                                <span>Total visits: {selectedVisitClientVisits.length}</span>
                              </div>
                              <div className="visitHistoryNestedWrap">
                                <table className="visitHistoryNestedTable visitsTable">
                                  <thead>
                                    <tr>
                                      <th>Arrived</th>
                                      <th>Ended</th>
                                      {role !== 'salesman' ? <th>Salesman</th> : null}
                                      <th>Type</th>
                                      <th>GPS</th>
                                      <th>Status</th>
                                      <th>Notes</th>
                                      <th>Next Action</th>
                                      <th>Follow-up</th>
                                      {activeDynamicFields.map((f) => <th key={`nested-head-${f.id}`} className="dynamicFieldCol">{f.label}</th>)}
                                      <th>Photo</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {selectedVisitClientVisits.map((clientVisit) => (
                                      <tr key={`history-${clientVisit.id}`}>
                                        <td>{clientVisit.visitStartedAt ? formatDateTime(clientVisit.visitStartedAt) : '—'}</td>
                                        <td>{formatDateTime(clientVisit.capturedAt)}</td>
                                        {role !== 'salesman' ? <td>{clientVisit.salesmanName}</td> : null}
                                        <td>{clientVisit.visitType}</td>
                                        <td>
                                          {clientVisit.lat.toFixed(4)}, {clientVisit.lng.toFixed(4)} (±{Math.round(clientVisit.accuracy)}m){' '}
                                          <a
                                            href={googleMapsSearchUrl(clientVisit.lat, clientVisit.lng)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="muted"
                                            style={{ fontSize: '0.78rem', marginLeft: '0.35rem' }}
                                          >
                                            Maps
                                          </a>
                                        </td>
                                        <td>{clientVisit.status}</td>
                                        <td className="visitHistoryNotesCell">{clientVisit.notes || '—'}</td>
                                        <td>{clientVisit.nextAction || '—'}</td>
                                        <td>{clientVisit.followUpDate ? formatDate(clientVisit.followUpDate) : '—'}</td>
                                        {activeDynamicFields.map((field) => {
                                          const customerValue = selectedVisitClient?.dynamicFields?.[field.key]
                                          const value = clientVisit.dynamicFields?.[field.key] || customerValue
                                          return <td key={`${clientVisit.id}-${field.id}`} className="dynamicFieldCol">{value || '—'}</td>
                                        })}
                                        <td>
                                          <button
                                            type="button"
                                            className="secondary"
                                            disabled={!clientVisit.photoDataUrl?.trim() || visitPhotoOpeningId === clientVisit.id}
                                            onClick={() => void openVisitPhoto(clientVisit)}
                                          >
                                            {visitPhotoOpeningId === clientVisit.id ? 'Opening…' : 'View'}
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )
                        return [parentRow, expandedRow]
                      })
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
        forgotPasswordMessage={forgotPasswordMessage}
        forgotPasswordMessageIsError={forgotPasswordMessageIsError}
        isForgotPasswordBusy={forgotPasswordBusy}
        onForgotPasswordSendOtp={sendForgotPasswordOtp}
        onForgotPasswordVerifyOtp={verifyForgotPasswordOtp}
        onForgotPasswordReset={resetForgotPassword}
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
            {authSession?.user?.user_metadata?.full_name ? (
              <span className="topUserEmail" title="Signed-in account">
                {authSession.user.user_metadata.full_name}
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
          {message ? <p className={`message ${messageLooksLikeError ? 'messageError' : 'messageInfo'}`}>{message}</p> : null}
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
