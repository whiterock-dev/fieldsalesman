// LeadsFilterBar

export interface LeadsFilters {
  search?: string
  status?: string
  salesmanId?: string
  cityId?: string
  followupRange?: 'today' | 'overdue' | 'upcoming' | 'all'
  createdDateRange?: string
  createdDateFrom?: string
  createdDateTo?: string
  nextFollowupDateRange?: string
  nextFollowupDateFrom?: string
  nextFollowupDateTo?: string
}

export interface LeadsFilterBarProps {
  filters: LeadsFilters
  onChange: (f: LeadsFilters) => void
  salesmen: Array<{ id: string; name: string }>
  cities: Array<{ id: string; name: string }>
}

export function LeadsFilterBar({ filters, onChange, salesmen, cities }: LeadsFilterBarProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      padding: '16px 24px',
      backgroundColor: '#ffffff',
      borderRadius: '12px',
      border: '1px solid #e2e8f0',
      marginBottom: '24px',
      boxShadow: '0 1px 2px 0 rgba(0,0,0,0.03)'
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: '200px' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }}>
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input 
            type="text" 
            placeholder="Search customers..." 
            value={filters.search || ''}
            onChange={e => onChange({ ...filters, search: e.target.value || undefined })}
            style={{ width: '100%', height: '40px', padding: '0 12px 0 36px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', outline: 'none', color: '#1e293b', boxSizing: 'border-box' }}
          />
        </div>

        <select
          value={filters.status || ''}
          onChange={(e) => onChange({ ...filters, status: e.target.value || undefined })}
          style={{ height: '40px', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '0 12px', fontSize: '13px', color: '#475569', backgroundColor: '#fff', minWidth: '140px', flex: '1 1 140px', outline: 'none', cursor: 'pointer' }}
        >
          <option value="">All Statuses</option>
          <option value="open">Open</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
        </select>

        <select
          value={filters.followupRange || 'all'}
          onChange={(e) => onChange({ ...filters, followupRange: e.target.value as any })}
          style={{ height: '40px', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '0 12px', fontSize: '13px', color: '#475569', backgroundColor: '#fff', minWidth: '150px', flex: '1 1 150px', outline: 'none', cursor: 'pointer' }}
        >
          <option value="all">Any Follow-up Status</option>
          <option value="overdue">Overdue</option>
          <option value="today">Today</option>
          <option value="upcoming">Upcoming</option>
        </select>

        <select
          value={filters.cityId || ''}
          onChange={(e) => onChange({ ...filters, cityId: e.target.value || undefined })}
          style={{ height: '40px', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '0 12px', fontSize: '13px', color: '#475569', backgroundColor: '#fff', minWidth: '140px', flex: '1 1 140px', outline: 'none', cursor: 'pointer' }}
        >
          <option value="">All Cities</option>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        <select
          value={filters.salesmanId || ''}
          onChange={(e) => onChange({ ...filters, salesmanId: e.target.value || undefined })}
          style={{ height: '40px', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '0 12px', fontSize: '13px', color: '#475569', backgroundColor: '#fff', minWidth: '140px', flex: '1 1 140px', outline: 'none', cursor: 'pointer' }}
        >
          <option value="">All Salesmen</option>
          {salesmen.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>Created Date:</span>
          <select
            value={filters.createdDateRange || 'all'}
            onChange={(e) => onChange({ ...filters, createdDateRange: e.target.value })}
            style={{ height: '40px', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '0 12px', fontSize: '13px', color: '#475569', backgroundColor: '#fff', minWidth: '130px', outline: 'none', cursor: 'pointer' }}
          >
            <option value="all">All Time</option>
            <option value="7days">Last 7 Days</option>
            <option value="30days">Last 30 Days</option>
            <option value="custom">Custom Range</option>
          </select>
          {filters.createdDateRange === 'custom' && (
            <>
              <input 
                type="date" 
                value={filters.createdDateFrom || ''} 
                onChange={e => onChange({ ...filters, createdDateFrom: e.target.value })}
                style={{ height: '40px', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '0 8px', fontSize: '13px' }}
              />
              <span style={{ fontSize: '13px', color: '#94a3b8' }}>to</span>
              <input 
                type="date" 
                value={filters.createdDateTo || ''} 
                onChange={e => onChange({ ...filters, createdDateTo: e.target.value })}
                style={{ height: '40px', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '0 8px', fontSize: '13px' }}
              />
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>Next Follow-up Date:</span>
          <select
            value={filters.nextFollowupDateRange || 'all'}
            onChange={(e) => onChange({ ...filters, nextFollowupDateRange: e.target.value })}
            style={{ height: '40px', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '0 12px', fontSize: '13px', color: '#475569', backgroundColor: '#fff', minWidth: '130px', outline: 'none', cursor: 'pointer' }}
          >
            <option value="all">All Time</option>
            <option value="7days">Last 7 Days</option>
            <option value="30days">Last 30 Days</option>
            <option value="custom">Custom Range</option>
          </select>
          {filters.nextFollowupDateRange === 'custom' && (
            <>
              <input 
                type="date" 
                value={filters.nextFollowupDateFrom || ''} 
                onChange={e => onChange({ ...filters, nextFollowupDateFrom: e.target.value })}
                style={{ height: '40px', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '0 8px', fontSize: '13px' }}
              />
              <span style={{ fontSize: '13px', color: '#94a3b8' }}>to</span>
              <input 
                type="date" 
                value={filters.nextFollowupDateTo || ''} 
                onChange={e => onChange({ ...filters, nextFollowupDateTo: e.target.value })}
                style={{ height: '40px', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '0 8px', fontSize: '13px' }}
              />
            </>
          )}
        </div>
        
        <button
          onClick={() => onChange({})}
          style={{ height: '40px', padding: '0 16px', borderRadius: '8px', border: '1px solid #e2e8f0', backgroundColor: '#f8fafc', color: '#475569', fontSize: '13px', fontWeight: 600, cursor: 'pointer', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', transition: 'background-color 0.2s' }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><polyline points="3 3 3 8 8 8"></polyline></svg>
          Reset Filters
        </button>
      </div>
    </div>
  )
}
