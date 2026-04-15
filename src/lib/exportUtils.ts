export function exportToCsv(filename: string, headers: string[], rows: (string | number | undefined | null)[][]) {
  const processCell = (cell: string | number | undefined | null) => {
    if (cell === null || cell === undefined) return '""';
    const cellString = String(cell).replace(/"/g, '""');
    return `"${cellString}"`;
  };

  const csvContent = [
    headers.map(processCell).join(','),
    ...rows.map(row => row.map(processCell).join(','))
  ].join('\n');

  const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' }); // adding BOM for Excel
  const link = document.createElement('a');
  const originalUrl = URL.createObjectURL(blob);
  
  link.href = originalUrl;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  link.style.display = 'none';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  setTimeout(() => URL.revokeObjectURL(originalUrl), 100);
}
