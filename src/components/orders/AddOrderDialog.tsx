/*
 * Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
 * © 2026 WhiteRock (Royal Enterprise). All rights reserved.
 *
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react'
import type { OrderProduct, CustomerOrder } from './types'
import { addCustomerOrder } from './ordersApi'

export interface AddOrderDialogProps {
  isOpen: boolean
  onClose: () => void
  onOrderSaved: () => void
  customers: Array<{
    id: string
    name: string
    phone: string
    city: string
    assignedSalesmanId: string
  }>
  salesmen: Array<{ id: string; name: string }>
  currentUserId: string
  preselectedCustomerId?: string
  productMasterList: string[]
  orderToEdit?: CustomerOrder | null
}

interface LineItemForm {
  productName: string
  sellingRate: string
  orderValue: string
}

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

export function AddOrderDialog({
  isOpen,
  onClose,
  onOrderSaved,
  customers,
  salesmen,
  currentUserId,
  preselectedCustomerId,
  productMasterList,
  orderToEdit,
}: AddOrderDialogProps) {
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('')
  const [customerSearch, setCustomerSearch] = useState<string>('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [orderNumber, setOrderNumber] = useState<string>('')
  const [orderDate, setOrderDate] = useState<string>(() => new Date().toISOString().split('T')[0])
  const [selectedSalesmanId, setSelectedSalesmanId] = useState<string>('')
  const [remark, setRemark] = useState<string>('')
  const [lineItems, setLineItems] = useState<LineItemForm[]>([
    { productName: productMasterList[0] || 'Gypsum Tile', sellingRate: '', orderValue: '' },
  ])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        searchRef.current &&
        !searchRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (!isOpen) return
    setErrorMsg('')
    setIsSubmitting(false)
    setShowDropdown(false)

    if (orderToEdit) {
      setSelectedCustomerId(orderToEdit.customerId)
      const cust = customers.find((c) => c.id === orderToEdit.customerId)
      if (cust) setCustomerSearch(`${cust.name} — ${cust.city} · ${cust.phone}`)
      setOrderNumber(orderToEdit.orderNumber || '')
      setOrderDate(orderToEdit.orderDate)
      setSelectedSalesmanId(orderToEdit.salesmanId || '')
      setRemark(orderToEdit.remark || '')
      setLineItems(
        orderToEdit.products.map((p) => ({
          productName: p.productName,
          sellingRate: p.sellingRate ? String(p.sellingRate) : '',
          orderValue: String(p.orderValue || 0),
        }))
      )
    } else {
      if (preselectedCustomerId) {
        setSelectedCustomerId(preselectedCustomerId)
        const cust = customers.find((c) => c.id === preselectedCustomerId)
        if (cust) {
          setCustomerSearch(`${cust.name} — ${cust.city} · ${cust.phone}`)
          if (cust.assignedSalesmanId) setSelectedSalesmanId(cust.assignedSalesmanId)
        }
      } else {
        setSelectedCustomerId('')
        setCustomerSearch('')
      }
      setOrderNumber('')
      setOrderDate(new Date().toISOString().split('T')[0])
      setRemark('')
      setSelectedSalesmanId('')
      setLineItems([{ productName: productMasterList[0] || 'Gypsum Tile', sellingRate: '', orderValue: '' }])
    }
  }, [isOpen, preselectedCustomerId, orderToEdit, customers, productMasterList])

  // Filtered customer suggestions
  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase()
    if (!q || selectedCustomerId) return customers.slice(0, 8)
    return customers
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.phone.includes(q) ||
          c.city.toLowerCase().includes(q)
      )
      .slice(0, 10)
  }, [customerSearch, customers, selectedCustomerId])

  const handleCustomerSelect = (custId: string) => {
    const cust = customers.find((c) => c.id === custId)
    setSelectedCustomerId(custId)
    if (cust) {
      setCustomerSearch(`${cust.name} — ${cust.city} · ${cust.phone}`)
      if (cust.assignedSalesmanId && !selectedSalesmanId) {
        setSelectedSalesmanId(cust.assignedSalesmanId)
      }
    }
    setShowDropdown(false)
  }

  const handleCustomerSearchChange = (val: string) => {
    setCustomerSearch(val)
    setSelectedCustomerId('') // clear selection when user types again
    setShowDropdown(true)
  }

  const handleLineItemChange = (idx: number, field: keyof LineItemForm, val: string) => {
    const next = [...lineItems]
    next[idx] = { ...next[idx], [field]: val }
    setLineItems(next)
  }

  const addLineItem = () => {
    setLineItems([...lineItems, { productName: productMasterList[0] || 'Gypsum Tile', sellingRate: '', orderValue: '' }])
  }

  const removeLineItem = (idx: number) => {
    if (lineItems.length === 1) return
    setLineItems(lineItems.filter((_, i) => i !== idx))
  }

  const totalOrderValue = useMemo(
    () => lineItems.reduce((acc, item) => acc + (parseFloat(item.orderValue) || 0), 0),
    [lineItems]
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg('')
    if (!selectedCustomerId) {
      setErrorMsg('Please select a customer.')
      return
    }
    if (!orderDate) {
      setErrorMsg('Please select an order date.')
      return
    }
    if (totalOrderValue <= 0) {
      setErrorMsg('Total order value must be greater than 0.')
      return
    }

    const salesman = salesmen.find((s) => s.id === selectedSalesmanId)
    const products: OrderProduct[] = lineItems.map((item) => ({
      productName: item.productName,
      sellingRate: parseFloat(item.sellingRate) || 0,
      orderValue: parseFloat(item.orderValue) || 0,
    }))

    setIsSubmitting(true)
    try {
      await addCustomerOrder({
        customerId: selectedCustomerId,
        orderNumber: orderNumber.trim() || null,
        orderDate,
        orderValue: totalOrderValue,
        products,
        salesmanId: salesman?.id || null,
        salesmanName: salesman?.name || null,
        remark: remark.trim() || null,
        createdBy: currentUserId,
      })
      onOrderSaved()
      onClose()
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save order.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId)

  return (
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
          width: '96%',
          maxWidth: '720px',
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
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 24px',
            borderBottom: '1px solid #e2e8f0',
            backgroundColor: '#f8fafc',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>
              {orderToEdit ? 'Edit Order' : '+ New Order'}
            </span>
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

        {/* Body */}
        <form
          onSubmit={handleSubmit}
          style={{
            padding: '24px',
            overflowY: 'auto',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
          }}
        >
          {errorMsg && (
            <div
              style={{
                backgroundColor: '#fef2f2',
                color: '#991b1b',
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid #fecaca',
                fontSize: '13px',
                fontWeight: 500,
              }}
            >
              {errorMsg}
            </div>
          )}

          {/* Customer Search Combobox (Full Width) */}
          <div>
            <label style={labelStyle}>Customer *</label>
            <div style={{ position: 'relative' }}>
              <input
                ref={searchRef}
                type="text"
                placeholder="Search by name, firm, or mobile number..."
                value={customerSearch}
                autoComplete="off"
                onChange={(e) => handleCustomerSearchChange(e.target.value)}
                onFocus={() => !selectedCustomerId && setShowDropdown(true)}
                style={{
                  ...inputStyle,
                  paddingRight: selectedCustomerId ? '32px' : '12px',
                  borderColor: selectedCustomerId ? '#10b981' : '#cbd5e1',
                  backgroundColor: selectedCustomerId ? '#f0fdf4' : '#ffffff',
                }}
              />
              {selectedCustomerId && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCustomerId('')
                    setCustomerSearch('')
                    setShowDropdown(true)
                    searchRef.current?.focus()
                  }}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#64748b',
                    fontSize: '14px',
                    lineHeight: 1,
                    padding: '4px',
                  }}
                  title="Clear customer"
                >
                  ✕
                </button>
              )}

              {/* Dropdown */}
              {showDropdown && !selectedCustomerId && (
                <div
                  ref={dropdownRef}
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    zIndex: 9999,
                    backgroundColor: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)',
                    maxHeight: '220px',
                    overflowY: 'auto',
                    marginTop: '4px',
                  }}
                >
                  {filteredCustomers.length === 0 ? (
                    <div style={{ padding: '12px 14px', fontSize: '13px', color: '#94a3b8' }}>
                      No customers found
                    </div>
                  ) : (
                    filteredCustomers.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={() => handleCustomerSelect(c.id)}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: '10px 14px',
                          border: 'none',
                          background: 'none',
                          cursor: 'pointer',
                          borderBottom: '1px solid #f1f5f9',
                          fontSize: '13px',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        <span style={{ fontWeight: 600, color: '#0f172a' }}>{c.name}</span>
                        <span style={{ color: '#64748b', marginLeft: '8px' }}>{c.city}</span>
                        <span
                          style={{
                            color: '#94a3b8',
                            marginLeft: '8px',
                            fontFamily: 'monospace',
                            fontSize: '12px',
                          }}
                        >
                          {c.phone}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {selectedCustomer && (
              <span style={{ fontSize: '12px', color: '#166534', fontWeight: 600, marginTop: '4px', display: 'block' }}>
                ✓ {selectedCustomer.city} · {selectedCustomer.phone}
              </span>
            )}
          </div>

          {/* 3-Column Grid: Date, PO #, Salesman */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
              gap: '16px',
            }}
          >
            <div>
              <label style={labelStyle}>Order Date *</label>
              <input
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
                required
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>PO / Invoice #</label>
              <input
                type="text"
                placeholder="e.g. PO-2026-001"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Salesman</label>
              <select
                value={selectedSalesmanId}
                onChange={(e) => setSelectedSalesmanId(e.target.value)}
                style={inputStyle}
              >
                <option value="">— Unassigned —</option>
                {salesmen.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Products / Line Items Section */}
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '10px',
              }}
            >
              <span
                style={{
                  fontSize: '13px',
                  fontWeight: 700,
                  color: '#0f172a',
                  letterSpacing: '0.01em',
                }}
              >
                Products & Line Items *
              </span>
              <button
                type="button"
                onClick={addLineItem}
                style={{
                  height: '34px',
                  padding: '0 14px',
                  backgroundColor: '#0f172a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  fontWeight: 600,
                  boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                }}
              >
                + Add Item
              </button>
            </div>

            {/* Column Headers */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '3fr 1.5fr 1.5fr 36px',
                gap: '12px',
                padding: '0 8px 6px',
                fontSize: '12px',
                fontWeight: 600,
                color: '#64748b',
              }}
            >
              <span>Product</span>
              <span>Rate (₹)</span>
              <span>Order Value (₹)</span>
              <span />
            </div>

            {/* Line Item Rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {lineItems.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '3fr 1.5fr 1.5fr 36px',
                    gap: '12px',
                    alignItems: 'center',
                    backgroundColor: '#f8fafc',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <select
                    value={item.productName}
                    onChange={(e) => handleLineItemChange(idx, 'productName', e.target.value)}
                    style={{ ...inputStyle, backgroundColor: '#fff' }}
                  >
                    {productMasterList.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    placeholder="Rate"
                    min="0"
                    step="any"
                    value={item.sellingRate}
                    onChange={(e) => handleLineItemChange(idx, 'sellingRate', e.target.value)}
                    style={inputStyle}
                  />

                  <input
                    type="number"
                    placeholder="Value"
                    min="0"
                    value={item.orderValue}
                    onChange={(e) => handleLineItemChange(idx, 'orderValue', e.target.value)}
                    style={{ ...inputStyle, fontWeight: 700, color: '#166534', backgroundColor: '#ffffff' }}
                  />

                  {lineItems.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => removeLineItem(idx)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#ef4444',
                        fontWeight: 700,
                        cursor: 'pointer',
                        fontSize: '16px',
                        lineHeight: 1,
                        padding: 0,
                        textAlign: 'center',
                      }}
                      title="Remove"
                    >
                      ✕
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              ))}
            </div>

            {/* Total Order Value Banner */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '12px',
                padding: '12px 18px',
                backgroundColor: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: '8px',
              }}
            >
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#166534' }}>
                Total Order Value
              </span>
              <span style={{ fontSize: '16px', fontWeight: 700, color: '#166534' }}>
                ₹{totalOrderValue.toLocaleString('en-IN')}
              </span>
            </div>
          </div>

          {/* Remarks */}
          <div>
            <label style={labelStyle}>Remarks / Notes</label>
            <textarea
              rows={3}
              placeholder="Any special remarks or delivery instructions..."
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                color: '#1e293b',
                fontSize: '13px',
                outline: 'none',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </form>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            gap: '10px',
            justifyContent: 'flex-end',
            padding: '16px 24px',
            backgroundColor: '#f8fafc',
            borderTop: '1px solid #e2e8f0',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            style={{
              height: '38px',
              padding: '0 16px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#ffffff',
              color: '#334155',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            onClick={handleSubmit}
            disabled={isSubmitting}
            style={{
              height: '38px',
              padding: '0 20px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: '#0f172a',
              color: '#ffffff',
              fontSize: '13px',
              fontWeight: 600,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
            }}
          >
            {isSubmitting ? 'Saving…' : 'Save Order'}
          </button>
        </div>
      </div>
    </div>
  )
}
