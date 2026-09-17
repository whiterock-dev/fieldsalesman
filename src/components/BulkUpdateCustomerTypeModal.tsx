import { useState, useRef } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

export type BulkUpdateCustomerTypeModalProps = {
  isOpen: boolean
  onClose: () => void
  customers: { id: string; name: string; phone: string; dynamicFields?: Record<string, string> }[]
  customerTypeFieldKey: string
  customerTypeOptions: string[]
  supabase: SupabaseClient<any, "public", any>
  onDataChanged: () => void
}

type ParsedRow = {
  mobile: string
  newType: string
  customerId?: string
  customerName?: string
  status: 'valid' | 'duplicate_in_db' | 'not_found' | 'invalid_type' | 'missing_data'
}

// Minimal CSV parser
function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []
  
  const parseLine = (line: string) => {
    const result = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        if (inQuotes && line[i+1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    result.push(current.trim())
    return result
  }

  const headers = parseLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''))
  const rows: Record<string, string>[] = []
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i])
    const rowObj: Record<string, string> = {}
    headers.forEach((h, idx) => {
      rowObj[h] = values[idx] || ''
    })
    rows.push(rowObj)
  }
  return rows
}

export function BulkUpdateCustomerTypeModal({
  isOpen,
  onClose,
  customers,
  customerTypeFieldKey,
  customerTypeOptions,
  supabase,
  onDataChanged
}: BulkUpdateCustomerTypeModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  if (!isOpen) return null

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setErrorMsg('')
    setSuccessMsg('')
    setParsedRows([])

    try {
      const text = await f.text()
      const rows = parseCsv(text)
      
      if (rows.length === 0) {
        throw new Error("No data found in CSV. Please ensure it has a header row and at least one data row.")
      }

      // We expect columns that look like mobile/phone and customertype
      let mobileKey = Object.keys(rows[0]).find(k => k.includes('mobile') || k.includes('phone') || k.includes('number'))
      let typeKey = Object.keys(rows[0]).find(k => k.includes('type') || k.includes('customer'))

      if (!mobileKey || !typeKey) {
        throw new Error("Could not detect 'Mobile' or 'Type' columns automatically. Please ensure headers contain 'Mobile Number' and 'Customer Type'.")
      }

      // Pre-calculate phone map for DB
      const phoneMap = new Map<string, typeof customers>()
      for (const c of customers) {
        if (!c.phone) continue
        const cleanPhone = c.phone.replace(/\D/g, '').slice(-10)
        const existing = phoneMap.get(cleanPhone) || []
        existing.push(c)
        phoneMap.set(cleanPhone, existing)
      }

      const validOptions = customerTypeOptions.map(o => o.toLowerCase().trim())

      const processed: ParsedRow[] = rows.map(r => {
        const rawMobile = r[mobileKey as string] || ''
        const newType = r[typeKey as string] || ''
        const cleanMobile = rawMobile.replace(/\D/g, '').slice(-10)

        if (!cleanMobile || !newType) {
          return { mobile: rawMobile, newType, status: 'missing_data' }
        }

        const matchedCustomers = phoneMap.get(cleanMobile) || []
        
        let status: ParsedRow['status'] = 'valid'
        let customerId: string | undefined
        let customerName: string | undefined

        if (matchedCustomers.length === 0) {
          status = 'not_found'
        } else if (matchedCustomers.length > 1) {
          status = 'duplicate_in_db'
        } else {
          customerId = matchedCustomers[0].id
          customerName = matchedCustomers[0].name
        }

        if (status === 'valid' && !validOptions.includes(newType.toLowerCase().trim())) {
          status = 'invalid_type'
        }

        // Ensure correct capitalization from options list
        const exactType = customerTypeOptions.find(o => o.toLowerCase().trim() === newType.toLowerCase().trim())

        return {
          mobile: rawMobile,
          newType: exactType || newType, // keep exact if valid, otherwise keep raw for display
          customerId,
          customerName,
          status
        }
      })

      setParsedRows(processed)

    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    }
  }

  const handleUpdate = async () => {
    const validRows = parsedRows.filter(r => r.status === 'valid')
    if (validRows.length === 0) return
    
    setIsProcessing(true)
    setErrorMsg('')
    let successCount = 0

    try {
      // Chunk updates
      const chunkSize = 50
      for (let i = 0; i < validRows.length; i += chunkSize) {
        const chunk = validRows.slice(i, i + chunkSize)
        
        const promises = chunk.map(row => {
          const c = customers.find(cust => cust.id === row.customerId)
          if (!c) return Promise.resolve()

          const newDynamicFields = { ...c.dynamicFields, [customerTypeFieldKey]: row.newType }
          
          return supabase
            .from('customers')
            .update({ dynamic_fields: newDynamicFields })
            .eq('id', c.id)
            .then(({ error }) => {
              if (error) throw error
              successCount++
            })
        })

        await Promise.all(promises)
      }

      setSuccessMsg(`Successfully updated ${successCount} customers!`)
      onDataChanged()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error updating customers.')
    } finally {
      setIsProcessing(false)
    }
  }

  const total = parsedRows.length
  const validCount = parsedRows.filter(r => r.status === 'valid').length
  const issuesCount = total - validCount

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" onClick={() => !isProcessing && onClose()}>
      <div className="modalCard" style={{ maxWidth: '800px' }} onClick={e => e.stopPropagation()}>
        <div className="modalHeader">
          <h2>Bulk Update Customer Type</h2>
          <button type="button" className="closeBtn" onClick={onClose} disabled={isProcessing}>&times;</button>
        </div>
        
        <div className="modalBody" style={{ maxHeight: '65vh', overflowY: 'auto' }}>
          {!file && (
            <div style={{ padding: '2rem 1rem', textAlign: 'center', border: '2px dashed #ccc', borderRadius: '8px' }}>
              <p style={{ marginBottom: '1rem', color: '#555' }}>
                Upload a CSV file containing two columns: <strong>Mobile Number</strong> and <strong>Customer Type</strong>.
              </p>
              {customerTypeOptions.length > 0 ? (
                <p style={{ marginBottom: '1rem', color: '#16a34a', fontSize: '0.9em' }}>
                  <strong>Valid types:</strong> {customerTypeOptions.map(o => `"${o}"`).join(', ')}
                </p>
              ) : (
                <p style={{ marginBottom: '1rem', color: '#dc2626', fontSize: '0.9em' }}>
                  <strong>Error:</strong> This field has no options configured. Please configure it in settings.
                </p>
              )}
              <input
                type="file"
                accept=".csv"
                ref={fileInputRef}
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
              <button className="primary" onClick={() => fileInputRef.current?.click()}>
                Select CSV File
              </button>
            </div>
          )}

          {file && parsedRows.length > 0 && (
            <div>
              <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <strong>{file.name}</strong>
                <button type="button" className="secondary" onClick={() => setFile(null)} disabled={isProcessing} style={{ padding: '4px 8px', fontSize: '0.8rem' }}>Change File</button>
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', padding: '1rem', backgroundColor: '#f8fafc', borderRadius: '8px' }}>
                <div>Total Rows: <strong>{total}</strong></div>
                <div>Valid to Update: <strong style={{ color: '#16a34a' }}>{validCount}</strong></div>
                <div>Issues: <strong style={{ color: issuesCount > 0 ? '#dc2626' : '#555' }}>{issuesCount}</strong></div>
              </div>

              {issuesCount > 0 && (
                <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: '8px' }}>
                  <strong>Warning:</strong> {issuesCount} rows will be skipped due to validation errors (Duplicates, Not Found, or Invalid Type).
                </div>
              )}

              <table className="cdTable" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f1f5f9', textAlign: 'left' }}>
                    <th style={{ padding: '8px', borderBottom: '1px solid #cbd5e1' }}>Mobile</th>
                    <th style={{ padding: '8px', borderBottom: '1px solid #cbd5e1' }}>Customer</th>
                    <th style={{ padding: '8px', borderBottom: '1px solid #cbd5e1' }}>New Type</th>
                    <th style={{ padding: '8px', borderBottom: '1px solid #cbd5e1' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.slice(0, 50).map((row, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0', backgroundColor: row.status !== 'valid' ? '#fef2f2' : 'transparent' }}>
                      <td style={{ padding: '8px' }}>{row.mobile}</td>
                      <td style={{ padding: '8px' }}>{row.customerName || '-'}</td>
                      <td style={{ padding: '8px' }}>{row.newType}</td>
                      <td style={{ padding: '8px' }}>
                        {row.status === 'valid' && <span style={{ color: '#16a34a' }}>Valid</span>}
                        {row.status === 'not_found' && <span style={{ color: '#dc2626' }}>Not Found</span>}
                        {row.status === 'duplicate_in_db' && <span style={{ color: '#dc2626' }}>Multiple in DB</span>}
                        {row.status === 'invalid_type' && (
                          <span style={{ color: '#ea580c' }} title={`Must be one of: ${customerTypeOptions.join(', ')}`}>
                            Invalid Type
                          </span>
                        )}
                        {row.status === 'missing_data' && <span style={{ color: '#dc2626' }}>Missing Data</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsedRows.length > 50 && (
                <div style={{ textAlign: 'center', padding: '8px', color: '#64748b' }}>
                  Showing first 50 rows...
                </div>
              )}
            </div>
          )}

          {errorMsg && (
            <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#fef2f2', color: '#991b1b', borderRadius: '8px' }}>
              {errorMsg}
            </div>
          )}
          
          {successMsg && (
            <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#f0fdf4', color: '#166534', borderRadius: '8px' }}>
              {successMsg}
            </div>
          )}
        </div>
        
        <div className="modalFooter">
          {!successMsg ? (
            <>
              <button type="button" className="secondary" onClick={onClose} disabled={isProcessing}>Cancel</button>
              <button 
                type="button" 
                className="primary" 
                onClick={handleUpdate} 
                disabled={isProcessing || !file || validCount === 0}
              >
                {isProcessing ? 'Updating...' : `Update ${validCount} Customers`}
              </button>
            </>
          ) : (
            <button type="button" className="primary" onClick={onClose}>Done</button>
          )}
        </div>
      </div>
    </div>
  )
}
