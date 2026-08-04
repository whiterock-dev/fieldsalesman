/*
 * Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
 * © 2026 WhiteRock (Royal Enterprise). All rights reserved.
 *
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

import type { CustomerOrder } from './types'
import { formatDDMMYYYY } from './ordersApi'

export interface OrderDetailsDialogProps {
  order: CustomerOrder | null
  isOpen: boolean
  onClose: () => void
  customerName?: string
}

function daysSinceDate(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return null
  d.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.abs(today.getTime() - d.getTime())
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

export function daysSinceLabel(dateStr: string | null | undefined): string {
  const d = daysSinceDate(dateStr)
  if (d === null || d === undefined || Number.isNaN(d)) return '—'
  if (d === 0) return 'Today'
  if (d === 1) return '1 Day'
  return `${d} Days`
}

export function OrderDetailsDialog({
  order,
  isOpen,
  onClose,
  customerName,
}: OrderDetailsDialogProps) {
  if (!isOpen || !order) return null

  return (
    <div
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
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          width: '94%',
          maxWidth: '680px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.04)',
          overflow: 'hidden',
          fontFamily: "'Inter', 'Segoe UI', sans-serif",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 24px',
            borderBottom: '1px solid #e2e8f0',
            backgroundColor: '#f8fafc',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>
              Order Details
            </span>
            <span
              style={{
                fontSize: '13px',
                fontWeight: 600,
                color: '#475569',
                backgroundColor: '#e2e8f0',
                padding: '3px 10px',
                borderRadius: '6px',
              }}
            >
              {order.orderNumber || `ORD-${order.id.slice(0, 8)}`}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <span
              style={{
                backgroundColor: '#dcfce7',
                color: '#166534',
                fontSize: '14px',
                fontWeight: 700,
                padding: '4px 12px',
                borderRadius: '16px',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              ₹{Number(order.orderValue || 0).toLocaleString('en-IN')}
            </span>
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
        </div>

        {/* Content */}
        <div
          style={{
            padding: '24px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
          }}
        >
          {/* Metadata Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '16px',
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '18px 20px',
              fontSize: '13px',
            }}
          >
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
                Customer Name
              </span>
              <span style={{ fontWeight: 600, color: '#0f172a', fontSize: '14px' }}>
                {customerName || '—'}
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
                Order Date
              </span>
              <span style={{ fontWeight: 600, color: '#0f172a', fontSize: '14px' }}>
                {formatDDMMYYYY(order.orderDate)}
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
                Order #
              </span>
              <span style={{ fontWeight: 500, color: '#334155', fontSize: '14px' }}>
                {order.orderNumber || '—'}
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
                Closed By (Salesman)
              </span>
              <span style={{ fontWeight: 500, color: '#334155', fontSize: '14px' }}>
                {order.salesmanName || '—'}
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
                Days Since Order
              </span>
              <span
                style={{
                  display: 'inline-block',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  backgroundColor: '#e2e8f0',
                  color: '#334155',
                  fontWeight: 600,
                  fontSize: '12px',
                }}
              >
                {daysSinceLabel(order.orderDate)}
              </span>
            </div>
          </div>

          {/* Product Line Items */}
          <div>
            <h4
              style={{
                fontSize: '12px',
                fontWeight: 700,
                color: '#64748b',
                marginBottom: '10px',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Products & Line Items
            </h4>
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
                      color: '#64748b',
                      fontWeight: 600,
                      borderBottom: '1px solid #e2e8f0',
                    }}
                  >
                    <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px' }}>Product</th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', width: '140px', fontSize: '12px' }}>
                      Selling Rate
                    </th>
                    <th style={{ padding: '12px 16px', textAlign: 'right', width: '140px', fontSize: '12px' }}>
                      Order Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {order.products && order.products.length > 0 ? (
                    order.products.map((p, idx) => (
                      <tr
                        key={idx}
                        style={{
                          borderBottom: idx < order.products.length - 1 ? '1px solid #f1f5f9' : 'none',
                        }}
                      >
                        <td style={{ padding: '14px 16px', fontWeight: 600, color: '#0f172a' }}>
                          {p.productName}
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'right', color: '#64748b', whiteSpace: 'nowrap' }}>
                          {p.sellingRate ? `₹${Number(p.sellingRate).toLocaleString('en-IN')}` : '—'}
                        </td>
                        <td
                          style={{
                            padding: '14px 16px',
                            textAlign: 'right',
                            fontWeight: 700,
                            color: '#166534',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          ₹{(p.orderValue || 0).toLocaleString('en-IN')}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
                        No individual line items recorded.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Remarks */}
          {order.remark && (
            <div>
              <h4
                style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  color: '#64748b',
                  marginBottom: '8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Remarks / Notes
              </h4>
              <p
                style={{
                  fontSize: '13px',
                  color: '#334155',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '14px 16px',
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  lineHeight: '1.5',
                }}
              >
                {order.remark}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
