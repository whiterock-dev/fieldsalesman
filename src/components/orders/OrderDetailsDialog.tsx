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
          backgroundColor: '#fff',
          borderRadius: '12px',
          width: '96%',
          maxWidth: '860px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
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
            padding: '16px 20px',
            borderBottom: '1px solid #e2e8f0',
            backgroundColor: '#f8fafc',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
              Order Details
            </span>
            <span
              style={{
                fontSize: '13px',
                fontWeight: 600,
                color: '#64748b',
                backgroundColor: '#e2e8f0',
                padding: '2px 8px',
                borderRadius: '6px',
              }}
            >
              {order.orderNumber || `ORD-${order.id.slice(0, 8)}`}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span
              style={{
                backgroundColor: '#0f766e',
                color: '#fff',
                fontSize: '15px',
                fontWeight: 700,
                padding: '4px 12px',
                borderRadius: '8px',
              }}
            >
              ₹{Number(order.orderValue || 0).toLocaleString('en-IN')}
            </span>
            <button
              type="button"
              onClick={onClose}
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
        <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* Metadata Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '12px',
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '14px',
              fontSize: '13px',
            }}
          >
            <div>
              <span style={{ fontSize: '11px', color: '#64748b', display: 'block', fontWeight: 600, textTransform: 'uppercase' }}>
                Customer Name
              </span>
              <span style={{ fontWeight: 600, color: '#0f172a', fontSize: '14px' }}>
                {customerName || '—'}
              </span>
            </div>

            <div>
              <span style={{ fontSize: '11px', color: '#64748b', display: 'block', fontWeight: 600, textTransform: 'uppercase' }}>
                Order Date
              </span>
              <span style={{ fontWeight: 600, color: '#0f172a', fontSize: '14px' }}>
                {formatDDMMYYYY(order.orderDate)}
              </span>
            </div>

            <div>
              <span style={{ fontSize: '11px', color: '#64748b', display: 'block', fontWeight: 600, textTransform: 'uppercase' }}>
                Order #
              </span>
              <span style={{ fontWeight: 500, color: '#334155' }}>
                {order.orderNumber || '—'}
              </span>
            </div>

            <div>
              <span style={{ fontSize: '11px', color: '#64748b', display: 'block', fontWeight: 600, textTransform: 'uppercase' }}>
                Closed By (Salesman)
              </span>
              <span style={{ fontWeight: 500, color: '#334155' }}>
                {order.salesmanName || '—'}
              </span>
            </div>

            <div>
              <span style={{ fontSize: '11px', color: '#64748b', display: 'block', fontWeight: 600, textTransform: 'uppercase' }}>
                Days Since Order
              </span>
              <span style={{ fontWeight: 600, color: '#0f766e' }}>
                {daysSinceLabel(order.orderDate)}
              </span>
            </div>
          </div>

          {/* Product Line Items */}
          <div>
            <h4
              style={{
                fontSize: '13px',
                fontWeight: 700,
                color: '#0f172a',
                marginBottom: '8px',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Products & Line Items
            </h4>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f1f5f9', color: '#475569', fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left' }}>Product</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', width: '130px' }}>Selling Rate</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', width: '140px' }}>Order Value</th>
                  </tr>
                </thead>
                <tbody>
                  {order.products && order.products.length > 0 ? (
                    order.products.map((p, idx) => (
                      <tr key={idx} style={{ borderBottom: idx < order.products.length - 1 ? '1px solid #e2e8f0' : 'none' }}>
                        <td style={{ padding: '8px 10px', fontWeight: 600, color: '#0f172a' }}>
                          {p.productName}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#64748b', whiteSpace: 'nowrap' }}>
                          {p.sellingRate ? `₹${Number(p.sellingRate).toLocaleString('en-IN')}` : '—'}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: '#0f766e', whiteSpace: 'nowrap' }}>
                          ₹{(p.orderValue || 0).toLocaleString('en-IN')}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} style={{ padding: '20px', textAlign: 'center', color: '#94a3b8' }}>
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
              <h4 style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginBottom: '6px' }}>
                Remarks
              </h4>
              <p
                style={{
                  fontSize: '13px',
                  color: '#475569',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  padding: '12px',
                  margin: 0,
                  whiteSpace: 'pre-wrap',
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
