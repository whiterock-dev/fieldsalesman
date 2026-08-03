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
      <div className="modalOverlay" role="dialog" aria-modal="true" onClick={onClose}>
        <div
          className="modalCard"
          style={{ maxWidth: '840px', width: '96%', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="modalHeader" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ margin: 0 }}>Order History — {customerName}</h2>
              <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
                View past purchase orders, lifetime spend, and add new orders.
              </p>
            </div>
            <button type="button" className="closeBtn" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>

          {/* Summary & Add Order bar */}
          <div
            style={{
              padding: '12px 20px',
              backgroundColor: '#f8fafc',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '20px',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', gap: '24px' }}>
              <div>
                <span style={{ fontSize: '12px', color: '#64748b', display: 'block', textTransform: 'uppercase' }}>
                  Total Orders
                </span>
                <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#0f172a' }}>
                  {filteredOrders.length}
                </span>
              </div>
              <div>
                <span style={{ fontSize: '12px', color: '#64748b', display: 'block', textTransform: 'uppercase' }}>
                  Purchase Value
                </span>
                <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#0f766e' }}>
                  ₹{totalValue.toLocaleString('en-IN')}
                </span>
              </div>
              <div>
                <span style={{ fontSize: '12px', color: '#64748b', display: 'block', textTransform: 'uppercase' }}>
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
                  backgroundColor: '#0f766e',
                  color: '#fff',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                + Add Order
              </button>
            )}
          </div>

          {/* Reference UI Date Filter Bar */}
          <div
            style={{
              padding: '12px 20px',
              borderBottom: '1px solid #e2e8f0',
              backgroundColor: '#fff',
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
                  padding: '5px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  border: '1px solid',
                  borderColor: dateFilter === 'all' ? '#0f766e' : '#cbd5e1',
                  backgroundColor: dateFilter === 'all' ? '#0f766e' : '#fff',
                  color: dateFilter === 'all' ? '#fff' : '#334155',
                  cursor: 'pointer',
                }}
              >
                All Time
              </button>
              <button
                type="button"
                onClick={() => setDateFilter('7days')}
                style={{
                  padding: '5px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  border: '1px solid',
                  borderColor: dateFilter === '7days' ? '#0f766e' : '#cbd5e1',
                  backgroundColor: dateFilter === '7days' ? '#0f766e' : '#fff',
                  color: dateFilter === '7days' ? '#fff' : '#334155',
                  cursor: 'pointer',
                }}
              >
                Last 7 Days
              </button>
              <button
                type="button"
                onClick={() => setDateFilter('30days')}
                style={{
                  padding: '5px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  border: '1px solid',
                  borderColor: dateFilter === '30days' ? '#0f766e' : '#cbd5e1',
                  backgroundColor: dateFilter === '30days' ? '#0f766e' : '#fff',
                  color: dateFilter === '30days' ? '#fff' : '#334155',
                  cursor: 'pointer',
                }}
              >
                Last 30 Days
              </button>
              <button
                type="button"
                onClick={() => setDateFilter('custom')}
                style={{
                  padding: '5px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  border: '1px solid',
                  borderColor: dateFilter === 'custom' ? '#0f766e' : '#cbd5e1',
                  backgroundColor: dateFilter === 'custom' ? '#0f766e' : '#fff',
                  color: dateFilter === 'custom' ? '#fff' : '#334155',
                  cursor: 'pointer',
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
                <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>From:</span>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '12px',
                  }}
                />
                <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 500 }}>To:</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '12px',
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
                      color: '#64748b',
                      fontSize: '12px',
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
          <div className="modalBody" style={{ overflowY: 'auto', padding: '16px 20px', flex: 1 }}>
            {isLoading ? (
              <p style={{ textAlign: 'center', padding: '30px', color: '#64748b' }}>
                Loading purchase history...
              </p>
            ) : filteredOrders.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b' }}>
                <p style={{ fontSize: '15px', fontWeight: 500 }}>
                  {orders.length === 0
                    ? 'No purchase history found for this customer.'
                    : 'No orders found in the selected date range.'}
                </p>
              </div>
            ) : (
              <table className="dataTable" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f1f5f9', textAlign: 'left', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '10px 14px', width: '120px' }}>Order Date</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right', width: '140px' }}>Order Value</th>
                    <th style={{ padding: '10px 14px', width: '150px' }}>Closed By</th>
                    <th style={{ padding: '10px 14px', textAlign: 'center', width: '140px' }}>Days Since Order</th>
                    <th style={{ padding: '10px 14px', textAlign: 'center', width: '100px' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((o) => (
                    <tr key={o.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '12px 14px', fontWeight: 600, whiteSpace: 'nowrap', color: '#0f172a' }}>
                        {formatDDMMYYYY(o.orderDate)}
                      </td>
                      <td
                        style={{
                          padding: '12px 14px',
                          textAlign: 'right',
                          fontWeight: 'bold',
                          color: '#0f766e',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        ₹{(o.orderValue || 0).toLocaleString('en-IN')}
                      </td>
                      <td style={{ padding: '12px 14px', color: '#334155' }}>
                        {o.salesmanName || '—'}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
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
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
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
                  ))}
                </tbody>
              </table>
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
