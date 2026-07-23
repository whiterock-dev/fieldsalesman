import { useState, useEffect, useMemo } from 'react'
import type { CityMaster } from '../App'

export function SearchableCityDropdown({
  cities,
  valueId,
  fallbackName,
  onChange,
  disabled,
  placeholder = "Search and select city..."
}: {
  cities: CityMaster[]
  valueId: string
  fallbackName?: string
  onChange: (cityId: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  
  useEffect(() => {
    if (valueId) {
      const city = cities.find(c => c.id === valueId)
      if (city && !open) setSearch(city.name)
    } else {
      if (!open) setSearch(fallbackName || '')
    }
  }, [valueId, fallbackName, cities, open])

  const activeCities = useMemo(() => cities.filter(c => c.isActive), [cities])
  
  const filtered = useMemo(() => {
    if (!search.trim()) return activeCities
    const q = search.toLowerCase()
    return activeCities.filter(c => c.name.toLowerCase().includes(q))
  }, [activeCities, search])

  const handleSelect = (city: CityMaster) => {
    setSearch(city.name)
    onChange(city.id)
    setOpen(false)
  }

  const handleBlur = () => {
    setTimeout(() => {
      const exactMatch = activeCities.find(c => c.name.toLowerCase() === search.trim().toLowerCase())
      if (exactMatch) {
        setSearch(exactMatch.name)
        onChange(exactMatch.id)
      } else {
        const selected = cities.find(c => c.id === valueId)
        setSearch(selected ? selected.name : (fallbackName || ''))
        if (!selected) onChange('')
      }
      setOpen(false)
    }, 200)
  }

  return (
    <div style={{ position: 'relative', border: '1px solid #8a8f98', borderRadius: '10px' }}>
      <input
        type="text"
        placeholder={placeholder}
        value={search}
        onChange={e => {
          setSearch(e.target.value)
          setOpen(true)
          if (valueId) onChange('')
        }}
        onFocus={() => setOpen(true)}
        onBlur={handleBlur}
        disabled={disabled}
        autoComplete="off"
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
      {open && (
        <ul style={{
          position: 'absolute', top: '100%', left: 0, right: 0, 
          maxHeight: '200px', overflowY: 'auto', 
          backgroundColor: '#ffffff', 
          border: '1px solid #e2e8f0',
          borderRadius: '4px', zIndex: 100, 
          listStyle: 'none', padding: 0, margin: '2px 0 0 0',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
        }}>
          {filtered.length === 0 ? (
            <li style={{ padding: '8px', color: '#64748b' }}>No active cities found.</li>
          ) : (
            filtered.map(c => (
              <li
                key={c.id}
                onMouseDown={(e) => {
                  e.preventDefault()
                  handleSelect(c)
                }}
                style={{ 
                  padding: '8px 12px', 
                  cursor: 'pointer', 
                  backgroundColor: valueId === c.id ? '#2563eb' : 'transparent',
                  color: valueId === c.id ? '#ffffff' : '#0f172a',
                  borderBottom: '1px solid #f1f5f9'
                }}
              >
                {c.name}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
