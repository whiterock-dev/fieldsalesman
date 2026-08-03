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

const FS = '12px'     // base font size
const INPUT_STYLE: React.CSSProperties = {
  fontSize: FS,
  padding: '6px 8px',
  borderRadius: '5px',
  border: '1px solid #cbd5e1',
  background: '#fff',
  color: '#0f172a',
  width: '100%',
  boxSizing: 'border-box',
}
const LABEL_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '3px',
  fontSize: FS,
  fontWeight: 600,
  color: '#475569',
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
    setSelectedCustomerId('')  // clear selection when user types again
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
    if (!selectedCustomerId) { setErrorMsg('Please select a customer.'); return }
    if (!orderDate) { setErrorMsg('Please select an order date.'); return }
    if (totalOrderValue <= 0) { setErrorMsg('Total order value must be greater than 0.'); return }

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
      style={{ alignItems: 'center' }}
    >
      <div
        className="modalCard"
        style={{ maxWidth: '860px', width: '96vw', maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modalHeader">
          <h2 style={{ fontSize: '15px', margin: 0 }}>
            {orderToEdit ? 'Edit Order' : '+ New Order'}
          </h2>
          <button type="button" className="closeBtn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Body */}
        <form
          onSubmit={handleSubmit}
          style={{ padding: '16px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}
        >
          {errorMsg && (
            <div style={{ backgroundColor: '#fee2e2', color: '#991b1b', padding: '7px 10px', borderRadius: '5px', fontSize: FS }}>
              {errorMsg}
            </div>
          )}

          {/* Row 1: Customer search + Date + PO */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px', alignItems: 'start' }}>

            {/* Customer searchable combobox */}
            <label style={LABEL_STYLE}>
              Customer *
              <div style={{ position: 'relative' }}>
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="Search by name or mobile number..."
                  value={customerSearch}
                  autoComplete="off"
                  onChange={(e) => handleCustomerSearchChange(e.target.value)}
                  onFocus={() => !selectedCustomerId && setShowDropdown(true)}
                  style={{
                    ...INPUT_STYLE,
                    paddingRight: selectedCustomerId ? '28px' : '8px',
                    borderColor: selectedCustomerId ? '#0f766e' : '#cbd5e1',
                    backgroundColor: selectedCustomerId ? '#f0fdf4' : '#fff',
                  }}
                />
                {selectedCustomerId && (
                  <button
                    type="button"
                    onClick={() => { setSelectedCustomerId(''); setCustomerSearch(''); setShowDropdown(true); searchRef.current?.focus() }}
                    style={{ position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '13px', lineHeight: 1 }}
                    title="Clear customer"
                  >✕</button>
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
                      borderRadius: '6px',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                      maxHeight: '220px',
                      overflowY: 'auto',
                      marginTop: '2px',
                    }}
                  >
                    {filteredCustomers.length === 0 ? (
                      <div style={{ padding: '10px 12px', fontSize: FS, color: '#94a3b8' }}>No customers found</div>
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
                            padding: '8px 12px',
                            border: 'none',
                            background: 'none',
                            cursor: 'pointer',
                            borderBottom: '1px solid #f1f5f9',
                            fontSize: FS,
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                        >
                          <span style={{ fontWeight: 600, color: '#0f172a' }}>{c.name}</span>
                          <span style={{ color: '#64748b', marginLeft: '6px' }}>{c.city}</span>
                          <span style={{ color: '#94a3b8', marginLeft: '6px', fontFamily: 'monospace' }}>{c.phone}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              {/* Show selected customer chip */}
              {selectedCustomer && (
                <span style={{ fontSize: '11px', color: '#0f766e', fontWeight: 500, marginTop: '2px' }}>
                  ✓ {selectedCustomer.city} · {selectedCustomer.phone}
                </span>
              )}
            </label>

            <label style={LABEL_STYLE}>
              Order Date *
              <input
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
                required
                style={INPUT_STYLE}
              />
            </label>

            <label style={LABEL_STYLE}>
              PO / Invoice #
              <input
                type="text"
                placeholder="e.g. PO-2026-001"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                style={INPUT_STYLE}
              />
            </label>
          </div>

          {/* Row 2: Salesman */}
          <label style={{ ...LABEL_STYLE, maxWidth: '300px' }}>
            Salesman
            <select
              value={selectedSalesmanId}
              onChange={(e) => setSelectedSalesmanId(e.target.value)}
              style={INPUT_STYLE}
            >
              <option value="">— None / Unassigned —</option>
              {salesmen.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>

          {/* Products section */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: FS, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Products / Line Items *
              </span>
              <button
                type="button"
                onClick={addLineItem}
                style={{ padding: '4px 10px', backgroundColor: '#0f766e', color: '#fff', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}
              >
                + Add Item
              </button>
            </div>

            {/* Column headers */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '2.5fr 1fr 1fr 28px',
                gap: '6px',
                padding: '4px 8px',
                fontSize: '10px',
                fontWeight: 700,
                color: '#94a3b8',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              <span>Product</span>
              <span>Rate (₹)</span>
              <span>Order Value (₹)</span>
              <span />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {lineItems.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2.5fr 1fr 1fr 28px',
                    gap: '6px',
                    alignItems: 'center',
                    backgroundColor: '#f8fafc',
                    padding: '7px 8px',
                    borderRadius: '6px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <select
                    value={item.productName}
                    onChange={(e) => handleLineItemChange(idx, 'productName', e.target.value)}
                    style={{ ...INPUT_STYLE, backgroundColor: '#fff' }}
                  >
                    {productMasterList.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>

                  <input
                    type="number"
                    placeholder="Rate"
                    min="0"
                    step="any"
                    value={item.sellingRate}
                    onChange={(e) => handleLineItemChange(idx, 'sellingRate', e.target.value)}
                    style={INPUT_STYLE}
                  />

                  <input
                    type="number"
                    placeholder="Order Value"
                    min="0"
                    value={item.orderValue}
                    onChange={(e) => handleLineItemChange(idx, 'orderValue', e.target.value)}
                    style={{ ...INPUT_STYLE, fontWeight: 700, color: '#0f766e' }}
                  />

                  {lineItems.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => removeLineItem(idx)}
                      style={{ background: 'none', border: 'none', color: '#ef4444', fontWeight: 700, cursor: 'pointer', fontSize: '14px', lineHeight: 1, padding: 0 }}
                      title="Remove"
                    >✕</button>
                  ) : <span />}
                </div>
              ))}
            </div>

            {/* Total */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', marginTop: '8px', padding: '6px 10px', backgroundColor: '#f1f5f9', borderRadius: '6px' }}>
              <span style={{ fontSize: FS, color: '#475569' }}>Total Order Value:</span>
              <span style={{ fontSize: '15px', fontWeight: 700, color: '#0f766e' }}>
                ₹{totalOrderValue.toLocaleString('en-IN')}
              </span>
            </div>
          </div>

          {/* Remarks */}
          <label style={LABEL_STYLE}>
            Remarks / Notes
            <textarea
              rows={2}
              placeholder="Any special remarks or delivery instructions..."
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              style={{ ...INPUT_STYLE, resize: 'vertical' }}
            />
          </label>

          {/* Footer buttons */}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', paddingTop: '4px' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isSubmitting} style={{ fontSize: FS }}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{ backgroundColor: '#0f766e', color: '#fff', padding: '6px 18px', borderRadius: '5px', border: 'none', fontWeight: 600, fontSize: FS, cursor: 'pointer' }}
            >
              {isSubmitting ? 'Saving…' : 'Save Order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
