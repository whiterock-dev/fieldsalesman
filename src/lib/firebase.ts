/*
 * Developed by Nerdshouse Technologies LLP — https://nerdshouse.com
 * © 2026 WhiteRock (Royal Enterprise). All rights reserved.
 *
 * Unauthorized copying, modification, or distribution is strictly prohibited.
 */

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  documentId,
  type Firestore,
} from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || '',
}

const app: FirebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]
export const db: Firestore = getFirestore(app)

export interface B2BCustomerHistoryEntry {
  id: string
  customerId: string
  customerName: string
  customerMobile: string | null
  customerFirm: string | null
  customerCity: string | null
  nextFollowupDate: string | null
  updatedBy: string
  updatedByName: string
  fieldChanged: string
  oldValue: string | null
  newValue: string | null
  remark: string | null
  updatedAt: string
}

export interface B2BSalesmanOption {
  id: string
  name: string
}

export interface FetchB2BFollowupHistoryResult {
  history: B2BCustomerHistoryEntry[]
  scOptions: B2BSalesmanOption[]
  cities: string[]
}

function parseTimestampMs(val: unknown): number {
  if (!val) return 0
  if (typeof val === 'string') return new Date(val).getTime()
  if (typeof val === 'number') return val
  if (typeof val === 'object' && val !== null) {
    const anyVal = val as { toDate?: () => Date; seconds?: number }
    if (typeof anyVal.toDate === 'function') return anyVal.toDate().getTime()
    if (typeof anyVal.seconds === 'number') return anyVal.seconds * 1000
  }
  if (val instanceof Date) return val.getTime()
  return 0
}

