import React, { useState } from 'react'
import { createLead, checkOpenLead } from './leadsApi'
import { supabase } from '../../lib/supabase'

interface AddLeadDialogProps {
  onClose: () => void
  onAdded: () => void
  customers: Array<{ id: string; name: string; phone: string }>
  salesmen: Array<{ id: string; name: string }>
  currentUserId: string
  role: string
}

export function AddLeadDialog({ onClose, onAdded, customers, salesmen, currentUserId, role }: AddLeadDialogProps) {
  const [customerId, setCustomerId] = useState('')
  const [salesmanId, setSalesmanId] = useState(currentUserId)
  const [requirement, setRequirement] = useState('')
  const [fupDate, setFupDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)

  const filteredCustomers = search.trim()
    ? customers.filter(c => 
        c.name.toLowerCase().includes(search.toLowerCase()) || 
        c.phone.includes(search)
      ).slice(0, 50)
    : customers.slice(0, 50)

  const handleCustomerSelect = (id: string, label: string) => {
    setCustomerId(id)
    setSearch(label)
    setShowDropdown(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!customerId || !requirement) return

    setLoading(true)
    setError('')
    try {
      // Duplicate check
      const existing = await checkOpenLead(customerId)
      if (existing) {
        const confirm = window.confirm(`This customer already has an open lead (Lead ID: ${existing.id.slice(0, 8)}). Do you want to continue creating a new lead?`)
        if (!confirm) {
          setLoading(false)
          return
        }
      }

      const leadReq = await createLead({
        customer_id: customerId,
        salesman_id: salesmanId,
        requirement_description: requirement,
        status: 'open'
      })

      if (fupDate && leadReq) {
        await supabase!.from('followups').insert({
          id: crypto.randomUUID(),
          lead_id: leadReq.id,
          customer_id: customerId,
          salesman_id: salesmanId,
          remarks: 'Initial follow-up',
          due_date: fupDate,
          priority: 'medium',
          status: 'pending'
        })
      }
      onAdded()
      onClose()
    } catch (err) {
      setError(String(err))
      setLoading(false)
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
          maxWidth: '500px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.04)',
          fontFamily: "'Inter', 'Segoe UI', sans-serif",
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid #e2e8f0' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>Create New Lead</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#64748b' }}>✕</button>
        </div>
        
        <form onSubmit={handleSubmit} style={{ padding: '24px' }}>
          {error && <div style={{ color: '#991b1b', backgroundColor: '#fef2f2', padding: '10px 14px', borderRadius: '8px', marginBottom: '20px', fontSize: '13px', fontWeight: 500, border: '1px solid #fecaca' }}>{error}</div>}

          <div style={{ marginBottom: '20px', position: 'relative' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>Customer *</label>
            <div style={{ position: 'relative' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }}><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input 
                type="text" 
                placeholder="Search by name, firm, or phone number..." 
                value={search}
                onChange={(e) => { setSearch(e.target.value); setCustomerId(''); setShowDropdown(true); }}
                onFocus={() => setShowDropdown(true)}
                style={{ width: '100%', height: '42px', padding: '0 12px 0 36px', border: customerId ? '1px solid #10b981' : '1px solid #cbd5e1', backgroundColor: customerId ? '#f0fdf4' : '#fff', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', outline: 'none' }}
              />
            </div>
            
            {showDropdown && !customerId && (
              <div style={{ position: 'absolute', top: '70px', left: 0, right: 0, backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', maxHeight: '200px', overflowY: 'auto', zIndex: 10 }}>
                {filteredCustomers.length === 0 ? (
                  <div style={{ padding: '12px', fontSize: '13px', color: '#64748b' }}>No customers found</div>
                ) : (
                  filteredCustomers.map(c => (
                    <div 
                      key={c.id} 
                      onClick={() => handleCustomerSelect(c.id, `${c.name} - ${c.phone}`)}
                      style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', fontSize: '13px' }}
                    >
                      <span style={{ fontWeight: 600, color: '#0f172a' }}>{c.name}</span>
                      <span style={{ color: '#64748b', marginLeft: '8px' }}>{c.phone}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>Assign to Salesperson *</label>
            <div style={{ position: 'relative' }}>
              <select 
                required
                value={salesmanId}
                onChange={(e) => setSalesmanId(e.target.value)}
                disabled={role === 'salesman'} // Salesmen can only assign to themselves
                style={{ width: '100%', height: '42px', padding: '0 12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', outline: 'none', backgroundColor: role === 'salesman' ? '#f8fafc' : '#fff', color: '#0f172a', appearance: 'none', cursor: role === 'salesman' ? 'not-allowed' : 'pointer' }}
              >
                <option value="">Select Salesperson...</option>
                {salesmen.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>Requirement Description *</label>
            <textarea 
              required
              rows={4}
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
              placeholder="What is the lead looking for?"
              style={{ width: '100%', padding: '12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', outline: 'none', resize: 'vertical' }}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>Initial Follow-up Date (Optional)</label>
            <div style={{ position: 'relative' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
              <input 
                type="date"
                value={fupDate}
                onChange={(e) => setFupDate(e.target.value)}
                min={new Date().toISOString().substring(0, 10)}
                style={{ width: '100%', height: '42px', padding: '0 12px 0 36px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', outline: 'none', color: '#475569' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', paddingTop: '16px', borderTop: '1px solid #e2e8f0' }}>
            <button type="button" onClick={onClose} disabled={loading} style={{ height: '40px', padding: '0 20px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#fff', color: '#0f172a', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}>Cancel</button>
            <button type="submit" disabled={loading || !customerId || !requirement} style={{ height: '40px', padding: '0 24px', borderRadius: '8px', border: 'none', backgroundColor: '#8b929a', color: '#fff', fontWeight: 600, fontSize: '14px', cursor: (!customerId || !requirement) ? 'not-allowed' : 'pointer' }}>
              {loading ? 'Creating...' : 'Create Lead'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
