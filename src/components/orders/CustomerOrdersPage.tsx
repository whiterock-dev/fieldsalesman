/*
 * Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
 * © 2026 WhiteRock (Royal Enterprise). All rights reserved.
 *
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import type { EnrichedCustomerOrder, CustomerOrderFilters, OrderProduct } from './types'
import {
  getAllCustomerOrders,
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

export function CustomerOrdersPage({
  customers,
  salesmen,
  cities,
  role,
  currentUserId,
  onDataChanged,
}: CustomerOrdersPageProps) {
  const [orders, setOrders] = useState<EnrichedCustomerOrder[]>([])
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

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [list, pMaster] = await Promise.all([
        getAllCustomerOrders(filters, customers),
        getProductMasterList(),
      ])
      setOrders(list)
      setProductMasterList(pMaster)
      setCurrentPage(1)
    } catch (err) {
      console.warn('Error loading orders page:', err)
    } finally {
      setIsLoading(false)
    }
  }, [filters, customers])

  useEffect(() => {
    loadData()
  }, [loadData])

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
      'customerMobile,orderDate,orderNumber,productName,sellingRate,orderValue,salesmanName,remark\r\n' +
      '9990011122,01-08-2026,PO-1001,Gypsum Tile,50,50000,Rahul Sales,Sample bulk order\r\n' +
      '9884411100,02-08-2026,PO-1002,T-Grid,25,12500,Rahul Sales,\r\n'
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
        loadData()
        onDataChanged()
      }
    } catch (err) {
      setCsvResult({ type: 'error', importedCount: 0, errors: [String(err)] })
    } finally {
      setCsvUploading(false)
    }
  }

  const isReadOnly = role === 'salesman'

  return (
    <section className="panel" style={{ padding: '16px 20px' }}>

      {/* Hidden file input for CSV upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        style={{ display: 'none' }}
        onChange={handleCsvFileUpload}
      />

      {/* ── Header row ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '10px',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: '#0f172a' }}>
            Customer Orders
          </h1>
          {!isLoading && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '2px 10px',
                backgroundColor: '#e0f2fe',
                color: '#0369a1',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: 700,
              }}
            >
              {stats.totalOrders} orders
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleExportCsv}
            style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600 }}
          >
            ↓ Export CSV
          </button>

          {!isReadOnly && (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleDownloadTemplate}
                style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600 }}
              >
                ↓ Download Template
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                disabled={csvUploading}
                onClick={() => fileInputRef.current?.click()}
                style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 600 }}
              >
                {csvUploading ? 'Uploading…' : '↑ Upload CSV'}
              </button>

              <button
                type="button"
                className="btn btn-primary"
                onClick={() => { setEditingOrder(null); setIsAddOpen(true) }}
                style={{
                  backgroundColor: '#0f766e',
                  color: '#fff',
                  border: 'none',
                  padding: '6px 14px',
                  fontSize: '12px',
                  fontWeight: 600,
                }}
              >
                + Add Order
              </button>
            </>
          )}
        </div>
      </div>


      {/* ── CSV Upload result banner ── */}
      {csvResult && (
        <div
          style={{
            marginBottom: '10px',
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 500,
            backgroundColor: csvResult.type === 'success' ? '#f0fdf4' : csvResult.type === 'warning' ? '#fefce8' : '#fef2f2',
            border: `1px solid ${csvResult.type === 'success' ? '#bbf7d0' : csvResult.type === 'warning' ? '#fde68a' : '#fecaca'}`,
            color: csvResult.type === 'success' ? '#15803d' : csvResult.type === 'warning' ? '#92400e' : '#991b1b',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <span>
              {csvResult.type === 'success' && `✓ Imported ${csvResult.importedCount} order(s) successfully.`}
              {csvResult.type === 'warning' && `⚠ Imported ${csvResult.importedCount} order(s) with ${csvResult.errors.length} skipped row(s).`}
              {csvResult.type === 'error' && `✕ Import failed. ${csvResult.errors.length} error(s).`}
            </span>
            <button
              type="button"
              onClick={() => setCsvResult(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', lineHeight: 1, color: 'inherit', opacity: 0.6 }}
            >✕</button>
          </div>
          {csvResult.errors.length > 0 && (
            <ul style={{ margin: '6px 0 0 16px', padding: 0, fontSize: '11px', lineHeight: '1.6' }}>
              {csvResult.errors.slice(0, 10).map((err, i) => <li key={i}>{err}</li>)}
              {csvResult.errors.length > 10 && <li style={{ opacity: 0.7 }}>... and {csvResult.errors.length - 10} more</li>}
            </ul>
          )}
        </div>
      )}

      {/* Filter Bar */}
      <OrdersFilterBar
        filters={filters}
        onChange={(f) => setFilters(f)}
        salesmen={salesmen}
        cities={cities}
        onReset={() => setFilters({})}
      />

      {/* Orders Table */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '10px',
          border: '1px solid #e2e8f0',
          overflowX: 'auto',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <table className="dataTable" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
              <th style={{ padding: '8px 10px', width: '40px' }}>#</th>
              <th style={{ padding: '8px 10px' }}>Customer Details</th>
              <th style={{ padding: '8px 10px' }}>Order Date</th>
              <th style={{ padding: '8px 10px', textAlign: 'right' }}>Order Value</th>
              <th style={{ padding: '8px 10px' }}>Salesman</th>
              <th style={{ padding: '8px 10px' }}>Remarks</th>
              <th style={{ padding: '8px 10px', textAlign: 'center', width: '100px' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                  Loading customer orders...
                </td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                  No customer orders found matching current filters.
                </td>
              </tr>
            ) : (
              paginatedOrders.map((o, idx) => (
                <tr key={o.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '8px 10px', color: '#64748b', fontWeight: 500 }}>
                    {(currentPage - 1) * 20 + idx + 1}
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontWeight: 600, color: '#0f172a' }}>{o.customerName}</span>
                      {o.customerCategory && (
                        <span
                          style={{
                            padding: '1px 5px',
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
                      <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '1px' }}>
                        {o.customerMobile} {o.customerCity ? `• ${o.customerCity}` : ''}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', fontWeight: 500 }}>
                    {formatDDMMYYYY(o.orderDate)}
                  </td>
                  <td
                    style={{
                      padding: '8px 10px',
                      textAlign: 'right',
                      fontWeight: 700,
                      color: '#0f766e',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    ₹{(o.orderValue || 0).toLocaleString('en-IN')}
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    {o.salesmanName ? (
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '10px',
                          backgroundColor: '#e0f2fe',
                          color: '#0369a1',
                          fontSize: '11px',
                          fontWeight: 500,
                        }}
                      >
                        {o.salesmanName}
                      </span>
                    ) : (
                      <span style={{ color: '#94a3b8' }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '8px 10px', color: '#475569', maxWidth: '180px', fontSize: '11px' }}>
                    {o.remark || '—'}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                    <button
                      type="button"
                      onClick={() => setSelectedOrder(o)}
                      style={{
                        padding: '5px 12px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        backgroundColor: '#fff',
                        color: '#334155',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      👁 View
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '16px',
            padding: '10px 0',
          }}
        >
          <span style={{ fontSize: '14px', color: '#64748b' }}>
            Showing page {currentPage} of {totalPages} ({orders.length} total orders)
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                backgroundColor: currentPage === 1 ? '#f1f5f9' : '#fff',
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
                padding: '6px 14px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                backgroundColor: currentPage === totalPages ? '#f1f5f9' : '#fff',
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
        onOrderSaved={() => { loadData(); onDataChanged() }}
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
}
