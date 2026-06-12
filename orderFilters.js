/** Reversed or never collected — excluded from default order counts and lists. */
export const EXCLUDED_ORDER_STATUSES = ['void', 'cancelled', 'canceled', 'refunded']

export function excludedStatusSql(statusExpr) {
  const list = EXCLUDED_ORDER_STATUSES.map(s => `'${s}'`).join(', ')
  return `LOWER(COALESCE(${statusExpr}, '')) NOT IN (${list})`
}

export function isExcludedStatus(status) {
  return EXCLUDED_ORDER_STATUSES.includes(String(status || '').toLowerCase())
}

/** sales_orders LEFT JOIN wc_orders */
export const ZOHO_ORDER_STATUS_EXCLUDED = excludedStatusSql('COALESCE(wo.status, s.status)')

/** enriched orders row alias */
export function filteredOrderExcluded(alias = 'o') {
  return excludedStatusSql(`${alias}.display_status`)
}
