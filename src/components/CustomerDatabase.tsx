/*
 * Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
 * © 2026 WhiteRock (Royal Enterprise). All rights reserved.
 *
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { exportToCsv } from '../lib/exportUtils'
import { formatDateTime } from '../lib/dateUtils'
import type { Role } from '../lib/roles'
import { SearchableCityDropdown } from './SearchableCityDropdown'
import type { CityMaster } from '../App'

/* ───────────── Local types (mirrors App.tsx – avoids circular imports) ───────────── */

type CustomerRecord = {
  id: string
  name: string
  phone: string
  whatsapp: string
  address: string
  city: string
  cityId: string | null
  tags: string[]
  assignedSalesmanId: string
  lat: number
  lng: number
  dynamicFields?: Record<string, string>
  updatedAt?: string
}

type DynamicField = {
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

type SalesmanInfo = { id: string; name: string }

/* ───────────── Props ───────────── */

export type CustomerDatabaseProps = {
  cities: CityMaster[]
  customers: CustomerRecord[]
  salesmen: SalesmanInfo[]
  formFields: DynamicField[]
  profileNameById: Map<string, string>
  role: Role
  activeSalesmanId: string
  currentUserId: string
  onDataChanged: () => void
}

/* ───────────── Helpers ───────────── */

function dynamicVal(c: CustomerRecord, key: string): string {
  return c.dynamicFields?.[key] ?? ''
}

/** Try to find a dynamic field whose key or label matches (case-insensitive). */
function findFieldByHint(fields: DynamicField[], hints: string[]): DynamicField | undefined {
  const lower = hints.map(h => h.toLowerCase())
  return fields.find(f =>
    lower.includes(f.key.toLowerCase()) || lower.includes(f.label.toLowerCase()),
  )
}

function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []
  
  const parseLine = (line: string) => {
    const result = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        if (inQuotes && line[i+1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    result.push(current.trim())
    return result
  }

  const headers = parseLine(lines[0])
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i])
    const rowObj: Record<string, string> = {}
    headers.forEach((h, idx) => {
      rowObj[h] = values[idx] || ''
    })
    rows.push(rowObj)
  }
  return rows
}

/* ───────────── Component ───────────── */

