// ─────────────────────────────────────────────────────────────────────────────
// Zoho Price History — READ-ONLY consumption of three tables populated by an
// EXTERNAL capture service (item_price_history, item_price_snapshots,
// item_price_snapshot_runs). This module NEVER writes to those tables (no
// INSERT/UPDATE/DELETE/DDL) and only issues short parameterized SELECTs via the
// shared pg pool.
//
// AUTH NOTE: the spec asks for these endpoints to sit behind the app's existing
// auth middleware (401 for anonymous + role tiers). This dashboard currently has
// NO authentication on ANY endpoint (every route is public). Per the product
// decision, these routes match the rest of the app and are PUBLIC. TODO: when
// app-wide auth is introduced, gate these the same as the other audit/data tabs
// and re-enable the raw_json-on-export role check.
// ─────────────────────────────────────────────────────────────────────────────
import { pool } from './db.js'

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res) }
    catch (e) {
      const status = e instanceof HttpError ? e.status : (e.status || 500)
      if (status >= 500) console.error('[zoho-price-history]', e)
      res.status(status).json({ error: e.message || String(e) })
    }
  }
}

// ── validation helpers ───────────────────────────────────────────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function parseRange(query) {
  let { from, to } = query
  const now = new Date()
  if (!to)   to   = now.toISOString().slice(0, 10)
  if (!from) from = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10)
  for (const [k, v] of [['from', from], ['to', to]]) {
    if (!DATE_RE.test(v) || Number.isNaN(Date.parse(v))) {
      throw new HttpError(400, `Invalid '${k}' date — expected YYYY-MM-DD`)
    }
  }
  if (from > to) throw new HttpError(400, "'from' must be <= 'to'")
  return { from, to, winStart: `${from}T00:00:00.000Z`, winEnd: `${to}T23:59:59.999Z` }
}

function parseStatus(s) {
  if (s == null || s === '') return null
  const v = String(s).toLowerCase()
  if (v === 'all') return null
  if (v === 'active' || v === 'inactive') return v
  throw new HttpError(400, "status must be one of: all | active | inactive")
}

function parseBool(v) {
  return ['1', 'true', 'yes', 'on'].includes(String(v ?? '').toLowerCase())
}

function rejectUnknown(query, allowed) {
  for (const k of Object.keys(query)) {
    if (!allowed.includes(k)) throw new HttpError(400, `Unknown query param: ${k}`)
  }
}

function parsePaging(query, defLimit = 250) {
  let limit = parseInt(query.limit, 10)
  if (!Number.isFinite(limit)) limit = defLimit
  limit = Math.max(1, Math.min(5000, limit))
  let offset = parseInt(query.offset, 10)
  if (!Number.isFinite(offset) || offset < 0) offset = 0
  return { limit, offset }
}

const EXPORT_CAP = 50000
const num = v => (v == null ? null : Number(v))

/** Postgres date/timestamp → YYYY-MM-DD (never use String(date).slice — that yields "Thu Jun 11"). */
function toIsoDateOnly(v) {
  if (v == null) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const s = String(v)
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (iso) return iso[1]
  const parsed = new Date(s)
  return Number.isNaN(parsed.getTime()) ? s : parsed.toISOString().slice(0, 10)
}

// ── column specs (drive both JSON shape parity and Excel columns) ─────────────
const DAILY_COLS = [
  { header: 'SKU',          key: 'sku',         type: 'text',  width: 18 },
  { header: 'Name',         key: 'name',        type: 'text',  width: 42 },
  { header: 'Date',         key: 'price_date',  type: 'date',  width: 14 },
  { header: 'Previous Rate', key: 'prev_rate',  type: 'money', width: 14 },
  { header: 'Rate',         key: 'rate',        type: 'money', width: 14 },
]
const SNAPSHOT_COLS = [
  { header: 'SKU',                key: 'sku',                     type: 'text',     width: 18 },
  { header: 'Name',               key: 'name',                    type: 'text',     width: 42 },
  { header: 'Rate',               key: 'rate',                    type: 'money',    width: 14 },
  { header: 'Status',             key: 'status',                  type: 'text',     width: 12 },
  { header: 'Captured At',        key: 'captured_at',             type: 'datetime', width: 22 },
  { header: 'Zoho Last Modified', key: 'zoho_last_modified_time', type: 'datetime', width: 22 },
]
const RUN_COLS = [
  { header: 'Started At',  key: 'started_at',    type: 'datetime', width: 22 },
  { header: 'Finished At', key: 'finished_at',   type: 'datetime', width: 22 },
  { header: 'Status',      key: 'status',        type: 'text',     width: 12 },
  { header: 'Items',       key: 'item_count',    type: 'int',      width: 10 },
  { header: 'Changed',     key: 'changed_count', type: 'int',      width: 10 },
]

