/*
 * Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
 * © 2026 WhiteRock (Royal Enterprise). All rights reserved.
 *
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

export interface OrderProduct {
  productName: string
  sellingRate: number
  orderValue: number
}

export interface CustomerOrder {
  id: string
  customerId: string
  orderNumber: string | null
  orderDate: string // YYYY-MM-DD
  orderValue: number
  products: OrderProduct[]
  salesmanId: string | null
  salesmanName: string | null
  remark: string | null
  createdBy: string | null
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

export interface EnrichedCustomerOrder extends CustomerOrder {
  customerName: string
  customerFirm: string | null
  customerMobile: string | null
  customerCategory: 'A' | 'B' | 'C' | 'D' | 'E' | null
  customerCity: string | null
  assignedSalesmanId: string | null
}

export interface CustomerOrderFilters {
  salesmanId?: string
  city?: string
  customerCategory?: string
  orderDateFrom?: string // YYYY-MM-DD
  orderDateTo?: string // YYYY-MM-DD
  minOrderValue?: number
  maxOrderValue?: number
  purchaseActivity?: 'purchased' | 'not_purchased'
  daysSince?: number
  search?: string
  customerId?: string
  productName?: string
}
