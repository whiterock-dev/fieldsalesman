/*
 * Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
 * © 2026 WhiteRock (Royal Enterprise). All rights reserved.
 *
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

import React, { useState, useMemo, useEffect } from 'react'
import type { CustomerOrderFilters } from './types'

export interface OrdersFilterBarProps {
  filters: CustomerOrderFilters
  onChange: (newFilters: CustomerOrderFilters) => void
  salesmen: Array<{ id: string; name: string }>
  cities: Array<{ id: string; name: string }>
  onReset: () => void
  exportButton?: React.ReactNode
}

export function OrdersFilterBar({
  filters,
  onChange,
  salesmen,
  cities,
  onReset,
  exportButton,
}: OrdersFilterBarProps) {
  const [isCustomMode, setIsCustomMode] = useState(false)

  const todayStr = useMemo(() => {
    const d = new Date()
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }, [])

  const last7DaysStr = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }, [])

  const last30DaysStr = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }, [])

  const dateRangePreset = useMemo(() => {
    if (isCustomMode) return 'custom'
    if (!filters.orderDateFrom && !filters.orderDateTo) return 'all'
    if (
      filters.orderDateFrom === last7DaysStr &&
      (filters.orderDateTo === todayStr || !filters.orderDateTo)
    ) {
      return '7days'
    }
    if (
      filters.orderDateFrom === last30DaysStr &&
      (filters.orderDateTo === todayStr || !filters.orderDateTo)
    ) {
      return '30days'
    }
    return 'custom'
  }, [isCustomMode, filters.orderDateFrom, filters.orderDateTo, last7DaysStr, last30DaysStr, todayStr])

  useEffect(() => {
    if (!filters.orderDateFrom && !filters.orderDateTo) {
      setIsCustomMode(false)
    }
  }, [filters.orderDateFrom, filters.orderDateTo])

  const handleDateRangeChange = (preset: string) => {
    if (preset === 'all') {
      setIsCustomMode(false)
      onChange({ ...filters, orderDateFrom: undefined, orderDateTo: undefined })
    } else if (preset === '7days') {
      setIsCustomMode(false)
      onChange({ ...filters, orderDateFrom: last7DaysStr, orderDateTo: todayStr })
    } else if (preset === '30days') {
      setIsCustomMode(false)
      onChange({ ...filters, orderDateFrom: last30DaysStr, orderDateTo: todayStr })
    } else if (preset === 'custom') {
      setIsCustomMode(true)
      onChange({
        ...filters,
        orderDateFrom: filters.orderDateFrom || last30DaysStr,
        orderDateTo: filters.orderDateTo || todayStr,
      })
    }
  }

  const handleChange = (field: keyof CustomerOrderFilters, value: string | number | undefined) => {
    onChange({ ...filters, [field]: value })
  }

  const hasActiveFilters = Boolean(
    filters.salesmanId ||
    filters.city ||
    filters.customerCategory ||
    filters.orderDateFrom ||
    filters.orderDateTo ||
    filters.minOrderValue
  )

  const inputStyle: React.CSSProperties = {
    height: '38px',
    width: '100%',
    padding: '0 12px',
    borderRadius: '8px',
    border: '1px solid #cbd5e1',
    backgroundColor: '#ffffff',
    color: '#1e293b',
    fontSize: '13px',
    fontWeight: 500,
    outline: 'none',
    boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.03)',
    boxSizing: 'border-box',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '12px',
    fontWeight: 600,
    color: '#475569',
    marginBottom: '6px',
    letterSpacing: '0.01em',
  }

  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        padding: '20px 24px',
        marginBottom: '24px',
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.04)',
      }}
    >
      {/* Card Header Row */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '18px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: '#64748b' }}
          >
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          <span style={{ fontSize: '15px', fontWeight: 600, color: '#1e293b', letterSpacing: '-0.01em' }}>
            Advanced Analysis Filters
          </span>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={onReset}
              style={{
                background: 'none',
                border: 'none',
                color: '#2563eb',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                padding: '0 4px',
                marginLeft: '6px',
                textDecoration: 'underline',
              }}
            >
              Reset Filters
            </button>
          )}
        </div>

        <div>{exportButton}</div>
      </div>

      {/* Filter Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '16px',
          alignItems: 'end',
        }}
      >
        {/* Sales Coordinator */}
        <div>
          <label style={labelStyle}>Salesman</label>
          <select
            value={filters.salesmanId || ''}
            onChange={(e) => handleChange('salesmanId', e.target.value || undefined)}
            style={inputStyle}
          >
            <option value="">All Salesman</option>
            {salesmen.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {/* City */}
        <div>
          <label style={labelStyle}>City</label>
          <select
            value={filters.city || ''}
            onChange={(e) => handleChange('city', e.target.value || undefined)}
            style={inputStyle}
          >
            <option value="">All Cities</option>
            {cities.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Customer Category */}
        <div>
          <label style={labelStyle}>Customer Category</label>
          <select
            value={filters.customerCategory || ''}
            onChange={(e) => handleChange('customerCategory', e.target.value || undefined)}
            style={inputStyle}
          >
            <option value="">All Categories</option>
            {['A', 'B', 'C', 'D', 'E'].map((cat) => (
              <option key={cat} value={cat}>
                Category {cat}
              </option>
            ))}
          </select>
        </div>

        {/* Date Range */}
        <div>
          <label style={labelStyle}>Date Range</label>
          <select
            value={dateRangePreset}
            onChange={(e) => handleDateRangeChange(e.target.value)}
            style={inputStyle}
          >
            <option value="all">All Dates</option>
            <option value="7days">Last 7 days</option>
            <option value="30days">Last 30 days</option>
            <option value="custom">Custom Range</option>
          </select>
        </div>

        {/* Order Value (Above) */}
        <div>
          <label style={labelStyle}>Order Value (Above)</label>
          <select
            value={filters.minOrderValue || ''}
            onChange={(e) => handleChange('minOrderValue', e.target.value ? Number(e.target.value) : undefined)}
            style={inputStyle}
          >
            <option value="">Any Amount</option>
            <option value="10000">₹10,000+</option>
            <option value="25000">₹25,000+</option>
            <option value="50000">₹50,000+</option>
            <option value="100000">₹1,00,000+</option>
            <option value="200000">₹2,00,000+</option>
            <option value="500000">₹5,00,000+</option>
          </select>
        </div>
      </div>

      {/* Custom Range Date Inputs */}
      {dateRangePreset === 'custom' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            marginTop: '16px',
            paddingTop: '16px',
            borderTop: '1px dashed #e2e8f0',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>From:</span>
            <input
              type="date"
              value={filters.orderDateFrom || ''}
              onChange={(e) => handleChange('orderDateFrom', e.target.value || undefined)}
              style={{ ...inputStyle, width: '170px' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>To:</span>
            <input
              type="date"
              value={filters.orderDateTo || ''}
              onChange={(e) => handleChange('orderDateTo', e.target.value || undefined)}
              style={{ ...inputStyle, width: '170px' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
