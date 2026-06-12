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

export const ORDER_SCOPES = ['bb', 'so', 'all']

export function parseOrderScope(raw, defaultScope = 'bb') {
  const s = String(raw || defaultScope).toLowerCase()
  return ORDER_SCOPES.includes(s) ? s : defaultScope
}

/** sales_orders prefix filter — null for all Zoho orders. */
export function orderScopeSql(scope, alias = 's') {
  if (scope === 'bb') return `${alias}.salesorder_number ILIKE 'BB%'`
  if (scope === 'so') return `${alias}.salesorder_number ILIKE 'SO%'`
  return null
}
