/*
 * Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
 * © 2026 WhiteRock (Royal Enterprise). All rights reserved.
 *
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import type { CustomerOrder } from './types'
import { getCustomerOrders, formatDDMMYYYY } from './ordersApi'
import { AddOrderDialog } from './AddOrderDialog'
import { OrderDetailsDialog, daysSinceLabel } from './OrderDetailsDialog'
import type { Role } from '../../lib/roles'

export interface OrderHistoryDialogProps {
  isOpen: boolean
  onClose: () => void
  customerId: string | null
  customerName: string
  role: Role
  customers: Array<{
    id: string
    name: string
    phone: string
    city: string
    assignedSalesmanId: string
  }>
  salesmen: Array<{ id: string; name: string }>
  currentUserId: string
  productMasterList: string[]
  onDataChanged: () => void
}

export function OrderHistoryDialog({
  isOpen,
  onClose,
  customerId,
  customerName,
  role,
  customers,
  salesmen,
  currentUserId,
  productMasterList,
  onDataChanged,
}: OrderHistoryDialogProps) {
  const [orders, setOrders] = useState<CustomerOrder[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<CustomerOrder | null>(null)

  // Reference UI date filter states
  const [dateFilter, setDateFilter] = useState<'all' | '7days' | '30days' | 'custom'>('all')
  const [customFrom, setCustomFrom] = useState<string>('')
  const [customTo, setCustomTo] = useState<string>('')

  const loadOrders = useCallback(async () => {
    if (!customerId) return
    setIsLoading(true)
    try {
      const list = await getCustomerOrders(customerId)
      setOrders(list)
    } catch (err) {
      console.warn('Error loading order history:', err)
    } finally {
      setIsLoading(false)
    }
  }, [customerId])

  useEffect(() => {
    if (isOpen && customerId) {
      loadOrders()
    } else {
      setOrders([])
      setSelectedOrder(null)
      setDateFilter('all')
      setCustomFrom('')
      setCustomTo('')
    }
  }, [isOpen, customerId, loadOrders])

  const filteredOrders = useMemo(() => {
    let list = [...orders]
    const now = new Date()
    now.setHours(23, 59, 59, 999)
    if (dateFilter === '7days') {
      const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      list = list.filter((o) => new Date(o.orderDate) >= from)
    } else if (dateFilter === '30days') {
      const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      list = list.filter((o) => new Date(o.orderDate) >= from)
    } else if (dateFilter === 'custom') {
      if (customFrom) {
        list = list.filter((o) => o.orderDate >= customFrom)
      }
      if (customTo) {
        list = list.filter((o) => o.orderDate <= customTo)
      }
    }
    return list
  }, [orders, dateFilter, customFrom, customTo])

  const totalValue = useMemo(() => {
    return filteredOrders.reduce((sum, o) => sum + (o.orderValue || 0), 0)
  }, [filteredOrders])

  const lastDate = useMemo(() => {
    if (!filteredOrders.length) return null
    return filteredOrders[0].orderDate // orders are sorted desc by date
  }, [filteredOrders])

  const isReadOnly = role === 'salesman'

  if (!isOpen || !customerId) return null

  return (
    <>
      <div
        className="modalOverlay"
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
          className="modalCard"
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '16px',
            maxWidth: '800px',
            width: '94%',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.04)',
            overflow: 'hidden',
            fontFamily: "'Inter', 'Segoe UI', sans-serif",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '18px 24px',
              borderBottom: '1px solid #e2e8f0',
              backgroundColor: '#f8fafc',
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                Order History — {customerName}
              </h2>
              <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
                View past purchase orders, lifetime spend, and add new orders.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                background: 'none',
                border: 'none',
                fontSize: '20px',
                color: '#64748b',
                cursor: 'pointer',
                lineHeight: 1,
                padding: '4px',
              }}
            >
              ✕
            </button>
          </div>

          {/* Summary & Add Order bar */}
          <div
            style={{
              padding: '16px 24px',
              backgroundColor: '#ffffff',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '20px',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', gap: '28px', flexWrap: 'wrap' }}>
              <div>
                <span
                  style={{
                    fontSize: '11px',
                    color: '#64748b',
                    display: 'block',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    marginBottom: '4px',
                  }}
                >
                  Total Orders
                </span>
                <span style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>
                  {filteredOrders.length}
                </span>
              </div>
              <div>
                <span
                  style={{
                    fontSize: '11px',
                    color: '#64748b',
                    display: 'block',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    marginBottom: '4px',
                  }}
                >
                  Purchase Value
                </span>
                <span style={{ fontSize: '20px', fontWeight: 700, color: '#166534' }}>
                  ₹{totalValue.toLocaleString('en-IN')}
                </span>
              </div>
              <div>
                <span
                  style={{
                    fontSize: '11px',
                    color: '#64748b',
                    display: 'block',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    marginBottom: '4px',
                  }}
                >
                  Last Purchase
                </span>
                <span style={{ fontSize: '15px', fontWeight: 600, color: '#334155' }}>
                  {formatDDMMYYYY(lastDate)}
                </span>
              </div>
            </div>

            {!isReadOnly && (
              <button
                type="button"
                onClick={() => {
                  setIsAddOpen(true)
                }}
                style={{
                  height: '38px',
                  padding: '0 16px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: '#0f172a',
                  color: '#ffffff',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                }}
              >
                + Add Order
              </button>
            )}
          </div>

          {/* Reference UI Date Filter Bar */}
          <div
            style={{
              padding: '14px 24px',
              borderBottom: '1px solid #e2e8f0',
              backgroundColor: '#f8fafc',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginRight: '4px' }}>
                Filter by Date:
              </span>
              <button
                type="button"
                onClick={() => setDateFilter('all')}
                style={{
                  height: '34px',
                  padding: '0 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  border: '1px solid',
                  borderColor: dateFilter === 'all' ? '#0f172a' : '#cbd5e1',
                  backgroundColor: dateFilter === 'all' ? '#0f172a' : '#ffffff',
                  color: dateFilter === 'all' ? '#fff' : '#334155',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                All Time
              </button>
              <button
                type="button"
                onClick={() => setDateFilter('7days')}
                style={{
                  height: '34px',
                  padding: '0 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  border: '1px solid',
                  borderColor: dateFilter === '7days' ? '#0f172a' : '#cbd5e1',
                  backgroundColor: dateFilter === '7days' ? '#0f172a' : '#ffffff',
                  color: dateFilter === '7days' ? '#fff' : '#334155',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                Last 7 Days
              </button>
              <button
                type="button"
                onClick={() => setDateFilter('30days')}
                style={{
                  height: '34px',
                  padding: '0 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  border: '1px solid',
                  borderColor: dateFilter === '30days' ? '#0f172a' : '#cbd5e1',
                  backgroundColor: dateFilter === '30days' ? '#0f172a' : '#ffffff',
                  color: dateFilter === '30days' ? '#fff' : '#334155',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                Last 30 Days
              </button>
              <button
                type="button"
                onClick={() => setDateFilter('custom')}
                style={{
                  height: '34px',
                  padding: '0 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  border: '1px solid',
                  borderColor: dateFilter === 'custom' ? '#0f172a' : '#cbd5e1',
                  backgroundColor: dateFilter === 'custom' ? '#0f172a' : '#ffffff',
                  color: dateFilter === 'custom' ? '#fff' : '#334155',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                Custom Range
              </button>

              {dateFilter !== 'all' && (
                <span style={{ fontSize: '12px', color: '#64748b', marginLeft: 'auto' }}>
                  Showing <strong>{filteredOrders.length}</strong> of <strong>{orders.length}</strong> orders
                </span>
              )}
            </div>

            {dateFilter === 'custom' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingTop: '4px' }}>
                <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>From:</span>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  style={{
                    height: '34px',
                    padding: '0 10px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    color: '#1e293b',
                  }}
                />
                <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>To:</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  style={{
                    height: '34px',
                    padding: '0 10px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '13px',
                    color: '#1e293b',
                  }}
                />
                {(customFrom || customTo) && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomFrom('')
                      setCustomTo('')
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#2563eb',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                  >
                    Clear Dates
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Modal Body / Table matching Reference UI */}
          <div style={{ overflowY: 'auto', padding: '20px 24px', flex: 1 }}>
            {isLoading ? (
              <p style={{ textAlign: 'center', padding: '36px', color: '#64748b', fontSize: '14px' }}>
                Loading purchase history...
              </p>
            ) : filteredOrders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px 20px', color: '#64748b' }}>
                <p style={{ fontSize: '14px', fontWeight: 500, margin: 0 }}>
                  {orders.length === 0
                    ? 'No purchase history found for this customer.'
                    : 'No orders found in the selected date range.'}
                </p>
              </div>
            ) : (
              <div
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  overflow: 'hidden',
                  backgroundColor: '#ffffff',
                }}
              >
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr
                      style={{
                        backgroundColor: '#f8fafc',
                        textAlign: 'left',
                        borderBottom: '1px solid #e2e8f0',
                        color: '#64748b',
                        fontWeight: 600,
                        fontSize: '12px',
                      }}
                    >
                      <th style={{ padding: '12px 16px', width: '130px' }}>Order Date</th>
                      <th style={{ padding: '12px 16px', textAlign: 'right', width: '140px' }}>Order Value</th>
                      <th style={{ padding: '12px 16px', width: '160px' }}>Closed By</th>
                      <th style={{ padding: '12px 16px', textAlign: 'center', width: '140px' }}>
                        Days Since Order
                      </th>
                      <th style={{ padding: '12px 16px', textAlign: 'center', width: '100px' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.map((o, idx) => (
                      <tr
                        key={o.id}
                        style={{
                          borderBottom: idx < filteredOrders.length - 1 ? '1px solid #f1f5f9' : 'none',
                        }}
                      >
                        <td style={{ padding: '14px 16px', fontWeight: 600, whiteSpace: 'nowrap', color: '#0f172a' }}>
                          {formatDDMMYYYY(o.orderDate)}
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
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
                        <td style={{ padding: '14px 16px', color: '#334155' }}>
                          {o.salesmanName || '—'}
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                          <span
                            style={{
                              padding: '3px 10px',
                              borderRadius: '12px',
                              backgroundColor: '#f1f5f9',
                              color: '#475569',
                              fontSize: '12px',
                              fontWeight: 600,
                              display: 'inline-block',
                            }}
                          >
                            {daysSinceLabel(o.orderDate)}
                          </span>
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={() => setSelectedOrder(o)}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '5px 12px',
                              borderRadius: '6px',
                              border: '1px solid #e2e8f0',
                              backgroundColor: '#ffffff',
                              color: '#334155',
                              fontSize: '12px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            👁 View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      <AddOrderDialog
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        onOrderSaved={() => {
          loadOrders()
          onDataChanged()
        }}
        customers={customers}
        salesmen={salesmen}
        currentUserId={currentUserId}
        preselectedCustomerId={customerId}
        productMasterList={productMasterList}
      />

      <OrderDetailsDialog
        order={selectedOrder}
        isOpen={!!selectedOrder}
        onClose={() => setSelectedOrder(null)}
        customerName={customerName}
      />
    </>
  )
}
