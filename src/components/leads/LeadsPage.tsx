import React, { useState, useEffect, useCallback, useMemo } from 'react'
import type { Role } from '../../lib/roles'
import type { LeadRecord, LeadWithDetails } from './types'
import { fetchLeads } from './leadsApi'
import { LeadsFilterBar, type LeadsFilters } from './LeadsFilterBar'
import { AddLeadDialog } from './AddLeadDialog'
import { LeadDetailsDialog } from './LeadDetailsDialog'
import { exportToCsv } from '../../lib/exportUtils'

export interface LeadsPageProps {
  customers: Array<{ id: string; name: string; phone: string; city?: string }>
  salesmen: Array<{ id: string; name: string }>
  cities: Array<{ id: string; name: string }>
  role: Role
  currentUserId: string
  activeSalesmanId?: string
  initialSearch?: string
  onDataChanged: () => void
}

export const LeadsPage = React.memo(function LeadsPage({
  customers,
  salesmen,
  cities,
  role,
  currentUserId,
  initialSearch,
  onDataChanged
}: LeadsPageProps) {
  const [rawLeads, setRawLeads] = useState<LeadRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState<LeadsFilters>({
    salesmanId: undefined,
    search: initialSearch
  })

  // If initialSearch changes from outside, update the filter
  useEffect(() => {
    if (initialSearch !== undefined) {
      setFilters(prev => ({ ...prev, search: initialSearch }))
    }
  }, [initialSearch])
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [selectedLead, setSelectedLead] = useState<LeadWithDetails | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchLeads()
      setRawLeads(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const enrichedLeads = useMemo(() => {
    const custMap = new Map(customers.map(c => [c.id, c]))
    const smMap = new Map(salesmen.map(s => [s.id, s.name]))

    const todayStr = new Date().toISOString().slice(0, 10)

    return rawLeads.map(l => {
      const c = custMap.get(l.customer_id)
      
      let isOverdue = false
      let isDueToday = false
      let nextDue = ''
      
      // Parse followups if they exist from the API join
      const fups = (l as any).followups || []
      if (fups.length > 0) {
        const sorted = fups.map((f: any) => f.due_date).sort().reverse()
        nextDue = sorted[0]
        if (nextDue < todayStr) isOverdue = true
        else if (nextDue === todayStr) isDueToday = true
      }

      return {
        ...l,
        customer_name: c?.name || 'Unknown',
        customer_firm: (c as any)?.firm || '',
        customer_city: c?.city || '',
        customer_phone: c?.phone || '',
        salesman_name: smMap.get(l.salesman_id) || 'Unknown',
        next_followup_date: nextDue,
        overdue: isOverdue,
        due_today: isDueToday
      } as LeadWithDetails
    })
  }, [rawLeads, customers, salesmen])

  const filteredLeads = useMemo(() => {
    let list = enrichedLeads.filter(l => {
      // Constraint: Salesman can only see leads for their assigned customers
      if (role === 'salesman') {
        const c = customers.find(cust => cust.id === l.customer_id)
        if (!c || (c as any).assignedSalesmanId !== currentUserId) return false
      }

      if (filters.status && l.status !== filters.status) return false
      if (filters.salesmanId && l.salesman_id !== filters.salesmanId) return false
      if (filters.cityId && l.customer_city !== cities.find(c => c.id === filters.cityId)?.name) return false
      if (filters.search) {
        const q = filters.search.toLowerCase()
        if (!l.customer_name.toLowerCase().includes(q) && !l.customer_phone.includes(q)) return false
      }
      if (filters.followupRange === 'today' && !l.due_today) return false
      if (filters.followupRange === 'overdue' && !l.overdue) return false
      if (filters.followupRange === 'upcoming' && (l.overdue || l.due_today || !l.next_followup_date)) return false

      // Created Date Filter
      const createdStr = l.created_at.substring(0, 10);
      if (filters.createdDateRange === '7days') {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        if (createdStr < d.toISOString().substring(0, 10)) return false;
      } else if (filters.createdDateRange === '30days') {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        if (createdStr < d.toISOString().substring(0, 10)) return false;
      } else if (filters.createdDateRange === 'custom') {
        if (filters.createdDateFrom && createdStr < filters.createdDateFrom) return false;
        if (filters.createdDateTo && createdStr > filters.createdDateTo) return false;
      }

      // Next Followup Date Filter
      if (filters.nextFollowupDateRange === '7days') {
        if (!l.next_followup_date) return false;
        const d = new Date();
        d.setDate(d.getDate() - 7);
        if (l.next_followup_date < d.toISOString().substring(0, 10)) return false;
      } else if (filters.nextFollowupDateRange === '30days') {
        if (!l.next_followup_date) return false;
        const d = new Date();
        d.setDate(d.getDate() - 30);
        if (l.next_followup_date < d.toISOString().substring(0, 10)) return false;
      } else if (filters.nextFollowupDateRange === 'custom') {
        if (!l.next_followup_date && (filters.nextFollowupDateFrom || filters.nextFollowupDateTo)) return false;
        if (l.next_followup_date && filters.nextFollowupDateFrom && l.next_followup_date < filters.nextFollowupDateFrom) return false;
        if (l.next_followup_date && filters.nextFollowupDateTo && l.next_followup_date > filters.nextFollowupDateTo) return false;
      }

      return true
    })

    // Sort: Overdue first, then Due Today, then Upcoming
    list.sort((a, b) => {
      if (a.overdue && !b.overdue) return -1
      if (!a.overdue && b.overdue) return 1
      if (a.due_today && !b.due_today) return -1
      if (!a.due_today && b.due_today) return 1
      return (b.next_followup_date || '').localeCompare(a.next_followup_date || '')
    })

    return list
  }, [enrichedLeads, filters])

  const handleExportCsv = () => {
    const headers = [
      'Lead ID', 'Created At', 'Customer', 'Phone', 'City', 
      'Requirement', 'Status', 'Salesman', 'Order Value', 'Lost Reason', 'Lost Remarks'
    ]
    const rows = filteredLeads.map(l => [
      l.id,
      new Date(l.created_at).toLocaleDateString('en-GB'),
      l.customer_name,
      l.customer_phone,
      l.customer_city,
      l.requirement_description,
      l.status.toUpperCase(),
      l.salesman_name,
      l.order_value ? String(l.order_value) : '',
      l.lost_reason || '',
      l.lost_remarks || ''
    ])
    exportToCsv(`leads_export_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows)
  }

  const exportButton = (
    <button onClick={handleExportCsv} style={{ height: '36px', padding: '0 16px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#fff', fontSize: '13px', fontWeight: 600, color: '#0f172a', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
      Export CSV
    </button>
  )

  return (
    <section className="panel" style={{ padding: '24px 32px', backgroundColor: '#f8fafc', minHeight: '100%' }}>
      <LeadsFilterBar 
        filters={filters} 
        onChange={setFilters} 
        salesmen={salesmen} 
        cities={cities}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="4"></circle></svg>
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: 700, margin: 0, color: '#0f172a' }}>Leads</h1>
          <span style={{ backgroundColor: '#f1f5f9', color: '#475569', fontSize: '13px', fontWeight: 600, padding: '2px 10px', borderRadius: '12px' }}>
            {filteredLeads.length}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          {exportButton}
          <button onClick={() => setIsAddOpen(true)} style={{ height: '36px', padding: '0 16px', borderRadius: '6px', border: 'none', backgroundColor: '#0f172a', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '16px', lineHeight: 1 }}>+</span> New Lead
          </button>
        </div>
      </div>

      <div style={{ backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <table className="dataTable" style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
              <th style={{ padding: '16px 20px', color: '#64748b', fontWeight: 600 }}>Customer</th>
              <th style={{ padding: '16px 20px', color: '#64748b', fontWeight: 600 }}>Status</th>
              <th style={{ padding: '16px 20px', color: '#64748b', fontWeight: 600 }}>Requirement</th>
              <th style={{ padding: '16px 20px', color: '#64748b', fontWeight: 600 }}>Created Date</th>
              <th style={{ padding: '16px 20px', color: '#64748b', fontWeight: 600 }}>Next Follow-up</th>
              <th style={{ padding: '16px 20px', color: '#64748b', fontWeight: 600 }}>Assigned Salesman</th>
              <th style={{ padding: '16px 20px', color: '#64748b', fontWeight: 600, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ padding: '20px', textAlign: 'center' }}>Loading leads...</td></tr>
            ) : filteredLeads.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: '20px', textAlign: 'center' }}>No leads found.</td></tr>
            ) : (
              filteredLeads.map(l => (
                <tr 
                  key={l.id} 
                  style={{ 
                    borderBottom: '1px solid #f1f5f9', 
                    backgroundColor: l.overdue ? '#fff5f5' : 'transparent',
                    transition: 'background-color 0.2s'
                  }}
                >
                  <td style={{ padding: '16px 20px' }}>
                    <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '14px' }}>{l.customer_name}</div>
                    {l.customer_city && <div style={{ fontSize: '12px', color: '#64748b' }}>{l.customer_city}</div>}
                    <div style={{ fontSize: '12px', color: '#64748b' }}>{l.customer_phone}</div>
                  </td>
                  <td style={{ padding: '16px 20px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start' }}>
                      <span style={{ 
                        padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 700,
                        backgroundColor: l.status === 'won' ? '#dcfce7' : l.status === 'lost' ? '#fee2e2' : '#e0f2fe',
                        color: l.status === 'won' ? '#166534' : l.status === 'lost' ? '#991b1b' : '#0369a1',
                        letterSpacing: '0.02em'
                      }}>
                        {l.status === 'open' ? 'Open' : l.status === 'won' ? 'Won' : 'Lost'}
                      </span>
                      {l.status === 'open' && l.overdue && (
                        <span style={{ 
                          padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 700,
                          backgroundColor: '#ef4444', color: '#ffffff', letterSpacing: '0.02em'
                        }}>
                          Overdue
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '16px 20px', maxWidth: '200px', color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {l.requirement_description}
                  </td>
                  <td style={{ padding: '16px 20px', color: '#64748b' }}>
                    {new Date(l.created_at).toLocaleDateString('en-GB').replace(/\//g, '-')}
                  </td>
                  <td style={{ padding: '16px 20px', color: '#64748b' }}>
                    {l.next_followup_date ? new Date(l.next_followup_date).toLocaleDateString('en-GB').replace(/\//g, '-') : '—'}
                  </td>
                  <td style={{ padding: '16px 20px', color: '#475569' }}>
                    {l.salesman_name}
                  </td>
                  <td style={{ padding: '16px 20px', textAlign: 'right' }}>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setSelectedLead(l); }}
                      style={{ 
                        padding: '6px 12px', borderRadius: '6px', border: '1px solid #e2e8f0', 
                        backgroundColor: '#fff', color: '#0f172a', fontSize: '12px', fontWeight: 600, 
                        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px',
                        boxShadow: '0 1px 2px 0 rgba(0,0,0,0.03)'
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                      History
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isAddOpen && (
        <AddLeadDialog 
          onClose={() => setIsAddOpen(false)} 
          onAdded={() => { loadData(); onDataChanged(); }} 
          customers={role === 'salesman' ? customers.filter(c => (c as any).assignedSalesmanId === currentUserId) : customers}
          salesmen={salesmen}
          currentUserId={currentUserId} 
          role={role}
        />
      )}

      {selectedLead && (
        <LeadDetailsDialog
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onUpdate={() => { loadData(); onDataChanged(); }}
          currentUserId={currentUserId}
          role={role}
        />
      )}
    </section>
  )
})
