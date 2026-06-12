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
  const s = String(v)
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (iso) return iso[1]
  const parsed = new Date(s)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

/** Filter sales_orders.order_date (TEXT) without ::date casts on column values. */
export function orderDateFromClause(alias, paramRef) {
  return `LEFT(${alias}.order_date, 10) >= ${paramRef}`
}

export function orderDateToClause(alias, paramRef) {
  return `LEFT(${alias}.order_date, 10) <= ${paramRef}`
}
