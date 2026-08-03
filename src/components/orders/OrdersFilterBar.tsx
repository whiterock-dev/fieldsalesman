/*
 * Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
 * © 2026 WhiteRock (Royal Enterprise). All rights reserved.
 *
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

import type { CustomerOrderFilters } from './types'

export interface OrdersFilterBarProps {
  filters: CustomerOrderFilters
  onChange: (newFilters: CustomerOrderFilters) => void
  salesmen: Array<{ id: string; name: string }>
  cities: Array<{ id: string; name: string }>
  onReset: () => void
}

export function OrdersFilterBar({
  filters,
  onChange,
  salesmen,
  cities,
  onReset,
}: OrdersFilterBarProps) {
  const handleChange = (field: keyof CustomerOrderFilters, value: any) => {
    onChange({ ...filters, [field]: value })
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '12px',
        alignItems: 'center',
        padding: '12px 16px',
        backgroundColor: '#f8fafc',
        borderRadius: '8px',
        border: '1px solid #e2e8f0',
        marginBottom: '16px',
      }}
    >
      <input
        type="text"
        placeholder="Search customer, mobile, PO #..."
        value={filters.search || ''}
        onChange={(e) => handleChange('search', e.target.value || undefined)}
        style={{
          padding: '8px 12px',
          borderRadius: '6px',
          border: '1px solid #cbd5e1',
          minWidth: '220px',
          flex: 1,
        }}
      />

      <select
        value={filters.salesmanId || ''}
        onChange={(e) => handleChange('salesmanId', e.target.value || undefined)}
        style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
      >
        <option value="">All Salesmen</option>
        {salesmen.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      <select
        value={filters.city || ''}
        onChange={(e) => handleChange('city', e.target.value || undefined)}
        style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
      >
        <option value="">All Cities</option>
        {cities.map((c) => (
          <option key={c.id} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>

      <select
        value={filters.customerCategory || ''}
        onChange={(e) => handleChange('customerCategory', e.target.value || undefined)}
        style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
      >
        <option value="">All Categories</option>
        {['A', 'B', 'C', 'D', 'E'].map((cat) => (
          <option key={cat} value={cat}>
            Category {cat}
          </option>
        ))}
      </select>

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontSize: '13px', color: '#64748b' }}>From:</span>
        <input
          type="date"
          value={filters.orderDateFrom || ''}
          onChange={(e) => handleChange('orderDateFrom', e.target.value || undefined)}
          style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
        />
        <span style={{ fontSize: '13px', color: '#64748b' }}>To:</span>
        <input
          type="date"
          value={filters.orderDateTo || ''}
          onChange={(e) => handleChange('orderDateTo', e.target.value || undefined)}
          style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
        />
      </div>

      <button
        type="button"
        onClick={onReset}
        style={{
          padding: '8px 14px',
          backgroundColor: '#e2e8f0',
          color: '#334155',
          border: 'none',
          borderRadius: '6px',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Reset Filters
      </button>
    </div>
  )
}
