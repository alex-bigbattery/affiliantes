import { useState } from 'react'
import { FileText, FileSpreadsheet } from 'lucide-react'
import { exportCSV, exportXLSX } from '../export'

// Reusable CSV + Excel export buttons.
// Props: baseName (file prefix), sheetName (Excel tab), columns [{header,value}], rows []
export default function ExportButtons({ baseName, sheetName, columns, rows = [], disabled }) {
  const [busy, setBusy] = useState(false)
  const off = disabled || !rows.length

  const doCSV = () => exportCSV(baseName, columns, rows)
  const doXLSX = async () => {
    setBusy(true)
    try { await exportXLSX(baseName, sheetName || baseName, columns, rows) }
    finally { setBusy(false) }
  }

  return (
    <div className="flex items-center gap-2">
      <button className="btn-outline" onClick={doCSV} disabled={off} title="Export to CSV">
        <FileText size={14} /> CSV
      </button>
      <button className="btn-outline" onClick={doXLSX} disabled={off || busy} title="Export to Excel">
        <FileSpreadsheet size={14} /> {busy ? 'Excel…' : 'Excel'}
      </button>
    </div>
  )
}