// ── query builders ────────────────────────────────────────────────────────────
// Daily prices: expand item_price_history into one row per SKU per calendar day.
function dailyQuery(f) {
  const vals = []
  const p = v => { vals.push(v); return '$' + vals.length }
  const fromD = p(f.from)
  const toD = p(f.to)

  let statusJoin = ''
  const filters = []
  if (f.status) {
    statusJoin = ` JOIN (
      SELECT DISTINCT ON (item_id) item_id, status
      FROM item_price_snapshots ORDER BY item_id, captured_at DESC
    ) ls ON ls.item_id = d.item_id`
    filters.push(`ls.status = ${p(f.status)}`)
  }
  if (f.q) {
    const qp = p(`%${f.q}%`)
    filters.push(`(d.sku ILIKE ${qp} OR d.name ILIKE ${qp})`)
  }
  if (f.onlyChanges) {
    filters.push(`(d.prev_rate IS NULL OR d.rate IS DISTINCT FROM d.prev_rate)`)
  }
  const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : ''

  const sql = `
    WITH date_range AS (
      SELECT generate_series(${fromD}::date, ${toD}::date, '1 day')::date AS price_date
    ),
    daily_raw AS (
      SELECT DISTINCT ON (h.item_id, dr.price_date)
        h.item_id, h.sku, h.name, h.rate, dr.price_date
      FROM date_range dr
      JOIN item_price_history h
        ON h.effective_from::date <= dr.price_date
       AND COALESCE(h.effective_to::date, dr.price_date) >= dr.price_date
      ORDER BY h.item_id, dr.price_date, h.effective_from DESC
    ),
    daily AS (
      SELECT
        item_id, sku, name, rate, price_date,
        LAG(rate) OVER (PARTITION BY item_id ORDER BY price_date) AS prev_rate
      FROM daily_raw
    )
    SELECT d.item_id, d.sku, d.name, d.rate, d.prev_rate,
           d.price_date::text AS price_date
    FROM daily d${statusJoin}${where}`

  return { sql, vals, orderBy: ` ORDER BY d.sku ASC, d.price_date DESC` }
}

function snapshotsFromWhere(f) {
  const vals = []
  const p = v => { vals.push(v); return '$' + vals.length }
  const where = [`s.captured_at >= ${p(f.winStart)}`, `s.captured_at <= ${p(f.winEnd)}`]
  if (f.q) { const qp = p(`%${f.q}%`); where.push(`(s.sku ILIKE ${qp} OR s.name ILIKE ${qp})`) }
  if (f.status) where.push(`s.status = ${p(f.status)}`)
  return { sql: `FROM item_price_snapshots s WHERE ${where.join(' AND ')}`, vals }
}

function runsFromWhere(f) {
  const vals = []
  const p = v => { vals.push(v); return '$' + vals.length }
  const where = [`r.started_at >= ${p(f.winStart)}`, `r.started_at <= ${p(f.winEnd)}`]
  return { sql: `FROM item_price_snapshot_runs r WHERE ${where.join(' AND ')}`, vals }
}

const SELECT = {
  snapshots: `SELECT s.id, s.sku, s.name, s.rate, s.status, s.captured_at,
                     s.zoho_last_modified_time `,
  runs:      `SELECT r.id, r.started_at, r.finished_at, r.status,
                     r.item_count, r.changed_count `,
}
const ORDER = {
  snapshots: ` ORDER BY s.captured_at DESC, s.id DESC`,
  runs:      ` ORDER BY r.started_at DESC`,
}

function jsonRows(kind, rows) {
  // numeric -> Number; timestamps stay ISO strings (pg Date -> JSON ISO)
  return rows.map(r => {
    const out = { ...r }
    if ('rate' in out) out.rate = num(out.rate)
    if ('prev_rate' in out) out.prev_rate = num(out.prev_rate)
    if ('price_date' in out && out.price_date != null) {
      out.price_date = toIsoDateOnly(out.price_date)
    }
    return out
  })
}

async function dailyListQuery(f) {
  const { sql, vals, orderBy } = dailyQuery(f)
  const countVals = [...vals]
  const { rows: [c] } = await pool.query(`SELECT COUNT(*)::int AS n FROM (${sql}) counted`, countVals)
  const total = c.n
  const pageVals = [...vals, f.limit, f.offset]
  const lim = '$' + (vals.length + 1)
  const off = '$' + (vals.length + 2)
  const { rows } = await pool.query(`${sql}${orderBy} LIMIT ${lim} OFFSET ${off}`, pageVals)
  return { rows: jsonRows('daily', rows), total, has_more: f.offset + rows.length < total }
}

