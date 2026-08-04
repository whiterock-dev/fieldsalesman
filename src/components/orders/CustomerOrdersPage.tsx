/*
 * Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
 * © 2026 WhiteRock (Royal Enterprise). All rights reserved.
 *
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import type { EnrichedCustomerOrder, CustomerOrderFilters, OrderProduct, CustomerOrder } from './types'
import {
  getRawCustomerOrders,
  enrichAndFilterOrders,
  // deleteCustomerOrder,
  getProductMasterList,
  bulkImportOrders,
  formatDDMMYYYY,
  parseDDMMYYYY,
} from './ordersApi'
import { OrdersFilterBar } from './OrdersFilterBar'
import { AddOrderDialog } from './AddOrderDialog'
import { OrderDetailsDialog } from './OrderDetailsDialog'
import { exportToCsv } from '../../lib/exportUtils'
import type { Role } from '../../lib/roles'

export interface CustomerOrdersPageProps {
  customers: Array<{
    id: string
    name: string
    phone: string
    city: string
    assignedSalesmanId: string
    category?: 'A' | 'B' | 'C' | 'D' | 'E' | null
  }>
  salesmen: Array<{ id: string; name: string }>
  cities: Array<{ id: string; name: string }>
  role: Role
  currentUserId: string
  onDataChanged: () => void
}

export const CustomerOrdersPage = React.memo(function CustomerOrdersPage({
  customers,
  salesmen,
  cities,
  role,
  currentUserId,
  onDataChanged,
}: CustomerOrdersPageProps) {
  const [rawOrders, setRawOrders] = useState<CustomerOrder[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [filters, setFilters] = useState<CustomerOrderFilters>({})
  const [productMasterList, setProductMasterList] = useState<string[]>([])

  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editingOrder, setEditingOrder] = useState<EnrichedCustomerOrder | null>(null)
  // const [deletingId, setDeletingId] = useState<string | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<EnrichedCustomerOrder | null>(null)

  // CSV file-upload state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [csvUploading, setCsvUploading] = useState(false)
  const [csvResult, setCsvResult] = useState<{
    type: 'success' | 'error' | 'warning'
    importedCount: number
    errors: string[]
  } | null>(null)

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 20

  const dbFilterKey = useMemo(() => {
    return JSON.stringify({
      orderDateFrom: filters.orderDateFrom || '',
      orderDateTo: filters.orderDateTo || '',
      salesmanId: filters.salesmanId || '',
      customerId: filters.customerId || '',
    })
  }, [filters.orderDateFrom, filters.orderDateTo, filters.salesmanId, filters.customerId])

  const loadData = useCallback(async (showLoading = true) => {
    if (showLoading) setIsLoading(true)
    try {
      const [list, pMaster] = await Promise.all([
        getRawCustomerOrders(filters),
        getProductMasterList(),
      ])
      setRawOrders(list)
      setProductMasterList(pMaster)
    } catch (err) {
      console.warn('Error loading orders page:', err)
    } finally {
      if (showLoading) setIsLoading(false)
    }
  }, [dbFilterKey])

  useEffect(() => {
    loadData(true)
  }, [loadData])

  const orders = useMemo(() => {
    return enrichAndFilterOrders(rawOrders, customers, filters)
  }, [rawOrders, customers, filters])

  useEffect(() => {
    setCurrentPage(1)
  }, [filters])

  const stats = useMemo(() => {
    const totalOrders = orders.length
    const totalRevenue = orders.reduce((sum, o) => sum + (o.orderValue || 0), 0)
    const avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0
    return { totalOrders, totalRevenue, avgOrderValue }
  }, [orders])

  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return orders.slice(start, start + pageSize)
  }, [orders, currentPage])

  const totalPages = Math.max(1, Math.ceil(orders.length / pageSize))

  // const handleDelete = async (orderId: string, customerId: string) => {
  //   if (!window.confirm('Are you sure you want to delete this order?')) return
  //   setDeletingId(orderId)
  //   try {
  //     const ok = await deleteCustomerOrder(orderId, customerId)
  //     if (ok) {
  //       setOrders((prev) => prev.filter((o) => o.id !== orderId))
  //       onDataChanged()
  //     }
  //   } finally {
  //     setDeletingId(null)
  //   }
  // }

  const handleExportCsv = () => {
    const headers = [
      'Order ID',
      'Order Date',
      'PO/Invoice #',
      'Customer Name',
      'Customer Mobile',
      'Category',
      'City',
      'Products Summary',
      'Order Value (INR)',
      'Salesman Name',
      'Remarks',
    ]
    const rows = orders.map((o) => [
      o.id,
      formatDDMMYYYY(o.orderDate),
      o.orderNumber || '',
      o.customerName,
      o.customerMobile || '',
      o.customerCategory || '',
      o.customerCity || '',
      o.products.map((p) => `${p.productName} (₹${p.orderValue || 0})`).join('; '),
      String(o.orderValue || 0),
      o.salesmanName || '',
      o.remark || '',
    ])
    exportToCsv(`customer_orders_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows)
  }

  // ── Template download (no modal needed)
  function handleDownloadTemplate() {
    const templateCsv =
      'customerMobile,orderDate,orderNumber,productName,sellingRate,orderValue,salesmanName,remark\r\n' 
      '9884411100,02-08-2026,PO-1002,T-Grid,25,12500,Salesman,\r\n'
    const blob = new Blob(['﻿' + templateCsv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'orders_import_template.csv'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  // ── File upload handler (reads the .csv file directly)
  async function handleCsvFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setCsvUploading(true)
    setCsvResult(null)

    const text = await file.text()
    if (fileInputRef.current) fileInputRef.current.value = ''

    const lines = text.split(/\r?\n/).filter((l) => l.trim())
    if (lines.length < 2) {
      setCsvResult({ type: 'error', importedCount: 0, errors: ['CSV must contain a header row and at least 1 data row.'] })
      setCsvUploading(false)
      return
    }

    const parseLine = (line: string) => {
      const result: string[] = []
      let curr = ''
      let inQuote = false
      for (let i = 0; i < line.length; i++) {
        const c = line[i]
        if (c === '"') {
          if (inQuote && line[i + 1] === '"') { curr += '"'; i++ }
          else inQuote = !inQuote
        } else if (c === ',' && !inQuote) {
          result.push(curr.trim()); curr = ''
        } else {
          curr += c
        }
      }
      result.push(curr.trim())
      return result
    }

    const headers = parseLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, ''))
    const groupedOrders = new Map<
      string,
      {
        customerMobile?: string
        orderDate: string
        orderNumber?: string
        orderValue: number
        products: OrderProduct[]
        salesmanName?: string
        remark?: string
      }
    >()

    for (let i = 1; i < lines.length; i++) {
      const cols = parseLine(lines[i])
      const row: Record<string, string> = {}
      headers.forEach((h, idx) => { row[h] = cols[idx] || '' })

      const rawMobile = row['customermobile'] || row['mobile'] || row['phone'] || ''
      const customerMobile = rawMobile.replace(/\D/g, '')
      if (!customerMobile) continue

      const rawDate = row['orderdate'] || row['date']
      const orderDate = parseDDMMYYYY(rawDate) || ''
      if (!orderDate) continue

      const orderNumber = (row['ordernumber'] || row['po'] || row['invoicenumber'] || '').trim()
      const productName = (row['productname'] || row['product'] || 'Gypsum Tile').trim()
      const sellingRate = parseFloat(row['sellingrate'] || row['rate'] || '0') || 0
      const rowValue = parseFloat(row['ordervalue'] || row['value'] || '0') || 0
      const orderValue = rowValue || sellingRate
      const salesmanName = row['salesmanname'] || row['salesman']
      const remark = row['remark'] || row['remarks']

      const key = `${customerMobile}_${orderDate}_${orderNumber}`

      if (!groupedOrders.has(key)) {
        groupedOrders.set(key, {
          customerMobile,
          orderDate,
          orderNumber,
          orderValue: 0,
          products: [],
          salesmanName,
          remark,
        })
      }

      const order = groupedOrders.get(key)!
      if (productName) {
        order.products.push({
          productName,
          sellingRate,
          orderValue,
        })
        order.orderValue += orderValue
      } else if (orderValue > 0) {
        order.orderValue += orderValue
      }
    }

    const parsedRows = Array.from(groupedOrders.values())

    try {
      const result = await bulkImportOrders(parsedRows, currentUserId, customers, salesmen)
      const type = result.importedCount > 0 && result.errors.length === 0
        ? 'success'
        : result.importedCount > 0
          ? 'warning'
          : 'error'
      setCsvResult({ type, importedCount: result.importedCount, errors: result.errors })
      if (result.importedCount > 0) {
        loadData(false)
        onDataChanged()
      }
    } catch (err) {
      setCsvResult({ type: 'error', importedCount: 0, errors: [String(err)] })
    } finally {
      setCsvUploading(false)
    }
  }

  const isReadOnly = role === 'salesman'

  const formatLoggedAt = (isoString?: string) => {
    if (!isoString) return '—'
    try {
      const date = new Date(isoString)
      if (isNaN(date.getTime())) return isoString
      return date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })
    } catch {
      return isoString
    }
  }

  const exportButtonNode = (
    <button
      type="button"
      onClick={handleExportCsv}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        height: '38px',
        padding: '0 16px',
        borderRadius: '8px',
        border: '1px solid #cbd5e1',
        backgroundColor: '#ffffff',
        color: '#1e293b',
        fontSize: '13px',
        fontWeight: 600,
        cursor: 'pointer',
        boxShadow: '0 1px 2px 0 rgba(0,0,0,0.03)',
        transition: 'all 0.15s ease',
      }}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      Export Report (CSV)
    </button>
  )

  return (
    <section className="panel" style={{ padding: '24px 28px', backgroundColor: '#f8fafc', minHeight: '100%' }}>
      {/* Hidden file input for CSV upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        style={{ display: 'none' }}
        onChange={handleCsvFileUpload}
      />

      {/* ── Top Card: Advanced Analysis Filters ── */}
      <OrdersFilterBar
        filters={filters}
        onChange={(f) => setFilters(f)}
        salesmen={salesmen}
        cities={cities}
        onReset={() => setFilters({})}
        exportButton={exportButtonNode}
      />

      {/* ── CSV Upload result banner ── */}
      {csvResult && (
        <div
          style={{
            marginBottom: '20px',
            padding: '12px 16px',
            borderRadius: '10px',
            fontSize: '13px',
            fontWeight: 500,
            backgroundColor: csvResult.type === 'success' ? '#f0fdf4' : csvResult.type === 'warning' ? '#fefce8' : '#fef2f2',
            border: `1px solid ${csvResult.type === 'success' ? '#bbf7d0' : csvResult.type === 'warning' ? '#fde68a' : '#fecaca'}`,
            color: csvResult.type === 'success' ? '#166534' : csvResult.type === 'warning' ? '#92400e' : '#991b1b',
            boxShadow: '0 1px 2px 0 rgba(0,0,0,0.03)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <span>
              {csvResult.type === 'success' && `✓ Imported ${csvResult.importedCount} order(s) successfully.`}
              {csvResult.type === 'warning' && `⚠ Imported ${csvResult.importedCount} order(s) with ${csvResult.errors.length} skipped row(s).`}
              {csvResult.type === 'error' && `✕ Import failed. ${csvResult.errors.length} error(s).`}
            </span>
            <button
              type="button"
              onClick={() => setCsvResult(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', lineHeight: 1, color: 'inherit', opacity: 0.6 }}
            >
              ✕
            </button>
          </div>
          {csvResult.errors.length > 0 && (
            <ul style={{ margin: '8px 0 0 20px', padding: 0, fontSize: '12px', lineHeight: '1.6' }}>
              {csvResult.errors.slice(0, 10).map((err, i) => (
                <li key={i}>{err}</li>
              ))}
              {csvResult.errors.length > 10 && (
                <li style={{ opacity: 0.7 }}>... and {csvResult.errors.length - 10} more</li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* ── Section Header Row ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
          marginBottom: '20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '50%',
              backgroundColor: '#f1f5f9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#475569',
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="9" cy="21" r="1" />
              <circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
          </div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0, color: '#0f172a', letterSpacing: '-0.02em' }}>
            Orders
          </h1>
          {!isLoading && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '2px 10px',
                backgroundColor: '#f1f5f9',
                color: '#475569',
                borderRadius: '12px',
                fontSize: '13px',
                fontWeight: 700,
              }}
            >
              {stats.totalOrders}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', width: '260px' }}>
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#94a3b8',
                pointerEvents: 'none',
              }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search by Name, Firm, or Mobi..."
              value={filters.search || ''}
              onChange={(e) => setFilters({ ...filters, search: e.target.value || undefined })}
              style={{
                height: '38px',
                width: '100%',
                paddingLeft: '34px',
                paddingRight: '12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                color: '#1e293b',
                fontSize: '13px',
                fontWeight: 500,
                outline: 'none',
                boxShadow: '0 1px 2px 0 rgba(0,0,0,0.03)',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {!isReadOnly && (
            <>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  height: '38px',
                  padding: '0 14px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                  color: '#334155',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px 0 rgba(0,0,0,0.03)',
                }}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Download Template
              </button>

              <button
                type="button"
                disabled={csvUploading}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  height: '38px',
                  padding: '0 14px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                  color: '#334155',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: csvUploading ? 'not-allowed' : 'pointer',
                  boxShadow: '0 1px 2px 0 rgba(0,0,0,0.03)',
                }}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                {csvUploading ? 'Uploading…' : 'Import Orders (CSV)'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setEditingOrder(null)
                  setIsAddOpen(true)
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  height: '38px',
                  padding: '0 16px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: '#0f172a',
                  color: '#ffffff',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)',
                }}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add Order
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Orders Table Card ── */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px 0 rgba(0,0,0,0.04)',
          overflow: 'hidden',
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table
            className="dataTable"
            style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}
          >
            <thead>
              <tr
                style={{
                  backgroundColor: '#f8fafc',
                  textAlign: 'left',
                  borderBottom: '1px solid #e2e8f0',
                }}
              >
                <th style={{ padding: '14px 16px', width: '48px', color: '#64748b', fontWeight: 600, fontSize: '12px' }}>
                  #
                </th>
                <th style={{ padding: '14px 16px', color: '#64748b', fontWeight: 600, fontSize: '12px' }}>
                  Customer Details
                </th>
                <th style={{ padding: '14px 16px', color: '#64748b', fontWeight: 600, fontSize: '12px' }}>
                  Order Date
                </th>
                <th style={{ padding: '14px 16px', color: '#64748b', fontWeight: 600, fontSize: '12px' }}>
                  Order Value
                </th>
                <th style={{ padding: '14px 16px', color: '#64748b', fontWeight: 600, fontSize: '12px' }}>
                  Salesman
                </th>
                <th style={{ padding: '14px 16px', color: '#64748b', fontWeight: 600, fontSize: '12px' }}>
                  Remarks
                </th>
                <th style={{ padding: '14px 16px', color: '#64748b', fontWeight: 600, fontSize: '12px' }}>
                  Logged At
                </th>
                <th
                  style={{
                    padding: '14px 16px',
                    textAlign: 'center',
                    width: '100px',
                    color: '#64748b',
                    fontWeight: 600,
                    fontSize: '12px',
                  }}
                >
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td
                    colSpan={8}
                    style={{ textAlign: 'center', padding: '48px 16px', color: '#64748b', fontSize: '14px' }}
                  >
                    Loading customer orders...
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    style={{ textAlign: 'center', padding: '48px 16px', color: '#64748b', fontSize: '14px' }}
                  >
                    No customer orders found matching current filters.
                  </td>
                </tr>
              ) : (
                paginatedOrders.map((o, idx) => (
                  <tr
                    key={o.id}
                    style={{
                      borderBottom: '1px solid #f1f5f9',
                      transition: 'background-color 0.15s ease',
                    }}
                  >
                    <td style={{ padding: '16px 16px', color: '#64748b', fontWeight: 500 }}>
                      {(currentPage - 1) * pageSize + idx + 1}
                    </td>
                    <td style={{ padding: '16px 16px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, color: '#0f172a', fontSize: '14px' }}>
                            {o.customerName}
                          </span>
                          {o.customerCategory && (
                            <span
                              style={{
                                padding: '2px 6px',
                                borderRadius: '4px',
                                backgroundColor: '#f1f5f9',
                                fontSize: '11px',
                                fontWeight: 700,
                                color: '#475569',
                              }}
                            >
                              {o.customerCategory}
                            </span>
                          )}
                        </div>
                        {o.customerMobile && (
                          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>
                            {o.customerMobile} {o.customerCity ? `• ${o.customerCity}` : ''}
                          </div>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '16px 16px', whiteSpace: 'nowrap', fontWeight: 500, color: '#1e293b' }}>
                      {formatDDMMYYYY(o.orderDate)}
                    </td>
                    <td style={{ padding: '16px 16px', whiteSpace: 'nowrap' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '4px 10px',
                          borderRadius: '16px',
                          backgroundColor: '#dcfce7',
                          color: '#166534',
                          fontWeight: 700,
                          fontSize: '13px',
                        }}
                      >
                        ₹{(o.orderValue || 0).toLocaleString('en-IN')}
                      </span>
                    </td>
                    <td style={{ padding: '16px 16px' }}>
                      {o.salesmanName ? (
                        <span
                          style={{
                            padding: '3px 10px',
                            borderRadius: '16px',
                            backgroundColor: '#f1f5f9',
                            color: '#334155',
                            fontSize: '12px',
                            fontWeight: 500,
                            display: 'inline-block',
                          }}
                        >
                          {o.salesmanName}
                        </span>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '16px 16px', color: '#475569', maxWidth: '200px', fontSize: '13px' }}>
                      {o.remark || '—'}
                    </td>
                    <td style={{ padding: '16px 16px', whiteSpace: 'nowrap' }}>
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          color: '#64748b',
                          fontSize: '12px',
                          fontWeight: 500,
                        }}
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12 6 12 12 16 14" />
                        </svg>
                        {formatLoggedAt(o.createdAt)}
                      </div>
                    </td>
                    <td style={{ padding: '16px 16px', textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => setSelectedOrder(o)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '6px 14px',
                          borderRadius: '6px',
                          border: '1px solid #e2e8f0',
                          backgroundColor: '#ffffff',
                          color: '#334155',
                          fontSize: '13px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          boxShadow: '0 1px 2px 0 rgba(0,0,0,0.03)',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Pagination Controls ── */}
      {totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '20px',
            padding: '12px 4px',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>
            Showing page {currentPage} of {totalPages} ({orders.length} total orders)
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              style={{
                height: '36px',
                padding: '0 14px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                backgroundColor: currentPage === 1 ? '#f1f5f9' : '#fff',
                color: currentPage === 1 ? '#94a3b8' : '#334155',
                fontSize: '13px',
                fontWeight: 600,
                cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
              }}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              style={{
                height: '36px',
                padding: '0 14px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                backgroundColor: currentPage === totalPages ? '#f1f5f9' : '#fff',
                color: currentPage === totalPages ? '#94a3b8' : '#334155',
                fontSize: '13px',
                fontWeight: 600,
                cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
              }}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Add Order Dialog */}
      <AddOrderDialog
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        onOrderSaved={() => {
          loadData(false)
          onDataChanged()
        }}
        customers={customers}
        salesmen={salesmen}
        currentUserId={currentUserId}
        productMasterList={productMasterList}
        orderToEdit={editingOrder}
      />

      <OrderDetailsDialog
        order={selectedOrder}
        isOpen={!!selectedOrder}
        onClose={() => setSelectedOrder(null)}
        customerName={selectedOrder?.customerName}
      />
    </section>
  )
})
