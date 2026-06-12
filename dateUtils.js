/** YYYY-MM-DD — safe for Postgres text comparison on sales_orders.order_date. */
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Query-param / filter input → ISO date or null. */
export function normalizeDateParam(raw) {
  if (raw == null || raw === '') return null
  const t = String(raw).trim()
  if (ISO_DATE_RE.test(t)) return t
  const us = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (us) {
    const [, m, d, y] = us
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const isoPrefix = t.match(/^(\d{4}-\d{2}-\d{2})/)
  if (isoPrefix) return isoPrefix[1]
  return null
}

/** Postgres date/timestamp → YYYY-MM-DD (never String(date).slice — yields "Thu Jun 11"). */
export function toIsoDateOnly(v) {
  if (v == null) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (iso) return iso[1]
  // Zoho "Wed Jun 10" has no year — JS Date() defaults to 2001; skip those strings.
  if (/^[A-Za-z]{3}\s/.test(s) && !/^\d{4}/.test(s)) return null
  if (/^\d{4}/.test(s) || s.includes('T')) {
    const parsed = new Date(s)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
  }
  return null
}

function parseRawJson(raw) {
  if (!raw) return null
  if (typeof raw === 'object') return raw
  try { return JSON.parse(raw) } catch { return null }
}

/** Best-effort order date from Zoho sales_orders row (order_date is often "Wed Jun 10"). */
export function resolveSalesOrderDate(orderDate, rawJson, wcDateCreated) {
  const direct = toIsoDateOnly(orderDate)
  if (direct && ISO_DATE_RE.test(String(orderDate).trim().slice(0, 10))) return direct
  const raw = parseRawJson(rawJson)
  const fromCreated = toIsoDateOnly(raw?.created_time || raw?.date)
  if (fromCreated) return fromCreated
  const fromWc = toIsoDateOnly(wcDateCreated)
  if (fromWc) return fromWc
  return direct
}

/** SQL: YYYY-MM-DD from order_date, Zoho created_time, or WC date_created. */
export function effectiveOrderDateExpr(sAlias = 's', woAlias = 'wo') {
  return `COALESCE(
    CASE WHEN ${sAlias}.order_date ~ '^\\d{4}-\\d{2}-\\d{2}' THEN LEFT(${sAlias}.order_date, 10) END,
    NULLIF(LEFT(${sAlias}.raw_json::jsonb->>'created_time', 10), ''),
    NULLIF(to_char(${woAlias}.date_created, 'YYYY-MM-DD'), '')
  )`
}

export function effectiveOrderDateFromClause(sAlias, woAlias, paramRef) {
  return `${effectiveOrderDateExpr(sAlias, woAlias)} >= ${paramRef}`
}

export function effectiveOrderDateToClause(sAlias, woAlias, paramRef) {
  return `${effectiveOrderDateExpr(sAlias, woAlias)} <= ${paramRef}`
}

/** Filter sales_orders.order_date (TEXT) without ::date casts on column values. */
export function orderDateFromClause(alias, paramRef) {
  return `LEFT(${alias}.order_date, 10) >= ${paramRef}`
}

export function orderDateToClause(alias, paramRef) {
  return `LEFT(${alias}.order_date, 10) <= ${paramRef}`
}