export function CustomerDatabase({
  cities,
  customers,
  salesmen,
  formFields,
  profileNameById,
  role,
  activeSalesmanId,
  currentUserId,
  onDataChanged,
}: CustomerDatabaseProps) {
  /* ── active dynamic fields ── */
  const activeDynamicFields = useMemo(
    () => formFields.filter(f => f.active && !f.isDeleted).sort((a, b) => a.order - b.order),
    [formFields],
  )

  /* ── identify special filter fields from dynamic fields ── */
  const stateField = useMemo(() => findFieldByHint(activeDynamicFields, ['state']), [activeDynamicFields])
  const customerTypeField = useMemo(
    () => findFieldByHint(activeDynamicFields, ['customer_type', 'customer type']),
    [activeDynamicFields],
  )
  const firmField = useMemo(
    () => findFieldByHint(activeDynamicFields, ['firm', 'firm_name', 'firm name']),
    [activeDynamicFields]
  )

  /* ── scope data by role ── */
  const scopedCustomers = useMemo(() => {
    if (role === 'salesman') return customers.filter(c => c.assignedSalesmanId === activeSalesmanId)
    return customers
  }, [customers, role, activeSalesmanId])

  /* ── filter state ── */
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [salesmanFilter, setSalesmanFilter] = useState('all')
  const [cityFilterId, setCityFilterId] = useState('')
  const [stateFilterVal, setStateFilterVal] = useState('all')
  const [customerTypeFilterVal, setCustomerTypeFilterVal] = useState('all')

  /* debounce search */
  useEffect(() => {
    const t = window.setTimeout(() => setSearchDebounced(search), 400)
    return () => window.clearTimeout(t)
  }, [search])

  /* ── edit modal state ── */
  const [editingCustomer, setEditingCustomer] = useState<CustomerRecord | null>(null)
  const [editForm, setEditForm] = useState<{
    name: string; phone: string; city: string; cityId: string; address: string; whatsapp: string
    assignedSalesmanId: string; dynamicFields: Record<string, string>
  }>({ name: '', phone: '', city: '', cityId: '', address: '', whatsapp: '', assignedSalesmanId: '', dynamicFields: {} })
  const [saving, setSaving] = useState(false)
  const [editMessage, setEditMessage] = useState('')
  const editFormRef = useRef<HTMLFormElement>(null)

  /* ── bulk assign state ── */
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<string>>(new Set())
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false)
  const [bulkAssignSalesmanId, setBulkAssignSalesmanId] = useState('')
  const [isBulkAssigning, setIsBulkAssigning] = useState(false)
  const [bulkAssignError, setBulkAssignError] = useState('')

  /* ── audit log state ── */
  const [auditLogCustomer, setAuditLogCustomer] = useState<CustomerRecord | null>(null)
  const [auditLogs, setAuditLogs] = useState<any[]>([])
  const [loadingAudit, setLoadingAudit] = useState(false)

  /* ── csv upload state ── */
  const [csvUploadOpen, setCsvUploadOpen] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [csvMessage, setCsvMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  /* ── computed filter options ── */

  const uniqueStates = useMemo(() => {
    if (!stateField) return []
    return [...new Set(scopedCustomers.map(c => dynamicVal(c, stateField.key)).filter(Boolean))].sort()
  }, [scopedCustomers, stateField])

  const uniqueCustomerTypes = useMemo(() => {
    if (!customerTypeField) return []
    return [...new Set(scopedCustomers.map(c => dynamicVal(c, customerTypeField.key)).filter(Boolean))].sort()
  }, [scopedCustomers, customerTypeField])

  /* ── filtered data ── */
  const filtered = useMemo(() => {
    const q = searchDebounced.trim().toLowerCase()
    return scopedCustomers.filter(c => {
      // text search: name, phone, city, firm name
      if (q) {
        const firmValue = firmField ? dynamicVal(c, firmField.key) : ''
        const haystack = [c.name, c.phone, c.city, firmValue].join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      if (salesmanFilter !== 'all' && c.assignedSalesmanId !== salesmanFilter) return false
      if (cityFilterId) {
        if (c.cityId && c.cityId !== cityFilterId) return false
        if (!c.cityId) {
          const filterCityName = cities.find(x => x.id === cityFilterId)?.name
          if (filterCityName && c.city !== filterCityName) return false
        }
      }
      if (stateFilterVal !== 'all' && stateField && dynamicVal(c, stateField.key) !== stateFilterVal) return false
      if (customerTypeFilterVal !== 'all' && customerTypeField && dynamicVal(c, customerTypeField.key) !== customerTypeFilterVal) return false
      return true
    })
  }, [scopedCustomers, searchDebounced, salesmanFilter, cityFilterId, stateFilterVal, customerTypeFilterVal, stateField, customerTypeField, firmField, cities])

  /* ── open edit modal ── */
  const openEdit = useCallback((c: CustomerRecord) => {
    setEditingCustomer(c)
    setEditForm({
      name: c.name,
      phone: c.phone,
      city: c.city,
      cityId: c.cityId || '',
      address: c.address,
      whatsapp: c.whatsapp,
      assignedSalesmanId: c.assignedSalesmanId,
      dynamicFields: { ...(c.dynamicFields ?? {}) },
    })
    setEditMessage('')
  }, [])

  /* ── save edit ── */
  const handleSaveEdit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingCustomer || !supabase) return
    setSaving(true)
    setEditMessage('')

    try {
      if (!editForm.cityId) {
        setEditMessage('Error: You must select a valid active city from the dropdown.')
        setSaving(false)
        return
      }

      // Build changed fields for audit
      const changedFields: Record<string, { old: string; new: string }> = {}
      const orig = editingCustomer

      if (editForm.name !== orig.name) changedFields['name'] = { old: orig.name, new: editForm.name }
      if (editForm.phone !== orig.phone) changedFields['phone'] = { old: orig.phone, new: editForm.phone }
      if (editForm.city !== orig.city) changedFields['city'] = { old: orig.city, new: editForm.city }
      if (editForm.address !== orig.address) changedFields['address'] = { old: orig.address, new: editForm.address }
      if (editForm.whatsapp !== orig.whatsapp) changedFields['whatsapp'] = { old: orig.whatsapp, new: editForm.whatsapp }
      if (editForm.assignedSalesmanId !== orig.assignedSalesmanId) {
        changedFields['assigned_salesman_id'] = {
          old: profileNameById.get(orig.assignedSalesmanId) ?? orig.assignedSalesmanId,
          new: profileNameById.get(editForm.assignedSalesmanId) ?? editForm.assignedSalesmanId,
        }
      }
      // Dynamic field changes
      for (const field of activeDynamicFields) {
        const oldVal = dynamicVal(orig, field.key)
        const newVal = editForm.dynamicFields[field.key] ?? ''
        if (oldVal !== newVal) changedFields[field.label] = { old: oldVal, new: newVal }
      }

      if (Object.keys(changedFields).length === 0) {
        setEditMessage('No changes detected.')
        setSaving(false)
        return
      }

      // Update customer row
      const { error: updateErr } = await supabase
        .from('customers')
        .update({
          name: editForm.name,
          phone: editForm.phone,
          city: editForm.city,
          city_id: editForm.cityId || null,
          address: editForm.address,
          whatsapp: editForm.whatsapp,
          assigned_salesman_id: editForm.assignedSalesmanId,
          dynamic_fields: editForm.dynamicFields,
        })
        .eq('id', editingCustomer.id)

      if (updateErr) {
        setEditMessage(`Error: ${updateErr.message}`)
        setSaving(false)
        return
      }

      // Write audit log
      try {
        await supabase.from('customer_edit_log').insert({
          customer_id: editingCustomer.id,
          edited_by: currentUserId,
          changed_fields: changedFields,
        })
      } catch (auditErr) {
        console.warn('Audit log write failed:', auditErr)
      }

      setEditingCustomer(null)
      onDataChanged()
    } catch (err) {
      setEditMessage(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }, [editingCustomer, editForm, activeDynamicFields, currentUserId, profileNameById, onDataChanged])

  /* ── CSV export ── */
  const handleExportCsv = useCallback(() => {
    const headers = [
      'Customer Name', 'Mobile Number', 'City', 'Address', 'Salesman',
      ...activeDynamicFields.map(f => f.label),
      'Updated Date',
    ]
    const rows = filtered.map(c => [
      c.name,
      c.phone,
      c.city,
      c.address,
      profileNameById.get(c.assignedSalesmanId) ?? 'Unassigned',
      ...activeDynamicFields.map(f => dynamicVal(c, f.key)),
      c.updatedAt ? formatDateTime(c.updatedAt) : '—',
    ])
    exportToCsv('customer_database_export', headers, rows)
  }, [filtered, activeDynamicFields, profileNameById])

  /* ── CSV Template & Import ── */
  const handleDownloadTemplate = useCallback(() => {
    const headers = [
      'Customer Name', 'Mobile Number', 'City', 'Address',
      ...activeDynamicFields.map(f => f.label)
    ]
    exportToCsv('customer_import_template', headers, [])
  }, [activeDynamicFields])

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !supabase) return
    setIsImporting(true)
    setCsvMessage('Parsing file...')

    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        const text = ev.target?.result as string
        const parsed = parseCsv(text)
        if (parsed.length === 0) throw new Error('File is empty or invalid.')

        const toUpsert = []
        const auditLogsToInsert: any[] = []
        let newCount = 0
        let updateCount = 0
        let skippedFieldCount = 0

        for (const row of parsed) {
          const phone = row['Mobile Number']?.replace(/\D/g, '').slice(0, 10)
          const name = row['Customer Name']
          const city = row['City']
          if (!phone || !name || !city) continue // Skip invalid rows

          const existing = customers.find(c => c.phone === phone)
          const dynamicFieldsData: Record<string, string> = {}
          let rowInvalid = false
          for (const f of activeDynamicFields) {
            const rawVal = row[f.label]?.trim()
            if (!rawVal) continue
            // Validate select/dropdown fields against allowed options
            if (f.type === 'select' && f.options.length > 0) {
              const match = f.options.find(opt => opt.toLowerCase() === rawVal.toLowerCase())
              if (match) {
                dynamicFieldsData[f.key] = match // Use the correctly-cased option
              } else {
                rowInvalid = true
                skippedFieldCount++
                break
              }
            } else {
              dynamicFieldsData[f.key] = rawVal
            }
          }
          if (rowInvalid) continue

          if (existing) {
            updateCount++
            const newCity = row['City'] || existing.city
            const newAddress = row['Address'] || existing.address
            const newWhatsapp = existing.whatsapp || phone
            const newDynamicFields = { ...(existing.dynamicFields || {}), ...dynamicFieldsData }

            // Track changes for audit log
            const changedFields: Record<string, { old: any, new: any }> = {}
            if (name !== existing.name) changedFields['Customer Name'] = { old: existing.name, new: name }
            if (newCity !== existing.city) changedFields['City'] = { old: existing.city, new: newCity }
            if (newAddress !== existing.address) changedFields['Address'] = { old: existing.address, new: newAddress }
            if (newWhatsapp !== existing.whatsapp) changedFields['WhatsApp'] = { old: existing.whatsapp, new: newWhatsapp }

            for (const f of activeDynamicFields) {
              const oldVal = existing.dynamicFields?.[f.key] ?? ''
              const newVal = newDynamicFields[f.key] ?? ''
              if (oldVal !== newVal) {
                changedFields[f.label] = { old: oldVal, new: newVal }
              }
            }

            if (Object.keys(changedFields).length > 0) {
              auditLogsToInsert.push({
                customer_id: existing.id,
                edited_by: currentUserId,
                changed_fields: changedFields
              })
            }

            toUpsert.push({
              id: existing.id,
              name: name,
              phone: phone,
              city: newCity,
              address: newAddress,
              whatsapp: newWhatsapp,
              assigned_salesman_id: existing.assignedSalesmanId,
              lat: existing.lat,
              lng: existing.lng,
              dynamic_fields: newDynamicFields,
              updated_at: new Date().toISOString()
            })
          } else {
            newCount++
            toUpsert.push({
              id: `c-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
              name: name,
              phone: phone,
              city: row['City'] || '',
              address: row['Address'] || '',
              whatsapp: phone,
              assigned_salesman_id: activeSalesmanId || currentUserId,
              lat: 0,
              lng: 0,
              dynamic_fields: dynamicFieldsData,
              tags: [],
            })
          }
        }

        if (toUpsert.length === 0) throw new Error('No valid rows found to import.')

        setCsvMessage(`Importing ${toUpsert.length} records...`)
        const { error } = await supabase!.from('customers').upsert(toUpsert)
        if (error) throw error

        if (auditLogsToInsert.length > 0) {
          const { error: auditErr } = await supabase!.from('customer_edit_log').insert(auditLogsToInsert)
          if (auditErr) console.warn('CSV bulk audit write failed:', auditErr)
        }

        const skippedNote = skippedFieldCount > 0 ? ` (${skippedFieldCount} row${skippedFieldCount > 1 ? 's' : ''} dropped due to invalid dropdown values)` : ''
        setCsvMessage(`Successfully imported! Added: ${newCount}, Updated: ${updateCount}.${skippedNote}`)
        setTimeout(() => {
          setCsvUploadOpen(false)
          onDataChanged()
        }, 1500)
      } catch (err) {
        setCsvMessage(`Error: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setIsImporting(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    }
    reader.readAsText(file)
  }, [customers, activeDynamicFields, activeSalesmanId, currentUserId, onDataChanged])

  /* ── Audit Log ── */
  const openAuditLog = useCallback(async (c: CustomerRecord) => {
    setAuditLogCustomer(c)
    setAuditLogs([])
    setLoadingAudit(true)
    if (!supabase) return
    const { data, error } = await supabase
      .from('customer_edit_log')
      .select('id, edited_by, edited_at, changed_fields')
      .eq('customer_id', c.id)
      .order('edited_at', { ascending: false })
    
    setLoadingAudit(false)
    if (!error && data) {
      setAuditLogs(data)
    }
  }, [])

  /* ── Bulk Assign ── */
  const toggleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const allIds = new Set(filtered.map(c => c.id))
      setSelectedCustomerIds(allIds)
    } else {
      setSelectedCustomerIds(new Set())
    }
  }

  const toggleSelectOne = (id: string) => {
    const next = new Set(selectedCustomerIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedCustomerIds(next)
  }

  const handleBulkReassign = async () => {
    if (!supabase || selectedCustomerIds.size === 0) return
    setIsBulkAssigning(true)
    setBulkAssignError('')
    try {
      const ids = Array.from(selectedCustomerIds)
      
      const { error } = await supabase
        .from('customers')
        .update({ assigned_salesman_id: bulkAssignSalesmanId || null })
        .in('id', ids)

      if (error) throw error

      // Audit logs
      const newSalesmanName = bulkAssignSalesmanId ? (profileNameById.get(bulkAssignSalesmanId) || bulkAssignSalesmanId) : 'Unassigned'
      const logs = ids.map(id => {
        const c = customers.find(x => x.id === id)
        const oldName = c ? (profileNameById.get(c.assignedSalesmanId) || 'Unassigned') : 'Unknown'
        return {
          customer_id: id,
          edited_by: currentUserId,
          changed_fields: {
            'Assigned Salesman': { old: oldName, new: newSalesmanName }
          }
        }
      })
      if (logs.length > 0) {
        const { error: auditErr } = await supabase.from('customer_edit_log').insert(logs)
        if (auditErr) console.warn('Bulk audit write failed:', auditErr)
      }

      setBulkAssignOpen(false)
      setSelectedCustomerIds(new Set())
      onDataChanged()
    } catch (err) {
      setBulkAssignError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsBulkAssigning(false)
    }
  }

  /* ── Render ── */
  const canReassign = role === 'owner' || role === 'sub_admin' || role === 'super_salesman'
  const showSalesmanFilter = role !== 'salesman'

  return (
    <section className="panel">
      <div className="cdHeader">
        <h2>Customer Database</h2>
        <div className="cdActionGroup">
          {canReassign && (
            <button 
              type="button" 
              className="secondary cdExportBtn" 
              onClick={() => setBulkAssignOpen(true)}
              disabled={selectedCustomerIds.size === 0}
              style={{ borderColor: selectedCustomerIds.size > 0 ? 'var(--accent)' : undefined, color: selectedCustomerIds.size > 0 ? 'var(--accent)' : undefined }}
            >
              Assign Salesman ({selectedCustomerIds.size})
            </button>
          )}
          <button type="button" className="secondary cdExportBtn" onClick={handleDownloadTemplate}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ marginRight: 6 }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download Template
          </button>
          <button type="button" className="secondary cdExportBtn" onClick={() => setCsvUploadOpen(true)}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ marginRight: 6 }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Upload CSV
          </button>
          <button type="button" className="secondary cdExportBtn" onClick={handleExportCsv}>
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ marginRight: 6 }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export CSV
          </button>
        </div>
      </div>

      {/* ── Filter bar ── */}
      <article className="card cdFiltersCard">
        <div className="cdFilterBar">
          <label className="cdFilterItem cdFilterSearch">
            <input
              type="text"
              placeholder="Search name, city, firm, mobile…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="cdSearchInput"
            />
          </label>

          {showSalesmanFilter && (
            <label className="cdFilterItem">
              <span className="cdFilterLabel">Salesman</span>
              <select value={salesmanFilter} onChange={e => setSalesmanFilter(e.target.value)}>
                <option value="all">All</option>
                {salesmen.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          )}

          <label className="cdFilterItem cdFilterCity">
            <span className="cdFilterLabel">City</span>
            <div style={{ marginTop: '0.25rem' }}>
              <SearchableCityDropdown
                cities={cities}
                valueId={cityFilterId}
                onChange={val => setCityFilterId(val)}
                placeholder="All Cities"
              />
            </div>
          </label>

          {stateField && (
            <label className="cdFilterItem">
              <span className="cdFilterLabel">State</span>
              <select value={stateFilterVal} onChange={e => setStateFilterVal(e.target.value)}>
                <option value="all">All States</option>
                {uniqueStates.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          )}

          {customerTypeField && (
            <label className="cdFilterItem">
              <span className="cdFilterLabel">Customer Type</span>
              <select value={customerTypeFilterVal} onChange={e => setCustomerTypeFilterVal(e.target.value)}>
                <option value="all">All</option>
                {uniqueCustomerTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          )}

        </div>
        <p className="cdFilterCount">{filtered.length} of {scopedCustomers.length} records</p>
      </article>

      {/* ── Table ── */}
      <article className="card" style={{ padding: 0 }}>
        {filtered.length === 0 ? (
          <div className="cdEmptyState">
            <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.2">
              <path d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <p>No customer records available.</p>
          </div>
        ) : (
          <div className="cdTableWrap">
            <table className="cdTable">
              <thead>
                <tr>
                  {canReassign && (
                    <th style={{ width: '40px', textAlign: 'center' }}>
                      <input 
                        type="checkbox" 
                        checked={filtered.length > 0 && selectedCustomerIds.size === filtered.length}
                        onChange={toggleSelectAll}
                      />
                    </th>
                  )}
                  <th className="cdStickyCol">Customer Name</th>
                  <th>Mobile</th>
                  <th>City</th>
                  <th>Address</th>
                  {showSalesmanFilter && <th>Salesman</th>}
                  {activeDynamicFields.map(f => <th key={f.id}>{f.label}</th>)}
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.id}>
                    {canReassign && (
                      <td style={{ textAlign: 'center' }}>
                        <input 
                          type="checkbox" 
                          checked={selectedCustomerIds.has(c.id)}
                          onChange={() => toggleSelectOne(c.id)}
                        />
                      </td>
                    )}
                    <td className="cdStickyCol cdNameCell"><strong>{c.name}</strong></td>
                    <td className="cdCompactCell">{c.phone}</td>
                    <td className="cdCompactCell">{c.city || '—'}</td>
                    <td className="cdCompactCell cdAddressCell">{c.address || '—'}</td>
                    {showSalesmanFilter && (
                      <td className="cdCompactCell">
                        <span className="cdSalesmanPill">
                          {profileNameById.get(c.assignedSalesmanId) ?? 'Unassigned'}
                        </span>
                      </td>
                    )}
                    {activeDynamicFields.map(f => (
                      <td key={f.id} className="cdCompactCell cdDynCell">
                        {dynamicVal(c, f.key) || '—'}
                      </td>
                    ))}
                    <td className="cdCompactCell cdDateCell">{c.updatedAt ? formatDateTime(c.updatedAt) : '—'}</td>
                    <td style={{ display: 'flex', gap: '0.5rem' }}>
                      <button type="button" className="cdEditBtn" onClick={() => openEdit(c)}>
                        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                          <path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        Edit
                      </button>
                      <button type="button" className="cdEditBtn" onClick={() => openAuditLog(c)}>
                        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        History
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      {/* ── Edit modal ── */}
      {editingCustomer && (
        <div className="modalOverlay" role="dialog" aria-modal="true" onClick={() => setEditingCustomer(null)}>
          <div className="modalCard cdEditModal" onClick={e => e.stopPropagation()}>
            <div className="modalHeader">
              <h2>Edit Customer</h2>
            </div>
            <div className="modalBody">
              {editMessage && (
                <p className={`cdEditMsg ${editMessage.startsWith('Error') ? 'cdEditMsgErr' : ''}`}>{editMessage}</p>
              )}
              <form ref={editFormRef} id="cdEditForm" className="cdEditFormGrid" onSubmit={handleSaveEdit}>
                {/* Fixed fields */}
                <label>
                  Customer Name *
                  <input
                    type="text" required
                    value={editForm.name}
                    onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                  />
                </label>
                <label>
                  Mobile Number *
                  <input
                    type="text" required
                    value={editForm.phone}
                    onChange={e => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 10)
                      setEditForm(p => ({ ...p, phone: val }))
                    }}
                  />
                </label>
                <label style={{ position: 'relative', zIndex: 10 }}>
                  City *
                  <div style={{ marginTop: '0.25rem' }}>
                    <SearchableCityDropdown
                      cities={cities}
                      valueId={editForm.cityId}
                      fallbackName={editForm.city}
                      onChange={(cityId) => {
                        const selected = cities.find(c => c.id === cityId)
                        setEditForm(p => ({ ...p, cityId, city: selected ? selected.name : '' }))
                      }}
                    />
                  </div>
                </label>
                <label>
                  Address
                  <input
                    type="text"
                    value={editForm.address}
                    onChange={e => setEditForm(p => ({ ...p, address: e.target.value }))}
                  />
                </label>
                <label>
                  WhatsApp
                  <input
                    type="text"
                    value={editForm.whatsapp}
                    onChange={e => setEditForm(p => ({ ...p, whatsapp: e.target.value }))}
                  />
                </label>

                {/* Salesman reassignment (admin only) */}
                {canReassign && (
                  <label>
                    Assigned Salesman
                    <select
                      value={editForm.assignedSalesmanId}
                      onChange={e => setEditForm(p => ({ ...p, assignedSalesmanId: e.target.value }))}
                    >
                      <option value="">— Select —</option>
                      {salesmen.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </label>
                )}

                {/* Dynamic fields */}
                {activeDynamicFields.map(field => {
                  const val = editForm.dynamicFields[field.key] ?? ''
                  const update = (v: string) =>
                    setEditForm(p => ({ ...p, dynamicFields: { ...p.dynamicFields, [field.key]: v } }))

                  if (field.type === 'select' && field.options.length > 0) {
                    return (
                      <label key={field.id}>
                        {field.label}
                        <select value={val} onChange={e => update(e.target.value)}>
                          <option value="">— Select —</option>
                          {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      </label>
                    )
                  }
                  if (field.type === 'textarea') {
                    return (
                      <label key={field.id}>
                        {field.label}
                        <textarea rows={2} value={val} onChange={e => update(e.target.value)} />
                      </label>
                    )
                  }
                  return (
                    <label key={field.id}>
                      {field.label}
                      <input
                        type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                        value={val}
                        onChange={e => update(e.target.value)}
                      />
                    </label>
                  )
                })}
              </form>
            </div>
            <div className="modalFooter">
              <button type="button" className="secondary" onClick={() => setEditingCustomer(null)}>Cancel</button>
              <button type="submit" form="cdEditForm" className="primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── CSV Upload modal ── */}
      {csvUploadOpen && (
        <div className="modalOverlay" role="dialog" aria-modal="true" onClick={() => !isImporting && setCsvUploadOpen(false)}>
          <div className="modalCard" onClick={e => e.stopPropagation()}>
            <div className="modalHeader">
              <h2>Upload CSV</h2>
            </div>
            <div className="modalBody">
              <div className="cdCsvUploadSection">
                <p>Upload a CSV file to bulk add or update customers. The CSV should match the template structure.</p>
                
                <input 
                  type="file" 
                  accept=".csv" 
                  ref={fileInputRef} 
                  onChange={handleFileUpload} 
                  style={{ display: 'none' }} 
                  id="csv-file-upload" 
                />
                
                <label htmlFor="csv-file-upload" className="cdCsvFileDrop">
                  <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ marginBottom: '0.5rem', opacity: 0.6 }}>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <div><strong>Click to select a CSV file</strong></div>
                </label>

                {csvMessage && (
                  <div className={`cdEditMsg ${csvMessage.startsWith('Error') ? 'cdEditMsgErr' : ''}`}>
                    {csvMessage}
                  </div>
                )}
              </div>
            </div>
            <div className="modalFooter">
              <button type="button" className="secondary" onClick={() => setCsvUploadOpen(false)} disabled={isImporting}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Audit Log modal ── */}
      {auditLogCustomer && (
        <div className="modalOverlay" role="dialog" aria-modal="true" onClick={() => setAuditLogCustomer(null)}>
          <div className="modalCard cdEditModal" onClick={e => e.stopPropagation()}>
            <div className="modalHeader">
              <h2>Edit History: {auditLogCustomer.name}</h2>
            </div>
            <div className="modalBody">
              {loadingAudit ? (
                <p>Loading history...</p>
              ) : auditLogs.length === 0 ? (
                <div className="cdEmptyState">
                  <p>No edit history found for this customer.</p>
                </div>
              ) : (
                <div className="cdAuditLogList">
                  {auditLogs.map(log => (
                    <div key={log.id} className="cdAuditItem">
                      <div className="cdAuditHeader">
                        <strong>{profileNameById.get(log.edited_by) || log.edited_by}</strong>
                        <span>{formatDateTime(log.edited_at)}</span>
                      </div>
                      <div className="cdAuditChanges">
                        {Object.entries(log.changed_fields).map(([field, vals]: [string, any]) => (
                          <div key={field} className="cdAuditChangeRow">
                            <span className="cdAuditField">{field}:</span>
                            <span className="cdAuditOld">{vals.old || '(empty)'}</span>
                            <span style={{ color: 'var(--text-secondary)' }}>→</span>
                            <span className="cdAuditNew">{vals.new || '(empty)'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modalFooter">
              <button type="button" className="secondary" onClick={() => setAuditLogCustomer(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk Assign Modal ── */}
      {bulkAssignOpen && (
        <div className="modalOverlay" role="dialog" aria-modal="true" onClick={() => !isBulkAssigning && setBulkAssignOpen(false)}>
          <div className="modalCard" onClick={e => e.stopPropagation()}>
            <div className="modalHeader">
              <h2>Assign Salesman</h2>
            </div>
            <div className="modalBody">
              <p style={{ marginBottom: '1rem' }}>
                Are you sure you want to transfer the selected <strong>{selectedCustomerIds.size}</strong> customer(s) to a new salesman?
              </p>
              
              {bulkAssignError && (
                <div className="cdEditMsg cdEditMsgErr" style={{ marginBottom: '1rem' }}>
                  {bulkAssignError}
                </div>
              )}

              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.85rem' }}>
                <strong>Select New Salesman:</strong>
                <select 
                  style={{ padding: '0.4rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', fontSize: '0.85rem' }}
                  value={bulkAssignSalesmanId} 
                  onChange={e => setBulkAssignSalesmanId(e.target.value)}
                >
                  <option value="">— Unassigned —</option>
                  {salesmen.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            </div>
            <div className="modalFooter">
              <button type="button" className="secondary" onClick={() => setBulkAssignOpen(false)} disabled={isBulkAssigning}>Cancel</button>
              <button type="button" className="primary" onClick={handleBulkReassign} disabled={isBulkAssigning}>
                {isBulkAssigning ? 'Reassigning...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
