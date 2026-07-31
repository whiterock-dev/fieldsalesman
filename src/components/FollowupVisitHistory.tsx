/*
 * Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
 * © 2026 WhiteRock (Royal Enterprise). All rights reserved.
 *
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  fetchB2BFollowupHistory,
  type B2BCustomerHistoryEntry,
  type B2BSalesmanOption,
} from '../lib/firebase'

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
  } catch {
    return iso
  }
}

function formatDateOnly(iso: string): string {
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function toLocalDateString(d: Date): string {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function FollowupVisitHistory() {
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string>('')
  const [history, setHistory] = useState<B2BCustomerHistoryEntry[]>([])
  const [salesmen, setSalesmen] = useState<B2BSalesmanOption[]>([])
  const [cities, setCities] = useState<string[]>([])

  const [searchTerm, setSearchTerm] = useState<string>('')
  const [selectedSalesmanId, setSelectedSalesmanId] = useState<string>('all')
  const [selectedCity, setSelectedCity] = useState<string>('all')
  const [datePreset, setDatePreset] = useState<'all' | 'today' | 'yesterday' | '7days' | 'custom'>('all')
  const [customStartDate, setCustomStartDate] = useState<string>('')
  const [customEndDate, setCustomEndDate] = useState<string>('')

  const [currentPage, setCurrentPage] = useState<number>(1)
  const [pageSize, setPageSize] = useState<number>(25)
  const [limitCount, setLimitCount] = useState<number>(500)
  const [expandedCustomerId, setExpandedCustomerId] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetchB2BFollowupHistory({
        limitCount,
        startDate: datePreset === 'custom' ? customStartDate : undefined,
        endDate: datePreset === 'custom' ? customEndDate : undefined,
      })
      setHistory(res.history)
      setSalesmen(res.scOptions)
      setCities(res.cities)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [limitCount, datePreset, customStartDate, customEndDate])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const todayStr = useMemo(() => toLocalDateString(new Date()), [])
  const yesterdayStr = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return toLocalDateString(d)
  }, [])
  const sevenDaysAgoStr = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return toLocalDateString(d)
  }, [])

  const filteredHistory = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    return history.filter((item) => {
      if (selectedSalesmanId !== 'all' && item.updatedBy !== selectedSalesmanId) {
        return false
      }
      if (selectedCity !== 'all' && item.customerCity !== selectedCity) {
        return false
      }

      if (datePreset === 'today') {
        const dStr = item.updatedAt.slice(0, 10)
        if (dStr !== todayStr) return false
      } else if (datePreset === 'yesterday') {
        const dStr = item.updatedAt.slice(0, 10)
        if (dStr !== yesterdayStr) return false
      } else if (datePreset === '7days') {
        const dStr = item.updatedAt.slice(0, 10)
        if (dStr < sevenDaysAgoStr || dStr > todayStr) return false
      } else if (datePreset === 'custom') {
        const dStr = item.updatedAt.slice(0, 10)
        if (customStartDate && dStr < customStartDate) return false
        if (customEndDate && dStr > customEndDate) return false
      }

      if (q) {
        const nameMatch = item.customerName.toLowerCase().includes(q)
        const phoneMatch = item.customerMobile ? item.customerMobile.includes(q) : false
        const firmMatch = item.customerFirm ? item.customerFirm.toLowerCase().includes(q) : false
        const cityMatch = item.customerCity ? item.customerCity.toLowerCase().includes(q) : false
        if (!nameMatch && !phoneMatch && !firmMatch && !cityMatch) return false
      }

      return true
    })
  }, [
    history,
    searchTerm,
    selectedSalesmanId,
    selectedCity,
    datePreset,
    customStartDate,
    customEndDate,
    todayStr,
    yesterdayStr,
    sevenDaysAgoStr,
  ])

  const customerHistoryMap = useMemo(() => {
    const map = new Map<string, B2BCustomerHistoryEntry[]>()
    history.forEach((item) => {
      const list = map.get(item.customerId) || []
      list.push(item)
      map.set(item.customerId, list)
    })
    return map
  }, [history])

  const totalPages = Math.max(1, Math.ceil(filteredHistory.length / pageSize))
  const safePage = Math.min(currentPage, totalPages)
  const startIndex = (safePage - 1) * pageSize
  const endIndex = Math.min(startIndex + pageSize, filteredHistory.length)
  const paginated = filteredHistory.slice(startIndex, endIndex)

  const toggleCustomerHistory = (customerId: string) => {
    setExpandedCustomerId((prev) => (prev === customerId ? null : customerId))
  }

  return (
    <section className="panel">
      <div className="cdHeader" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2>Back office Follow-up History</h2>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.2rem 0 0 0' }}>
            Customer follow-ups fetched directly from the B2Bsales</p>
        </div>
        <div className="cdActionGroup">
          <button
            type="button"
            className="secondary cdExportBtn"
            onClick={() => void loadData()}
            disabled={loading}
          >
            <svg
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              style={{ marginRight: 6 }}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            {loading ? 'Refreshing…' : 'Refresh Data'}
          </button>
        </div>
      </div>

      {error && (
        <div
          className="cdEditMsg cdEditMsgErr"
          style={{ marginBottom: '1rem', borderLeft: '4px solid #dc2626' }}
        >
          {error}
        </div>
      )}

      {/* Filter bar */}
      <article className="card cdFiltersCard" style={{ marginBottom: '1rem' }}>
        <div className="cdFilterBar" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: '0.75rem' }}>
          <label className="cdFilterItem cdFilterSearch" style={{ flex: '1 1 220px' }}>
            <span className="cdFilterLabel">Search Customer</span>
            <input
              type="text"
              placeholder="Name, firm, mobile, city…"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setCurrentPage(1)
              }}
              className="cdSearchInput"
            />
          </label>

          <label className="cdFilterItem" style={{ flex: '1 1 180px' }}>
            <span className="cdFilterLabel">SC</span>
            <select
              value={selectedSalesmanId}
              onChange={(e) => {
                setSelectedSalesmanId(e.target.value)
                setCurrentPage(1)
              }}
            >
              <option value="all">All Salesmen</option>
              {salesmen.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className="cdFilterItem" style={{ flex: '1 1 150px' }}>
            <span className="cdFilterLabel">City</span>
            <select
              value={selectedCity}
              onChange={(e) => {
                setSelectedCity(e.target.value)
                setCurrentPage(1)
              }}
            >
              <option value="all">All Cities</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label className="cdFilterItem" style={{ flex: '0 1 130px' }}>
            <span className="cdFilterLabel">Fetch Limit</span>
            <select
              value={limitCount}
              onChange={(e) => {
                setLimitCount(Number(e.target.value))
                setCurrentPage(1)
              }}
            >
              <option value="300">300 Records</option>
              <option value="500">500 Records</option>
              <option value="1000">1,000 Records</option>
              <option value="2000">2,000 Records</option>
            </select>
          </label>
        </div>

        {/* Time range filter on next line */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            flexWrap: 'wrap',
            borderTop: '1px solid var(--border)',
            paddingTop: '0.75rem',
          }}
        >
          <span className="cdFilterLabel" style={{ marginRight: '0.1rem' }}>
            Time Range:
          </span>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {(
              [
                { id: 'all', label: 'All Time' },
                { id: 'today', label: 'Today' },
                { id: 'yesterday', label: 'Yesterday' },
                { id: '7days', label: 'Last 7 Days' },
                { id: 'custom', label: 'Custom Range' },
              ] as const
            ).map((btn) => {
              const isActive = datePreset === btn.id
              return (
                <button
                  key={btn.id}
                  type="button"
                  className={isActive ? 'primary' : 'secondary'}
                  style={{
                    padding: '0.35rem 0.75rem',
                    fontSize: '0.78rem',
                    fontWeight: isActive ? 600 : 500,
                  }}
                  onClick={() => {
                    setDatePreset(btn.id)
                    if (btn.id === 'custom') {
                      if (!customStartDate) setCustomStartDate(sevenDaysAgoStr)
                      if (!customEndDate) setCustomEndDate(todayStr)
                    }
                    setCurrentPage(1)
                  }}
                >
                  {btn.label}
                </button>
              )
            })}
          </div>

          {datePreset === 'custom' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                marginLeft: '0.25rem',
                flexWrap: 'wrap',
              }}
            >
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => {
                  setCustomStartDate(e.target.value)
                  setCurrentPage(1)
                }}
                style={{
                  padding: '0.28rem 0.5rem',
                  fontSize: '0.78rem',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text)',
                }}
              />
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>to</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => {
                  setCustomEndDate(e.target.value)
                  setCurrentPage(1)
                }}
                style={{
                  padding: '0.28rem 0.5rem',
                  fontSize: '0.78rem',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text)',
                }}
              />
            </div>
          )}
        </div>

        <p className="cdFilterCount" style={{ marginTop: '0.75rem' }}>
          Showing <strong>{filteredHistory.length}</strong> of <strong>{history.length}</strong> total records
        </p>
      </article>

      {/* Table Card */}
      <article className="card" style={{ padding: 0 }}>
        {loading ? (
          <div className="cdEmptyState" style={{ padding: '3rem 1rem' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                border: '3px solid var(--border)',
                borderTopColor: 'var(--accent)',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                margin: '0 auto 1rem',
              }}
            />
            <p style={{ fontWeight: 600, color: 'var(--text)' }}>
              Loading follow-up history from Firebase…
            </p>
          </div>
        ) : filteredHistory.length === 0 ? (
          <div className="cdEmptyState" style={{ padding: '3.5rem 1rem' }}>
            <svg
              width="48"
              height="48"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth="1.2"
            >
              <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p style={{ fontWeight: 600, marginTop: '0.5rem' }}>No follow-up history found</p>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Try adjusting your search terms, salesman filter, or date range.
            </span>
          </div>
        ) : (
          <div>
            <div className="cdTableWrap">
              <table className="cdTable" style={{ width: '100%', tableLayout: 'auto' }}>
                <thead>
                  <tr>
                    <th style={{ width: '40px', textAlign: 'center' }}>#</th>
                    <th style={{ width: '220px', maxWidth: '240px' }}>Customer Details</th>
                    <th style={{ width: '140px' }}>Salesman / SC</th>
                    <th style={{ width: '120px' }}>Next Follow-up</th>
                    <th style={{ width: '280px', maxWidth: '320px' }}>Next Action</th>
                    <th style={{ width: '140px' }}>Timestamp</th>
                    <th style={{ width: '110px', textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((item, idx) => {
                    const custHistory = customerHistoryMap.get(item.customerId) || []
                    const isExpanded = expandedCustomerId === item.customerId

                    return (
                      <React.Fragment key={item.id}>
                        <tr>
                          <td style={{ textAlign: 'center', fontWeight: 500, color: 'var(--text-muted)' }}>
                            {startIndex + idx + 1}
                          </td>

                          <td className="cdNameCell">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                              <strong style={{ fontSize: '0.9rem', color: 'var(--text)' }}>
                                {item.customerName}
                              </strong>
                              {item.customerFirm && item.customerFirm !== '—' && (
                                <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                                  {item.customerFirm}
                                </span>
                              )}
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  marginTop: '2px',
                                  flexWrap: 'wrap',
                                }}
                              >
                                {item.customerCity && item.customerCity !== '—' && (
                                  <span
                                    style={{
                                      backgroundColor: 'var(--accent-subtle)',
                                      color: 'var(--text)',
                                      padding: '0.12rem 0.45rem',
                                      borderRadius: '4px',
                                      fontSize: '0.72rem',
                                      fontWeight: 600,
                                    }}
                                  >
                                    {item.customerCity}
                                  </span>
                                )}
                                {item.customerMobile && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span
                                      style={{
                                        fontSize: '0.78rem',
                                        color: 'var(--text-secondary)',
                                        fontFamily: 'monospace',
                                      }}
                                    >
                                      {item.customerMobile}
                                    </span>
                                    <a
                                      href={`tel:${item.customerMobile}`}
                                      title="Call"
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        color: 'var(--accent)',
                                        textDecoration: 'none',
                                      }}
                                    >
                                      <svg
                                        width="16"
                                        height="16"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                        strokeWidth="2.5"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      >
                                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                                      </svg>
                                    </a>
                                    <a
                                      href={`https://wa.me/91${item.customerMobile.replace(/\D/g, '')}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title="WhatsApp"
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        color: '#25D366',
                                        textDecoration: 'none',
                                      }}
                                    >
                                      <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
                                      </svg>
                                    </a>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>

                          <td className="cdCompactCell">
                            <span
                              style={{
                                fontWeight: 600,
                                color: 'var(--text)',
                                fontSize: '0.84rem',
                              }}
                            >
                              {item.updatedByName}
                            </span>
                          </td>

                          <td className="cdCompactCell">
                            {item.nextFollowupDate ? (
                              <span
                                style={{
                                  backgroundColor: '#f0fdf4',
                                  color: '#166534',
                                  border: '1px solid #bbf7d0',
                                  padding: '0.18rem 0.5rem',
                                  borderRadius: '5px',
                                  fontSize: '0.78rem',
                                  fontWeight: 600,
                                }}
                              >
                                {formatDateOnly(item.nextFollowupDate)}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>

                          <td
                            className="cdCompactCell"
                            style={{
                              width: '280px',
                              maxWidth: '320px',
                              whiteSpace: 'normal',
                              wordBreak: 'break-word',
                              lineHeight: '1.35',
                            }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              {item.fieldChanged && item.fieldChanged !== 'updated' && (
                                <div
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    flexWrap: 'wrap',
                                    fontSize: '0.76rem',
                                  }}
                                >
                                  <span
                                    style={{
                                      backgroundColor: 'var(--accent-subtle)',
                                      padding: '1px 6px',
                                      borderRadius: '4px',
                                      fontWeight: 600,
                                      color: 'var(--text)',
                                    }}
                                  >
                                    {item.fieldChanged}
                                  </span>
                                  {item.oldValue || item.newValue ? (
                                    <span
                                      style={{
                                        color: 'var(--text-secondary)',
                                        wordBreak: 'break-word',
                                      }}
                                    >
                                      {item.oldValue || '(empty)'} →{' '}
                                      <strong style={{ color: 'var(--text)' }}>
                                        {item.newValue || '(empty)'}
                                      </strong>
                                    </span>
                                  ) : null}
                                </div>
                              )}
                              {item.remark ? (
                                <p
                                  style={{
                                    fontSize: '0.82rem',
                                    color: 'var(--text)',
                                    margin: 0,
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                  }}
                                >
                                  {item.remark}
                                </p>
                              ) : (
                                !item.fieldChanged && (
                                  <span
                                    style={{
                                      fontStyle: 'italic',
                                      color: 'var(--text-muted)',
                                      fontSize: '0.78rem',
                                    }}
                                  >
                                    No remark recorded
                                  </span>
                                )
                              )}
                            </div>
                          </td>

                          <td className="cdCompactCell cdDateCell">
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                              {formatDateTime(item.updatedAt)}
                            </span>
                          </td>

                          <td style={{ textAlign: 'center' }}>
                            {custHistory.length > 0 && (
                              <button
                                type="button"
                                className={isExpanded ? 'primary' : 'secondary'}
                                style={{
                                  padding: '0.35rem 0.65rem',
                                  fontSize: '0.76rem',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                                onClick={() => toggleCustomerHistory(item.customerId)}
                              >
                                <svg
                                  width="14"
                                  height="14"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                  strokeWidth="2"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                                  />
                                </svg>
                                {isExpanded ? 'Hide' : `History (${custHistory.length})`}
                              </button>
                            )}
                          </td>
                        </tr>

                        {/* Expandable History for Customer */}
                        {isExpanded && (
                          <tr style={{ backgroundColor: 'rgba(15, 61, 57, 0.03)' }}>
                            <td colSpan={7} style={{ padding: '1rem 1.25rem' }}>
                              <div
                                style={{
                                  borderLeft: '4px solid var(--accent)',
                                  backgroundColor: 'var(--surface)',
                                  padding: '0.85rem 1rem',
                                  borderRadius: '0 var(--radius-md) var(--radius-md) 0',
                                  boxShadow: 'var(--shadow-sm)',
                                  border: '1px solid var(--border)',
                                }}
                              >
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    marginBottom: '0.6rem',
                                  }}
                                >
                                  <h4
                                    style={{
                                      fontSize: '0.84rem',
                                      fontWeight: 600,
                                      color: 'var(--text)',
                                      margin: 0,
                                    }}
                                  >
                                    All Follow-up Entries for {item.customerName}
                                  </h4>
                                  <span
                                    style={{
                                      fontSize: '0.74rem',
                                      color: 'var(--text-muted)',
                                      fontWeight: 500,
                                    }}
                                  >
                                    {custHistory.length} total entries in Firebase
                                  </span>
                                </div>

                                <div
                                  style={{
                                    maxHeight: '260px',
                                    overflowY: 'auto',
                                    overflowX: 'auto',
                                    border: '1px solid var(--border)',
                                    borderRadius: 'var(--radius-sm)',
                                  }}
                                >
                                  <table
                                    style={{
                                      width: '100%',
                                      borderCollapse: 'collapse',
                                      tableLayout: 'fixed',
                                    }}
                                  >
                                    <thead>
                                      <tr
                                        style={{
                                          backgroundColor: 'var(--accent-subtle)',
                                          borderBottom: '1px solid var(--border)',
                                        }}
                                      >
                                        <th
                                          style={{
                                            width: '140px',
                                            padding: '0.45rem 0.6rem',
                                            fontSize: '0.72rem',
                                            textAlign: 'left',
                                            color: 'var(--text-muted)',
                                          }}
                                        >
                                          TIMESTAMP
                                        </th>
                                        <th
                                          style={{
                                            width: '140px',
                                            padding: '0.45rem 0.6rem',
                                            fontSize: '0.72rem',
                                            textAlign: 'left',
                                            color: 'var(--text-muted)',
                                          }}
                                        >
                                          SALESMAN
                                        </th>
                                        <th
                                          style={{
                                            width: '120px',
                                            padding: '0.45rem 0.6rem',
                                            fontSize: '0.72rem',
                                            textAlign: 'left',
                                            color: 'var(--text-muted)',
                                          }}
                                        >
                                          NEXT FOLLOWUP
                                        </th>
                                        <th
                                          style={{
                                            padding: '0.45rem 0.6rem',
                                            fontSize: '0.72rem',
                                            textAlign: 'left',
                                            color: 'var(--text-muted)',
                                          }}
                                        >
                                          NEXT ACTION
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {custHistory.map((hItem) => (
                                        <tr
                                          key={hItem.id}
                                          style={{ borderBottom: '1px solid var(--border)' }}
                                        >
                                          <td
                                            style={{
                                              padding: '0.45rem 0.6rem',
                                              fontSize: '0.76rem',
                                              color: 'var(--text-secondary)',
                                              whiteSpace: 'nowrap',
                                              overflow: 'hidden',
                                              textOverflow: 'ellipsis',
                                            }}
                                          >
                                            {formatDateTime(hItem.updatedAt)}
                                          </td>
                                          <td
                                            style={{
                                              padding: '0.45rem 0.6rem',
                                              fontSize: '0.8rem',
                                              fontWeight: 600,
                                              color: 'var(--text)',
                                              whiteSpace: 'nowrap',
                                              overflow: 'hidden',
                                              textOverflow: 'ellipsis',
                                            }}
                                          >
                                            {hItem.updatedByName}
                                          </td>
                                          <td
                                            style={{
                                              padding: '0.45rem 0.6rem',
                                              fontSize: '0.78rem',
                                              color: 'var(--text)',
                                              whiteSpace: 'nowrap',
                                            }}
                                          >
                                            {hItem.nextFollowupDate
                                              ? formatDateOnly(hItem.nextFollowupDate)
                                              : '—'}
                                          </td>
                                          <td
                                            style={{
                                              padding: '0.45rem 0.6rem',
                                              fontSize: '0.78rem',
                                              whiteSpace: 'normal',
                                              wordBreak: 'break-word',
                                              overflowWrap: 'break-word',
                                              lineHeight: '1.35',
                                            }}
                                          >
                                            {hItem.fieldChanged &&
                                            hItem.fieldChanged !== 'updated' ? (
                                              <div style={{ marginBottom: hItem.remark ? '4px' : 0 }}>
                                                <strong>{hItem.fieldChanged}:</strong>{' '}
                                                {hItem.oldValue || '(empty)'} →{' '}
                                                <strong>{hItem.newValue || '(empty)'}</strong>
                                              </div>
                                            ) : null}
                                            {hItem.remark && (
                                              <div style={{ color: 'var(--text)' }}>
                                                {hItem.remark}
                                              </div>
                                            )}
                                            {!hItem.remark &&
                                              (!hItem.fieldChanged ||
                                                hItem.fieldChanged === 'updated') && (
                                                <span
                                                  style={{
                                                    color: 'var(--text-muted)',
                                                    fontStyle: 'italic',
                                                  }}
                                                >
                                                  (no details)
                                                </span>
                                              )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '1rem',
                padding: '0.75rem 1rem',
                borderTop: '1px solid var(--border)',
                backgroundColor: 'var(--surface)',
                borderRadius: '0 0 var(--radius-md) var(--radius-md)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1rem',
                  fontSize: '0.78rem',
                  color: 'var(--text-secondary)',
                }}
              >
                <span>
                  Showing <strong>{startIndex + 1}</strong> to{' '}
                  <strong>{endIndex}</strong> of <strong>{filteredHistory.length}</strong> filtered
                </span>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', margin: 0 }}>
                  <span>Rows:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value))
                      setCurrentPage(1)
                    }}
                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.78rem' }}
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </label>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="secondary"
                  disabled={safePage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                  style={{ padding: '0.35rem 0.7rem', fontSize: '0.78rem' }}
                >
                  ← Prev
                </button>
                <span
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    padding: '0 0.25rem',
                    color: 'var(--text)',
                  }}
                >
                  Page {safePage} of {totalPages}
                </span>
                <button
                  type="button"
                  className="secondary"
                  disabled={safePage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                  style={{ padding: '0.35rem 0.7rem', fontSize: '0.78rem' }}
                >
                  Next →
                </button>
              </div>
            </div>
          </div>
        )}
      </article>
    </section>
  )
}