export async function fetchB2BFollowupHistory(options?: {
  startDate?: string
  endDate?: string
  scId?: string
  limitCount?: number
}): Promise<FetchB2BFollowupHistoryResult> {
  const startDate = options?.startDate || ''
  const endDate = options?.endDate || ''
  const scId = options?.scId || ''
  const limitCount = options?.limitCount || 500

  const startObj = startDate ? new Date(`${startDate}T00:00:00`) : null
  const endObj = endDate ? new Date(`${endDate}T23:59:59.999`) : null

  const startIso = startObj && !isNaN(startObj.getTime()) ? startObj.toISOString() : null
  const endIso = endObj && !isNaN(endObj.getTime()) ? endObj.toISOString() : null

  const colRef = collection(db, 'customer_history')
  let docs: unknown[] = []

  if (startIso && endIso) {
    try {
      const q = query(
        colRef,
        where('updatedAt', '>=', startIso),
        where('updatedAt', '<=', endIso),
        orderBy('updatedAt', 'desc')
      )
      const snap = await getDocs(q)
      if (snap.empty) {
        const fallbackQ = query(colRef, orderBy('updatedAt', 'desc'), limit(limitCount))
        const fbSnap = await getDocs(fallbackQ)
        docs = fbSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      } else {
        docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      }
    } catch (err) {
      if (err instanceof Error && (err.message.includes('permission') || err.message.includes('Missing or insufficient'))) {
        throw new Error('Firebase permission error: Unable to read customer_history from B2B Firestore. Since Firebase Authentication is not used, please ensure your Firestore Security Rules in the Firebase Console for project whiterock-b2bsales allow read access (e.g. allow read: if true; for customer_history, customers, and users).')
      }
      const fallbackQ = query(colRef, orderBy('updatedAt', 'desc'), limit(limitCount))
      const fbSnap = await getDocs(fallbackQ)
      docs = fbSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    }
  } else {
    try {
      const q = query(colRef, orderBy('updatedAt', 'desc'), limit(limitCount))
      const snap = await getDocs(q)
      docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    } catch (err) {
      if (err instanceof Error && (err.message.includes('permission') || err.message.includes('Missing or insufficient'))) {
        throw new Error('Firebase permission error: Unable to read customer_history from B2B Firestore. Since Firebase Authentication is not used, please ensure your Firestore Security Rules in the Firebase Console for project whiterock-b2bsales allow read access (e.g. allow read: if true; for customer_history, customers, and users).')
      }
      throw err
    }
  }

  if (docs.length === 0) {
    return { history: [], scOptions: [], cities: [] }
  }

  const startMs = startObj ? startObj.getTime() : null
  const endMs = endObj ? endObj.getTime() : null

  type RawHistoryItem = {
    id: string
    customerId?: string
    updatedBy?: string
    fieldChanged?: string
    oldValue?: string | null
    newValue?: string | null
    remark?: string | null
    updatedAt?: string | unknown
  }

  const filtered = (docs as RawHistoryItem[]).filter((item) => {
    if (scId && item.updatedBy !== scId) return false
    const timeMs = parseTimestampMs(item.updatedAt)
    if (startMs !== null && !isNaN(startMs) && timeMs < startMs) return false
    if (endMs !== null && !isNaN(endMs) && timeMs > endMs) return false
    return true
  })

  if (filtered.length === 0) {
    return { history: [], scOptions: [], cities: [] }
  }

  const customerIds = [...new Set(filtered.map((item) => item.customerId).filter(Boolean))] as string[]
  const userIds = [...new Set(filtered.map((item) => item.updatedBy).filter(Boolean))] as string[]

  const customerMap = new Map<
    string,
    {
      customerName: string
      customerMobile: string | null
      customerFirm: string | null
      customerCity: string | null
      nextFollowupDate: string | null
    }
  >()

  if (customerIds.length > 0) {
    const chunks: string[][] = []
    for (let i = 0; i < customerIds.length; i += 30) {
      chunks.push(customerIds.slice(i, i + 30))
    }
    await Promise.all(
      chunks.map(async (chunk) => {
        try {
          const q = query(collection(db, 'customers'), where(documentId(), 'in', chunk))
          const snap = await getDocs(q)
          snap.docs.forEach((d) => {
            const data = d.data()
            customerMap.set(d.id, {
              customerName: data?.customerName || 'Unknown',
              customerMobile: data?.mobileNo || null,
              customerFirm: data?.firmName || null,
              customerCity: data?.city || null,
              nextFollowupDate: data?.nextFollowupDate || null,
            })
          })
        } catch {
          /* ignore missing chunk */
        }
      })
    )
  }

  const usersMap = new Map<string, string>()
  const scOptions: B2BSalesmanOption[] = []

  try {
    const usersSnap = await getDocs(collection(db, 'users'))
    usersSnap.docs.forEach((d) => {
      const data = d.data()
      const name = data?.name || 'Unknown SC'
      usersMap.set(d.id, name)
      scOptions.push({ id: d.id, name })
    })
  } catch {
    /* fallback to IDs */
  }

  userIds.forEach((uid) => {
    if (!usersMap.has(uid)) {
      usersMap.set(uid, uid)
      scOptions.push({ id: uid, name: uid })
    }
  })

  scOptions.sort((a, b) => a.name.localeCompare(b.name))

  const citySet = new Set<string>()
  const history: B2BCustomerHistoryEntry[] = filtered.map((item) => {
    const custId = item.customerId || ''
    const custInfo = customerMap.get(custId)
    const customerCity = custInfo?.customerCity || null
    if (customerCity && customerCity !== '—') {
      citySet.add(customerCity)
    }

    const nextFollowupDate =
      item.fieldChanged === 'nextFollowupDate' && item.newValue
        ? String(item.newValue)
        : custInfo?.nextFollowupDate || null

    const updatedAtStr =
      typeof item.updatedAt === 'string'
        ? item.updatedAt
        : item.updatedAt
          ? new Date(parseTimestampMs(item.updatedAt)).toISOString()
          : new Date().toISOString()

    return {
      id: item.id,
      customerId: custId,
      customerName: custInfo?.customerName || 'Unknown Customer',
      customerMobile: custInfo?.customerMobile || null,
      customerFirm: custInfo?.customerFirm || null,
      customerCity,
      nextFollowupDate,
      updatedBy: item.updatedBy || '',
      updatedByName: item.updatedBy ? usersMap.get(item.updatedBy) || 'Unknown' : 'System',
      fieldChanged: item.fieldChanged || 'updated',
      oldValue: item.oldValue || null,
      newValue: item.newValue || null,
      remark: item.remark || null,
      updatedAt: updatedAtStr,
    }
  })

  return {
    history,
    scOptions,
    cities: Array.from(citySet).sort(),
  }
}
