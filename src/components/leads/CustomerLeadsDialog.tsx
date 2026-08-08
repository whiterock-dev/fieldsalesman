import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { Role } from '../../lib/roles'
import type { LeadWithDetails } from './types'
import { LeadDetailsDialog } from './LeadDetailsDialog'

interface CustomerLeadsDialogProps {
  customerId: string
  customerName: string
  onClose: () => void
  currentUserId: string
  role: Role
  profileNameById: Map<string, string>
}

export function CustomerLeadsDialog({ customerId, customerName, onClose, currentUserId, role, profileNameById }: CustomerLeadsDialogProps) {
  const [leads, setLeads] = useState<LeadWithDetails[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedLead, setSelectedLead] = useState<LeadWithDetails | null>(null)

  const loadLeads = async () => {
    setLoading(true)
    const { data, error } = await supabase!
      .from('leads')
      .select('*, followups(due_date)')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      
    if (!error && data) {
      const enrichedLeads = (data as any[]).map(l => ({
        ...l,
        customer_name: customerName,
        customer_phone: '',
        customer_city: '',
        customer_tags: []
      }))
      setLeads(enrichedLeads)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadLeads()
  }, [customerId])

  if (selectedLead) {
    return (
      <LeadDetailsDialog 
        lead={selectedLead}
        onClose={() => setSelectedLead(null)}
        onUpdate={() => {
          loadLeads()
          setSelectedLead(null)
        }}
        currentUserId={currentUserId}
        role={role}
      />
    )
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
          maxWidth: '800px',
          maxHeight: '85vh',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.04)',
          fontFamily: "'Inter', 'Segoe UI', sans-serif",
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid #e2e8f0' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
            Lead History: {customerName}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#64748b' }}>✕</button>
        </div>
        
        <div style={{ padding: '20px', overflowY: 'auto' }}>
          {loading ? (
            <p style={{ textAlign: 'center', color: '#64748b', margin: '40px 0' }}>Loading leads...</p>
          ) : leads.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#64748b' }}>
              <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ margin: '0 auto 12px auto', opacity: 0.5 }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
              <p>No leads found for this customer.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {leads.map(lead => {
                const isWon = lead.status === 'won';
                const isLost = lead.status === 'lost';
                const badgeBg = isWon ? '#dcfce7' : isLost ? '#fee2e2' : '#f1f5f9';
                const badgeColor = isWon ? '#16a34a' : isLost ? '#dc2626' : '#475569';
                
                return (
                  <div 
                    key={lead.id} 
                    style={{ 
                      padding: '16px', 
                      border: '1px solid #e2e8f0', 
                      borderRadius: '8px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px',
                      backgroundColor: '#fff',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.02)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
                          <span style={{ fontSize: '13px', color: '#64748b', fontFamily: 'monospace' }}>
                            #{lead.id.slice(0, 8)}
                          </span>
                          <span style={{ 
                            padding: '2px 8px', 
                            borderRadius: '12px', 
                            fontSize: '11px', 
                            fontWeight: 600, 
                            textTransform: 'uppercase',
                            backgroundColor: badgeBg,
                            color: badgeColor
                          }}>
                            {lead.status}
                          </span>
                          <span style={{ fontSize: '13px', color: '#64748b' }}>
                            Created: {new Date(lead.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <p style={{ margin: '8px 0', fontSize: '14px', color: '#0f172a', fontWeight: 500, lineHeight: 1.5 }}>
                          {lead.requirement_description}
                        </p>
                      </div>
                      <button 
                        onClick={() => setSelectedLead(lead)}
                        style={{
                          backgroundColor: '#f8fafc',
                          border: '1px solid #cbd5e1',
                          color: '#0f172a',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          marginLeft: '16px'
                        }}
                      >
                        View Details
                      </button>
                    </div>
                    
                    <div style={{ display: 'flex', gap: '20px', fontSize: '13px', color: '#475569', paddingTop: '12px', borderTop: '1px solid #f1f5f9' }}>
                      <span><strong>Salesman:</strong> {profileNameById.get(lead.salesman_id) || 'Unknown'}</span>
                      {lead.order_value ? <span><strong>Value:</strong> ₹{lead.order_value.toLocaleString()}</span> : null}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