async function dailyExportRows(f) {
  const { sql, vals, orderBy } = dailyQuery(f)
  const cap = '$' + vals.push(EXPORT_CAP + 1)
  const { rows } = await pool.query(`${sql}${orderBy} LIMIT ${cap}`, vals)
  const truncated = rows.length > EXPORT_CAP
  return { rows: truncated ? rows.slice(0, EXPORT_CAP) : rows, truncated }
}

async function listQuery(kind, fromWhere, f) {
  const { sql, vals } = fromWhere(f)
  const { rows: [c] } = await pool.query(`SELECT COUNT(*)::int AS n ${sql}`, vals)
  const total = c.n
  const lim = '$' + vals.push(f.limit)
  const off = '$' + vals.push(f.offset)
  const { rows } = await pool.query(`${SELECT[kind]} ${sql}${ORDER[kind]} LIMIT ${lim} OFFSET ${off}`, vals)
  return { rows: jsonRows(kind, rows), total, has_more: f.offset + rows.length < total }
}

async function exportRows(kind, fromWhere, f) {
  const { sql, vals } = fromWhere(f)
  const cap = '$' + vals.push(EXPORT_CAP + 1)
  const { rows } = await pool.query(`${SELECT[kind]} ${sql}${ORDER[kind]} LIMIT ${cap}`, vals)
  const truncated = rows.length > EXPORT_CAP
  return { rows: truncated ? rows.slice(0, EXPORT_CAP) : rows, truncated }
}

// ── Excel builder (styled header, frozen row, currency + datetime formats) ────
function cellValue(type, v) {
  if (v == null) return type === 'datetime_or_open' ? 'open' : null
  if (type === 'money') return num(v)
  if (type === 'int') return v == null ? null : Number(v)
  if (type === 'date') {
    const s = String(v).slice(0, 10)
    return new Date(`${s}T00:00:00Z`)
  }
  if (type === 'datetime' || type === 'datetime_or_open') return new Date(v)
  return v
}

async function streamWorkbook(res, { subtab, sourceTable, cols, rows, truncated, filters, from, to }) {
  const { default: ExcelJS } = await import('exceljs')
  const exportedAtISO = new Date().toISOString()
  const stamp = exportedAtISO.slice(0, 16).replace(/:/g, '') + 'Z' // e.g. 2026-06-11T1532Z
  const filename = `zoho_${subtab}_${from}_to_${to}_${stamp}.xlsx`

  const wb = new ExcelJS.Workbook()
  wb.creator = 'BigBattery Affiliate Dashboard'
  wb.created = new Date(exportedAtISO)

  // Sheet 1 — data
  const ws = wb.addWorksheet(subtab.charAt(0).toUpperCase() + subtab.slice(1))
  ws.columns = cols.map(c => ({ header: c.header, key: c.key, width: c.width || 18 }))
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  const head = ws.getRow(1)
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }
  head.alignment = { vertical: 'middle' }
  for (const r of rows) {
    const obj = {}
    for (const c of cols) obj[c.key] = cellValue(c.type, r[c.key])
    ws.addRow(obj)
  }
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1)
    if (c.type === 'money') col.numFmt = '$#,##0.00'
    if (c.type === 'date') col.numFmt = 'yyyy-mm-dd'
    if (c.type === 'datetime' || c.type === 'datetime_or_open') col.numFmt = 'yyyy-mm-dd hh:mm:ss'
  })

  // Sheet 2 — metadata
  const meta = wb.addWorksheet('Metadata')
  meta.columns = [{ header: 'Field', key: 'k', width: 28 }, { header: 'Value', key: 'v', width: 70 }]
  meta.getRow(1).font = { bold: true }
  if (truncated) {
    const warn = meta.addRow({ k: '⚠ WARNING', v: `Export truncated to ${EXPORT_CAP.toLocaleString()} rows. Narrow the date range or filters to get the full set.` })
    warn.font = { bold: true, color: { argb: 'FFC00000' } }
  }
  meta.addRow({ k: 'Source table', v: sourceTable })
  for (const [k, v] of filters) meta.addRow({ k: `Filter: ${k}`, v: String(v) })
  meta.addRow({ k: 'Total rows exported', v: rows.length })
  meta.addRow({ k: 'Exported at (UTC)', v: exportedAtISO })
  meta.addRow({ k: 'Note', v: 'Read-only export. Does not modify any source table or affect commission math / invoice automation.' })

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  await wb.xlsx.write(res)
  res.end()
}

