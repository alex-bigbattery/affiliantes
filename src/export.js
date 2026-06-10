// Reusable CSV + Excel export helpers.
// columns: [{ header: string, value: (row) => any }]
// rows:    array of objects

function stamp() {
  return new Date().toISOString().slice(0, 10)
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function csvCell(v) {
  const s = v == null ? '' : String(v)
  return `"${s.replace(/"/g, '""')}"`
}

export function exportCSV(baseName, columns, rows) {
  const headers = columns.map(c => c.header)
  const matrix = rows.map(r => columns.map(c => c.value(r)))
  const csv = [headers, ...matrix].map(line => line.map(csvCell).join(',')).join('\r\n')
  // BOM so Excel opens UTF-8 correctly
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  triggerDownload(blob, `${baseName}_${stamp()}.csv`)
}

// SheetJS is loaded on demand (dynamic import) so it stays out of the main bundle.
export async function exportXLSX(baseName, sheetName, columns, rows) {
  const XLSX = await import('xlsx')
  const headers = columns.map(c => c.header)
  const matrix = rows.map(r => columns.map(c => {
    const v = c.value(r)
    return v == null ? '' : v
  }))
  const ws = XLSX.utils.aoa_to_sheet([headers, ...matrix])
  // Auto-ish column widths from header + first 100 rows
  ws['!cols'] = headers.map((h, i) => {
    const lens = matrix.slice(0, 100).map(r => String(r[i] ?? '').length)
    return { wch: Math.min(45, Math.max(h.length, ...lens, 0) + 2) }
  })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, (sheetName || 'Sheet1').slice(0, 31))
  XLSX.writeFile(wb, `${baseName}_${stamp()}.xlsx`)
}
