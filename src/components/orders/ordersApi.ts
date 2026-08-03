/*
 * Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
 * © 2026 WhiteRock (Royal Enterprise). All rights reserved.
 *
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

import { supabase, supabaseEnabled } from '../../lib/supabase'
import type { CustomerOrder, EnrichedCustomerOrder, CustomerOrderFilters, OrderProduct } from './types'

/** Format an ISO YYYY-MM-DD string into DD-MM-YYYY for UI display and CSV export */
export function formatDDMMYYYY(dateString: string | null | undefined): string {
  if (!dateString) return '—'
  const parts = dateString.split('-')
  if (parts.length === 3 && parts[0].length === 4) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`
  }
  return dateString
}

/** Parse a DD-MM-YYYY or DD/MM/YYYY (or YYYY-MM-DD) string into ISO YYYY-MM-DD */
export function parseDDMMYYYY(dateString: string | null | undefined): string | null {
  if (!dateString) return null
  const str = dateString.replace(/\//g, '-').trim()
  const parts = str.split('-')
  if (parts.length === 3) {
    if (parts[0].length === 4) return str // already YYYY-MM-DD
    const d = parts[0].padStart(2, '0')
    const m = parts[1].padStart(2, '0')
    const y = parts[2].length === 2 ? `20${parts[2]}` : parts[2]
    return `${y}-${m}-${d}`
  }
  return null
}

// In-memory demo store for offline/demo mode
const DEFAULT_PRODUCTS = ['Gypsum Tile', 'T-Grid', 'Soffit Panel', 'Fluted Panel']
let demoOrders: CustomerOrder[] = [
  {
    id: 'ord-1',
    customerId: 'c1',
    orderNumber: 'PO-1001',
    orderDate: '2026-07-28',
    orderValue: 125000,
    products: [
      { productName: 'Gypsum Tile', sellingRate: 50, orderValue: 75000 },
      { productName: 'T-Grid', sellingRate: 25, orderValue: 50000 },
    ],
    salesmanId: 's1',
    salesmanName: 'Rahul Sales',
    remark: 'Initial bulk order',
    createdBy: 'admin-1',
    isDeleted: false,
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
  },
  {
    id: 'ord-2',
    customerId: 'c2',
    orderNumber: 'PO-1002',
    orderDate: '2026-08-01',
    orderValue: 48000,
    products: [
      { productName: 'Fluted Panel', sellingRate: 120, orderValue: 48000 },
    ],
    salesmanId: 's1',
    salesmanName: 'Rahul Sales',
    remark: 'Urgent delivery required',
    createdBy: 'admin-1',
    isDeleted: false,
    createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
]

export async function getProductMasterList(): Promise<string[]> {
  if (!supabaseEnabled || !supabase) {
    return DEFAULT_PRODUCTS
  }

  const { data, error } = await supabase
    .from('product_master')
    .select('name')
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error || !data || data.length === 0) {
    return DEFAULT_PRODUCTS
  }
  return data.map((r) => r.name as string)
}

export async function addProductMasterItem(name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) return
  if (!supabaseEnabled || !supabase) return

  await supabase.from('product_master').upsert({ name: trimmed, is_active: true })
}

export async function getCustomerOrders(customerId: string): Promise<CustomerOrder[]> {
  if (!supabaseEnabled || !supabase) {
    return demoOrders.filter((o) => o.customerId === customerId && !o.isDeleted)
  }

  const { data, error } = await supabase
    .from('customer_orders')
    .select('*')
    .eq('customer_id', customerId)
    .eq('is_deleted', false)
    .order('order_date', { ascending: false })

  if (error || !data) {
    console.warn('Error fetching customer orders:', error?.message)
    return []
  }

  return data.map((r) => ({
    id: r.id as string,
    customerId: r.customer_id as string,
    orderNumber: (r.order_number as string) ?? null,
    orderDate: r.order_date as string,
    orderValue: Number(r.order_value ?? 0),
    products: (r.products as OrderProduct[]) ?? [],
    salesmanId: (r.salesman_id as string) ?? null,
    salesmanName: (r.salesman_name as string) ?? null,
    remark: (r.remark as string) ?? null,
    createdBy: (r.created_by as string) ?? null,
    isDeleted: Boolean(r.is_deleted),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }))
}

export async function getAllCustomerOrders(
  filters?: CustomerOrderFilters,
  customersList?: Array<{
    id: string
    name: string
    city: string
    phone: string
    assignedSalesmanId: string
    category?: 'A' | 'B' | 'C' | 'D' | 'E' | null
  }>
): Promise<EnrichedCustomerOrder[]> {
  let orders: CustomerOrder[] = []

  if (!supabaseEnabled || !supabase) {
    orders = demoOrders.filter((o) => !o.isDeleted)
  } else {
    let q = supabase
      .from('customer_orders')
      .select('*')
      .eq('is_deleted', false)
      .order('order_date', { ascending: false })

    if (filters?.orderDateFrom) {
      q = q.gte('order_date', filters.orderDateFrom)
    }
    if (filters?.orderDateTo) {
      q = q.lte('order_date', filters.orderDateTo)
    }
    if (filters?.salesmanId) {
      q = q.eq('salesman_id', filters.salesmanId)
    }
    if (filters?.customerId) {
      q = q.eq('customer_id', filters.customerId)
    }

    const { data, error } = await q
    if (error || !data) {
      console.warn('Error fetching all orders:', error?.message)
      return []
    }

    orders = data.map((r) => ({
      id: r.id as string,
      customerId: r.customer_id as string,
      orderNumber: (r.order_number as string) ?? null,
      orderDate: r.order_date as string,
      orderValue: Number(r.order_value ?? 0),
      products: (r.products as OrderProduct[]) ?? [],
      salesmanId: (r.salesman_id as string) ?? null,
      salesmanName: (r.salesman_name as string) ?? null,
      remark: (r.remark as string) ?? null,
      createdBy: (r.created_by as string) ?? null,
      isDeleted: Boolean(r.is_deleted),
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    }))
  }

  if (filters?.minOrderValue != null) {
    orders = orders.filter((o) => o.orderValue >= filters.minOrderValue!)
  }
  if (filters?.maxOrderValue != null) {
    orders = orders.filter((o) => o.orderValue <= filters.maxOrderValue!)
  }

  const customerMap = new Map(
    (customersList || []).map((c) => [
      c.id,
      {
        name: c.name,
        city: c.city,
        phone: c.phone,
        category: c.category ?? null,
        assignedSalesmanId: c.assignedSalesmanId,
      },
    ])
  )

  let enriched: EnrichedCustomerOrder[] = orders.map((o) => {
    const cust = customerMap.get(o.customerId)
    return {
      ...o,
      customerName: cust?.name || 'Unknown Customer',
      customerFirm: null,
      customerMobile: cust?.phone || null,
      customerCategory: cust?.category || null,
      customerCity: cust?.city || null,
      assignedSalesmanId: cust?.assignedSalesmanId || null,
    }
  })

  if (filters?.city) {
    enriched = enriched.filter((o) => o.customerCity === filters.city)
  }
  if (filters?.customerCategory) {
    enriched = enriched.filter((o) => o.customerCategory === filters.customerCategory)
  }
  if (filters?.productName) {
    const pn = filters.productName.toLowerCase()
    enriched = enriched.filter((o) =>
      o.products.some((p) => p.productName.toLowerCase().includes(pn))
    )
  }
  if (filters?.search) {
    const s = filters.search.toLowerCase()
    enriched = enriched.filter(
      (o) =>
        o.customerName.toLowerCase().includes(s) ||
        (o.customerMobile && o.customerMobile.includes(s)) ||
        (o.orderNumber && o.orderNumber.toLowerCase().includes(s))
    )
  }

  if (filters?.purchaseActivity && filters.daysSince != null) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - filters.daysSince)
    const cutoffStr = cutoff.toISOString().split('T')[0]
    const customerOrderDates = new Map<string, string>()
    enriched.forEach((o) => {
      const existing = customerOrderDates.get(o.customerId)
      if (!existing || o.orderDate > existing) {
        customerOrderDates.set(o.customerId, o.orderDate)
      }
    })
    if (filters.purchaseActivity === 'purchased') {
      enriched = enriched.filter((o) => {
        const last = customerOrderDates.get(o.customerId)
        return last && last >= cutoffStr
      })
    } else {
      enriched = enriched.filter((o) => {
        const last = customerOrderDates.get(o.customerId)
        return !last || last < cutoffStr
      })
    }
  }

  return enriched
}

export async function addCustomerOrder(data: {
  customerId: string
  orderNumber?: string | null
  orderDate: string
  orderValue?: number
  products: OrderProduct[]
  salesmanId: string | null
  salesmanName: string | null
  remark?: string | null
  createdBy: string
}): Promise<CustomerOrder> {
  const orderValue =
    data.orderValue ?? data.products.reduce((sum, p) => sum + (p.orderValue || 0), 0)
  const now = new Date().toISOString()

  if (!supabaseEnabled || !supabase) {
    const newOrd: CustomerOrder = {
      id: `ord-${Date.now()}`,
      customerId: data.customerId,
      orderNumber: data.orderNumber || null,
      orderDate: data.orderDate,
      orderValue,
      products: data.products,
      salesmanId: data.salesmanId,
      salesmanName: data.salesmanName,
      remark: data.remark || null,
      createdBy: data.createdBy,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
    }
    demoOrders.unshift(newOrd)
    return newOrd
  }

  const payload = {
    customer_id: data.customerId,
    order_number: data.orderNumber || null,
    order_date: data.orderDate,
    order_value: orderValue,
    products: data.products,
    salesman_id: data.salesmanId,
    salesman_name: data.salesmanName,
    remark: data.remark || null,
    created_by: data.createdBy,
    is_deleted: false,
  }

  const { data: res, error } = await supabase
    .from('customer_orders')
    .insert(payload)
    .select('*')
    .single()

  if (error || !res) {
    throw new Error(error?.message || 'Failed to insert order')
  }

  // Ensure summary is synced in case trigger didn't run
  await syncCustomerOrderSummaryFallback(data.customerId)

  return {
    id: res.id as string,
    customerId: res.customer_id as string,
    orderNumber: (res.order_number as string) ?? null,
    orderDate: res.order_date as string,
    orderValue: Number(res.order_value ?? 0),
    products: (res.products as OrderProduct[]) ?? [],
    salesmanId: (res.salesman_id as string) ?? null,
    salesmanName: (res.salesman_name as string) ?? null,
    remark: (res.remark as string) ?? null,
    createdBy: (res.created_by as string) ?? null,
    isDeleted: Boolean(res.is_deleted),
    createdAt: res.created_at as string,
    updatedAt: res.updated_at as string,
  }
}

export async function deleteCustomerOrder(orderId: string, customerId: string): Promise<boolean> {
  if (!supabaseEnabled || !supabase) {
    demoOrders = demoOrders.filter((o) => o.id !== orderId)
    return true
  }

  const { error } = await supabase
    .from('customer_orders')
    .update({ is_deleted: true })
    .eq('id', orderId)

  if (error) {
    console.warn('Error deleting order:', error.message)
    return false
  }

  await syncCustomerOrderSummaryFallback(customerId)
  return true
}

async function syncCustomerOrderSummaryFallback(customerId: string): Promise<void> {
  if (!supabaseEnabled || !supabase) return
  try {
    const { data } = await supabase
      .from('customer_orders')
      .select('order_value, order_date')
      .eq('customer_id', customerId)
      .eq('is_deleted', false)

    if (!data) return
    let total = 0
    let lastDate: string | null = null

    for (const r of data) {
      total += Number(r.order_value || 0)
      if (!lastDate || r.order_date > lastDate) {
        lastDate = r.order_date as string
      }
    }

    await supabase
      .from('customers')
      .update({
        total_purchase_value: total,
        last_order_date: lastDate,
        updated_at: new Date().toISOString(),
      })
      .eq('id', customerId)
  } catch (err) {
    console.warn('syncCustomerOrderSummaryFallback error:', err)
  }
}

/**
 * Bulk import orders from CSV data per user request:
 * Strictly matches customer ONLY by mobile number.
 */
export async function bulkImportOrders(
  ordersData: Array<{
    customerMobile?: string
    orderDate: string
    orderNumber?: string
    orderValue?: number
    products?: OrderProduct[]
    salesmanName?: string
    remark?: string
  }>,
  createdBy: string,
  customersList: Array<{ id: string; phone: string; assignedSalesmanId?: string }>,
  salesmenList: Array<{ id: string; name: string }>
): Promise<{ success: boolean; importedCount: number; errors: string[] }> {
  let importedCount = 0
  const errors: string[] = []

  const mobileToId = new Map<string, string>()
  customersList.forEach((c) => {
    if (c.phone) {
      const normalized = String(c.phone).replace(/\D/g, '')
      const key = normalized.length >= 10 ? normalized.slice(-10) : normalized
      mobileToId.set(key, c.id)
    }
  })

  const nameToSalesman = new Map<string, { id: string; name: string }>()
  salesmenList.forEach((s) => {
    if (s.name) {
      nameToSalesman.set(s.name.toLowerCase().trim(), s)
    }
  })

  const productMasterList = await getProductMasterList()
  const nameToProduct = new Map<string, string>()
  productMasterList.forEach((p) => {
    nameToProduct.set(p.toLowerCase().trim(), p)
  })

  const affectedCustomerIds = new Set<string>()

  for (let i = 0; i < ordersData.length; i++) {
    const row = ordersData[i]

    // 1. Strictly match customer by Mobile Number
    const rawMobile = String(row.customerMobile || '').replace(/\D/g, '')
    const mobileKey = rawMobile.length >= 10 ? rawMobile.slice(-10) : rawMobile
    const customerId = mobileToId.get(mobileKey)

    if (!customerId) {
      errors.push(`Row ${i + 1}: Customer not found for mobile '${row.customerMobile || 'N/A'}'`)
      continue
    }

    // 2. Match Salesman Name
    let salesmanId: string | null = null
    let salesmanName: string | null = null
    if (row.salesmanName) {
      const found = nameToSalesman.get(row.salesmanName.toLowerCase().trim())
      if (!found) {
        errors.push(`Row ${i + 1}: Salesman '${row.salesmanName}' not found in system.`)
        continue
      }
      salesmanId = found.id
      salesmanName = found.name
    } else {
      errors.push(`Row ${i + 1}: Salesman Name is required`)
      continue
    }

    // 3. Match and validate products
    let productsValid = true
    const finalProducts: OrderProduct[] = []
    if (row.products && row.products.length > 0) {
      for (const p of row.products) {
        const canonical = nameToProduct.get(String(p.productName).toLowerCase().trim())
        if (!canonical) {
          errors.push(
            `Row ${i + 1}: Product '${p.productName}' does not exist in Product Master.`
          )
          productsValid = false
          break
        }
        finalProducts.push({
          productName: canonical,
          sellingRate: p.sellingRate || 0,
          orderValue: p.orderValue || 0,
        })
      }
    }
    if (!productsValid) continue

    const orderValue =
      row.orderValue ??
      (finalProducts.length > 0 ? finalProducts.reduce((sum, p) => sum + p.orderValue, 0) : 0)

    const parsedDate = parseDDMMYYYY(row.orderDate)
    if (!parsedDate || Number.isNaN(orderValue) || orderValue <= 0) {
      errors.push(`Row ${i + 1}: Invalid order date (use DD-MM-YYYY) or order value must be > 0`)
      continue
    }

    const payload = {
      customer_id: customerId,
      order_number: row.orderNumber || null,
      order_date: parsedDate,
      order_value: orderValue,
      products: finalProducts,
      salesman_id: salesmanId,
      salesman_name: salesmanName,
      remark: row.remark || null,
      created_by: createdBy,
      is_deleted: false,
    }

    if (!supabaseEnabled || !supabase) {
      demoOrders.unshift({
        id: `ord-csv-${Date.now()}-${i}`,
        customerId,
        orderNumber: row.orderNumber || null,
        orderDate: parsedDate,
        orderValue,
        products: finalProducts,
        salesmanId,
        salesmanName,
        remark: row.remark || null,
        createdBy,
        isDeleted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      importedCount++
      affectedCustomerIds.add(customerId)
    } else {
      const { error } = await supabase.from('customer_orders').insert(payload)
      if (error) {
        errors.push(`Row ${i + 1}: Database insert error - ${error.message}`)
      } else {
        importedCount++
        affectedCustomerIds.add(customerId)
      }
    }
  }

  // Ensure summary fallback is synced for affected customers
  for (const cId of affectedCustomerIds) {
    await syncCustomerOrderSummaryFallback(cId)
  }

  return {
    success: importedCount > 0,
    importedCount,
    errors,
  }
}