// ── route registration (mounted once from server.js) ──────────────────────────
export function registerZohoPriceHistory(app) {
  const DAILY_PARAMS    = ['from', 'to', 'q', 'status', 'onlyChanges', 'limit', 'offset']
  const SNAPSHOT_PARAMS = ['from', 'to', 'q', 'status', 'limit', 'offset']
  const RUN_PARAMS      = ['from', 'to', 'limit', 'offset']
  const DAILY_EXPORT    = ['from', 'to', 'q', 'status', 'onlyChanges']
  const SNAPSHOT_EXPORT = ['from', 'to', 'q', 'status']
  const RUN_EXPORT      = ['from', 'to']

  const dailyFilters = f => ([
    ['from', f.from], ['to', f.to], ['search (sku/name)', f.q || '(none)'],
    ['status', f.status || 'all'], ['only days with price change', f.onlyChanges ? 'yes' : 'no'],
    ['granularity', 'one row per SKU per calendar day (from item_price_history)'],
  ])
  const snapshotFilters = f => ([
    ['from', f.from], ['to', f.to], ['search (sku/name)', f.q || '(none)'], ['status', f.status || 'all'],
  ])
  const runFilters = f => ([['from', f.from], ['to', f.to]])

  // ── DAILY (one price per SKU per calendar day) ──
  app.get('/api/zoho-price-history/daily', wrap(async (req, res) => {
    rejectUnknown(req.query, DAILY_PARAMS)
    const { from, to } = parseRange(req.query)
    const { limit, offset } = parsePaging(req.query)
    const f = { from, to, q: req.query.q?.trim() || '', status: parseStatus(req.query.status), onlyChanges: parseBool(req.query.onlyChanges), limit, offset }
    res.json(await dailyListQuery(f))
  }))

  app.get('/api/zoho-price-history/daily/export', wrap(async (req, res) => {
    rejectUnknown(req.query, DAILY_EXPORT)
    const { from, to } = parseRange(req.query)
    const f = { from, to, q: req.query.q?.trim() || '', status: parseStatus(req.query.status), onlyChanges: parseBool(req.query.onlyChanges) }
    const { rows, truncated } = await dailyExportRows(f)
    await streamWorkbook(res, { subtab: 'daily', sourceTable: 'item_price_history (expanded by day)', cols: DAILY_COLS, rows, truncated, filters: dailyFilters(f), from, to })
  }))

  // legacy alias
  app.get('/api/zoho-price-history/periods', wrap(async (req, res) => {
    rejectUnknown(req.query, DAILY_PARAMS)
    const { from, to } = parseRange(req.query)
    const { limit, offset } = parsePaging(req.query)
    const f = { from, to, q: req.query.q?.trim() || '', status: parseStatus(req.query.status), onlyChanges: parseBool(req.query.onlyChanges), limit, offset }
    res.json(await dailyListQuery(f))
  }))

  // ── SNAPSHOTS ──
  app.get('/api/zoho-price-history/snapshots', wrap(async (req, res) => {
    rejectUnknown(req.query, SNAPSHOT_PARAMS)
    const { from, to, winStart, winEnd } = parseRange(req.query)
    const { limit, offset } = parsePaging(req.query)
    const f = { from, to, winStart, winEnd, q: req.query.q?.trim() || '', status: parseStatus(req.query.status), limit, offset }
    res.json(await listQuery('snapshots', snapshotsFromWhere, f))
  }))

  app.get('/api/zoho-price-history/snapshots/export', wrap(async (req, res) => {
    rejectUnknown(req.query, SNAPSHOT_EXPORT)
    const { from, to, winStart, winEnd } = parseRange(req.query)
    const f = { from, to, winStart, winEnd, q: req.query.q?.trim() || '', status: parseStatus(req.query.status) }
    const { rows, truncated } = await exportRows('snapshots', snapshotsFromWhere, f)
    await streamWorkbook(res, { subtab: 'snapshots', sourceTable: 'item_price_snapshots', cols: SNAPSHOT_COLS, rows, truncated, filters: snapshotFilters(f), from, to })
  }))

  // ── RUNS ──
  app.get('/api/zoho-price-history/runs', wrap(async (req, res) => {
    rejectUnknown(req.query, RUN_PARAMS)
    const { from, to, winStart, winEnd } = parseRange(req.query)
    const { limit, offset } = parsePaging(req.query)
    res.json(await listQuery('runs', runsFromWhere, { from, to, winStart, winEnd, limit, offset }))
  }))

  app.get('/api/zoho-price-history/runs/export', wrap(async (req, res) => {
    rejectUnknown(req.query, RUN_EXPORT)
    const { from, to, winStart, winEnd } = parseRange(req.query)
    const f = { from, to, winStart, winEnd }
    const { rows, truncated } = await exportRows('runs', runsFromWhere, f)
    await streamWorkbook(res, { subtab: 'runs', sourceTable: 'item_price_snapshot_runs', cols: RUN_COLS, rows, truncated, filters: runFilters(f), from, to })
  }))
}
