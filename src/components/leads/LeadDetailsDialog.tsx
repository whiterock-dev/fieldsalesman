import React, { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { LeadWithDetails, LeadStatus } from './types'
import { updateLeadStatus, updateAdminReviewRemarks } from './leadsApi'
import type { Role } from '../../lib/roles'

interface LeadDetailsDialogProps {
  lead: LeadWithDetails
  onClose: () => void
  onUpdate: () => void
  currentUserId: string
  role: Role
}

export function LeadDetailsDialog({ lead, onClose, onUpdate, currentUserId, role }: LeadDetailsDialogProps) {
  const [activeTab, setActiveTab] = useState<'history' | 'add-followup' | 'mark-won' | 'mark-lost'>('history')
  const [followups, setFollowups] = useState<any[]>([])
  const [loadingFups, setLoadingFups] = useState(true)

  // Status Form State
  const [status, setStatus] = useState<LeadStatus>('open')
  const [orderValue, setOrderValue] = useState(lead.order_value || '')
  const [closingRemarks, setClosingRemarks] = useState(lead.closing_remarks || '')
  const [lostReason, setLostReason] = useState(lead.lost_reason || '')
  const [lostRemarks, setLostRemarks] = useState(lead.lost_remarks || '')
  const [adminRemarks, setAdminRemarks] = useState(lead.admin_review_remarks || '')
  
  const [updating, setUpdating] = useState(false)

  // New Follow-up State
  const [fupRemarks, setFupRemarks] = useState('')
  const [fupDate, setFupDate] = useState('')
  const [fupAdding, setFupAdding] = useState(false)

  const isAdmin = ['owner', 'sub_admin', 'super_salesman'].includes(role)

  useEffect(() => {
    async function loadFups() {
      const { data } = await supabase!
        .from('followups')
        .select('*')
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false })
      setFollowups(data || [])
      setLoadingFups(false)
    }
    loadFups()
  }, [lead.id])

  const handleStatusUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    setUpdating(true)
    try {
      const updates: any = {}
      if (status === 'won') {
        updates.order_value = Number(orderValue)
        updates.closing_remarks = closingRemarks
      } else if (status === 'lost') {
        updates.lost_reason = lostReason
        updates.lost_remarks = lostRemarks
      }
      
      await updateLeadStatus(lead.id, status, updates)
      
      if (isAdmin && adminRemarks !== lead.admin_review_remarks) {
        await updateAdminReviewRemarks(lead.id, adminRemarks)
      }
      
      onUpdate()
      onClose()
    } catch (err) {
      console.error(err)
      alert('Failed to update lead status')
    } finally {
      setUpdating(false)
    }
  }

  const handleAddFollowup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!fupRemarks || !fupDate) return
    setFupAdding(true)
    try {
      const { data, error } = await supabase!.from('followups').insert({
        id: crypto.randomUUID(), // Assuming followups.id is text based on schema
        lead_id: lead.id,
        customer_id: lead.customer_id,
        salesman_id: currentUserId,
        remarks: fupRemarks,
        due_date: fupDate,
        priority: 'medium',
        status: 'pending'
      }).select().single()

      if (error) throw error

      setFollowups([data, ...followups])
      setFupRemarks('')
      setFupDate('')
      onUpdate()
    } catch (err) {
      console.error(err)
      alert('Failed to add follow-up')
    } finally {
      setFupAdding(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: '16px',
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          width: '96%',
          maxWidth: '650px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.04)',
          fontFamily: "'Inter', 'Segoe UI', sans-serif",
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '24px 24px 16px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>Lead: {lead.customer_name}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <span style={{ 
                padding: '4px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: 700,
                backgroundColor: lead.status === 'won' ? '#dcfce7' : lead.status === 'lost' ? '#fee2e2' : '#e0f2fe',
                color: lead.status === 'won' ? '#166534' : lead.status === 'lost' ? '#991b1b' : '#0369a1',
              }}>
                {lead.status.charAt(0).toUpperCase() + lead.status.slice(1)}
              </span>
              <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', color: '#64748b' }}>✕</button>
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: '20px', fontSize: '13px', color: '#64748b', marginBottom: '16px' }}>
            {lead.customer_firm && <div>Firm: <span style={{ fontWeight: 600, color: '#0f172a' }}>{lead.customer_firm}</span></div>}
            <div>Assigned SC: <span style={{ fontWeight: 600, color: '#0f172a' }}>{lead.salesman_name}</span></div>
            <div>Created: <span style={{ fontWeight: 600, color: '#0f172a' }}>{new Date(lead.created_at).toLocaleDateString('en-GB').replace(/\//g, '-')}</span></div>
          </div>

          <div style={{ backgroundColor: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', marginBottom: '6px' }}>Requirement:</div>
            <div style={{ fontSize: '14px', color: '#475569', lineHeight: '1.5' }}>{lead.requirement_description}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '24px', padding: '0 24px', borderBottom: '1px solid #e2e8f0', backgroundColor: '#fff' }}>
          {['history', 'add-followup', 'mark-won', 'mark-lost'].map(tab => {
            const labels: any = { 'history': 'History & Reviews', 'add-followup': 'Add Follow-up', 'mark-won': 'Mark Won', 'mark-lost': 'Mark Lost' }
            const isActive = activeTab === tab
            return (
              <button
                key={tab}
                onClick={() => {
                  setActiveTab(tab as any)
                  if (tab === 'mark-won') setStatus('won')
                  if (tab === 'mark-lost') setStatus('lost')
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '12px 0',
                  borderBottom: isActive ? '2px solid #0f172a' : '2px solid transparent',
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? '#0f172a' : '#64748b',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                {labels[tab]}
              </button>
            )
          })}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          {activeTab === 'history' && (
            <div>
              <h4 style={{ margin: '0 0 16px 0', fontSize: '16px', color: '#0f172a' }}>Follow-up History</h4>
              
              {loadingFups ? <p style={{ fontSize: '13px', color: '#64748b' }}>Loading...</p> : followups.length === 0 ? <p style={{ fontSize: '13px', color: '#64748b' }}>No follow-ups recorded yet.</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {followups.map(f => (
                    <div key={f.id} style={{ display: 'flex', gap: '16px' }}>
                      <div style={{ width: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#0f172a', marginTop: '4px' }}></div>
                        <div style={{ flex: 1, width: '2px', backgroundColor: '#e2e8f0', margin: '4px 0' }}></div>
                      </div>
                      <div style={{ flex: 1, padding: '16px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 1px 2px 0 rgba(0,0,0,0.03)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <span style={{ fontWeight: 600, color: '#0f172a', fontSize: '13px' }}>{lead.salesman_name}</span>
                          <span style={{ fontSize: '12px', color: '#94a3b8' }}>{new Date(f.created_at).toLocaleString('en-GB')}</span>
                        </div>
                        <div style={{ fontSize: '14px', color: '#475569', marginBottom: '12px' }}>{f.remarks}</div>
                        <div style={{ display: 'inline-flex', alignItems: 'center', backgroundColor: '#f8fafc', padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, color: '#475569' }}>
                          Next Follow-up: {new Date(f.due_date).toLocaleDateString('en-GB').replace(/\//g, '-')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'add-followup' && (
            <form onSubmit={handleAddFollowup} style={{ padding: '16px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <h4 style={{ margin: '0 0 16px 0', fontSize: '16px', color: '#0f172a' }}>Add Follow-up</h4>
              
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>Remarks *</label>
                <textarea 
                  required rows={3} value={fupRemarks} onChange={e => setFupRemarks(e.target.value)} 
                  placeholder="Notes from the follow-up..." 
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box', outline: 'none', resize: 'vertical' }}
                />
              </div>
              
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600 }}>Next Follow-up Date *</label>
                <input 
                  type="date" 
                  required 
                  value={fupDate} 
                  onChange={e => setFupDate(e.target.value)}
                  min={new Date().toISOString().substring(0, 10)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box', outline: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button type="submit" disabled={fupAdding} style={{ flex: 1, padding: '12px', backgroundColor: '#0f172a', color: '#fff', borderRadius: '8px', border: 'none', fontWeight: 600, fontSize: '14px', cursor: fupAdding ? 'not-allowed' : 'pointer' }}>
                  {fupAdding ? 'Saving...' : 'Save Follow-up'}
                </button>
              </div>
            </form>
          )}

          {(activeTab === 'mark-won' || activeTab === 'mark-lost') && (
            <form onSubmit={handleStatusUpdate} style={{ padding: '16px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <h4 style={{ margin: '0 0 16px 0', fontSize: '16px', color: '#0f172a' }}>
                {activeTab === 'mark-won' ? 'Mark Lead as Won' : 'Mark Lead as Lost'}
              </h4>

              {status === 'won' && (
                <div style={{ padding: '16px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', marginBottom: '16px' }}>
                  <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600 }}>Order Value (₹)</label>
                  <input type="number" required value={orderValue} onChange={e => setOrderValue(e.target.value)} style={{ width: '100%', padding: '10px', marginBottom: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
                  <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600 }}>Closing Remarks</label>
                  <textarea rows={2} value={closingRemarks} onChange={e => setClosingRemarks(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box', outline: 'none', resize: 'vertical' }} />
                </div>
              )}

              {status === 'lost' && (
                <div style={{ padding: '16px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', marginBottom: '16px' }}>
                  <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600 }}>Lost Reason</label>
                  <select required value={lostReason} onChange={e => setLostReason(e.target.value)} style={{ width: '100%', padding: '10px', marginBottom: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box', outline: 'none' }}>
                    <option value="">Select Reason...</option>
                    <option value="Price Issue">Price Issue</option>
                    <option value="Competitor Won">Competitor Won</option>
                    <option value="No Requirement">No Requirement</option>
                    <option value="No Response">No Response</option>
                    <option value="Payment Issue">Payment Issue</option>
                    <option value="Product Issue">Product Issue</option>
                    <option value="Other">Other</option>
                  </select>
                  <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600 }}>Lost Remarks</label>
                  <textarea rows={2} value={lostRemarks} onChange={e => setLostRemarks(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box', outline: 'none', resize: 'vertical' }} />
                </div>
              )}

              {isAdmin && status === 'lost' && (
                <div style={{ padding: '16px', backgroundColor: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '8px', marginBottom: '16px' }}>
                  <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600 }}>Admin Review Remarks</label>
                  <textarea rows={2} value={adminRemarks} onChange={e => setAdminRemarks(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box', outline: 'none', resize: 'vertical' }} placeholder="Add review notes here..." />
                </div>
              )}

              <div style={{ display: 'flex', gap: '12px' }}>
                <button type="submit" disabled={updating} style={{ flex: 1, padding: '12px', backgroundColor: '#0f172a', color: '#fff', borderRadius: '8px', border: 'none', fontWeight: 600, fontSize: '14px', cursor: updating ? 'not-allowed' : 'pointer' }}>
                  {updating ? 'Saving...' : 'Save Status'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
