// API base. Local dev: VITE_API_URL is empty → '/api' (Vite proxies to :3001).
// Production (Vercel): set VITE_API_URL to the Render backend URL.
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '') + '/api'

let accessToken = null
let onUnauthorized = null

export function setApiAccessToken(token) { accessToken = token }
/** AuthProvider registers this so 401 from the API forces sign-out → login screen */
export function setOnUnauthorized(fn) { onUnauthorized = fn }

function authHeaders(extra = {}) {
  const h = { ...extra }
  if (accessToken) h.Authorization = `Bearer ${accessToken}`
  return h
}

async function req(method, path, body, params) {
  const url = new URL(BASE + path, window.location.origin)
  if (params) Object.entries(params).forEach(([k, v]) => v != null && v !== '' && url.searchParams.set(k, v))
  const res = await fetch(url, {
    method,
    headers: authHeaders(body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch {
    const hint = text.trimStart().startsWith('<!')
      ? (import.meta.env.DEV
        ? 'API returned HTML — local backend not running? Run `npm run dev` or set VITE_API_URL in .env to the Render API URL.'
        : 'API returned HTML instead of JSON — hard-refresh the page; if it persists, the backend may still be deploying.')
      : 'Invalid JSON response from API.'
    throw new Error(`${hint} (${res.status} ${path})`)
  }
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized) onUnauthorized()
    if (res.status === 404) {
      throw new Error(
        import.meta.env.DEV
          ? `Endpoint not found (${path}). Restart \`npm run dev\` so the local API on :3001 loads the latest routes.`
          : `Endpoint not found (${path}). The Render API may not be deployed yet — push affiliate-dashboard and wait for deploy, or run locally with \`npm run dev\`.`,
      )
    }
    throw new Error(data?.error?.message || data?.error || `HTTP ${res.status}`)
  }
  return data
}

const get  = (path, params) => req('GET',    path, null, params)
const post = (path, body)   => req('POST',   path, body)
const put  = (path, body)   => req('PUT',    path, body)
const del  = (path)         => req('DELETE', path)

// Absolute URL for a GET endpoint — used for file-download links (e.g. Excel export).
export function apiUrl(path, params) {
  const url = new URL(BASE + path, window.location.origin)
  if (params) Object.entries(params).forEach(([k, v]) => v != null && v !== '' && url.searchParams.set(k, String(v)))
  return url.toString()
}

export const api = {
  // Stats
  stats: () => get('/stats'),

  // Affiliates
  affiliates:       (p) => get('/affiliates', p),
  affiliate:        (id) => get(`/affiliates/${id}`),
  createAffiliate:  (d)  => post('/affiliates', d),
  updateAffiliate:  (id, d) => put(`/affiliates/${id}`, d),
  deleteAffiliate:  (id) => del(`/affiliates/${id}`),

  // Referrals
  referrals:       (p)    => get('/referrals', p),
  referral:        (id)   => get(`/referrals/${id}`),
  updateReferral:  (id, d) => put(`/referrals/${id}`, d),
  deleteReferral:  (id)   => del(`/referrals/${id}`),
  bulkReferrals:   (ids, status) => post('/referrals/bulk', { ids, status }),

  // Payouts
  payouts:       (p)   => get('/payouts', p),
  createPayout:  (d)   => post('/payouts', d),
  deletePayout:  (id)  => del(`/payouts/${id}`),

  // Visits
  visits: (p) => get('/visits', p),

  // Orders (Zoho sales_orders)
  orders: (p) => get('/orders', p),
  orderStatuses: () => get('/orders/statuses'),
  orderWcNotes: (id) => get(`/orders/wc-notes/${id}`),
  ordersWcIds: (p) => get('/orders/wc-ids', p),
  wcBulkUpdate: (d) => post('/orders/wc-bulk-update', d),
  wcUpdateOrder: (id) => post(`/orders/wc-update/${id}`),

  // Coupons
  coupons:       (p)        => get('/coupons', p),
  updateCoupon:  (code, d)  => put('/coupons', { coupon_code: code, ...d }),

  // Creatives (AffiliateWP — usually empty)
  creatives: (p) => get('/creatives', p),

  // Affiliate kit (referral links + coupons + promo text)
  affiliateKit: () => get('/affiliate-kit'),

  // Settings
  settings:       ()  => get('/settings'),
  updateSettings: (d) => put('/settings', d),

  // Materials library (local banners/materials)
  materials:       ()      => get('/materials'),
  createMaterial:  (d)     => post('/materials', d),
  updateMaterial:  (id, d) => put(`/materials/${id}`, d),
  deleteMaterial:  (id)    => del(`/materials/${id}`),

  // Sync
  syncStatus: () => get('/sync/status'),
  runSync:    () => post('/sync/run'),
  runWooSync: () => post('/sync/woo/run'),
  runCouponMapSync: () => post('/sync/coupon-map/run'),

  // WooCommerce catalog (Supabase)
  wooCoupons: (p) => get('/woocommerce/coupons', p),

  // Zoho Price History (read-only consumption of external capture tables)
  zohoDaily:     (p) => get('/zoho-price-history/daily', p),
  zohoPeriods:   (p) => get('/zoho-price-history/daily', p), // legacy alias
  zohoSnapshots: (p) => get('/zoho-price-history/snapshots', p),
  zohoRuns:      (p) => get('/zoho-price-history/runs', p),
  zohoExportUrl: (kind, p) => apiUrl(`/zoho-price-history/${kind}/export`, p),

  // Sales Tax estimator
  taxProviders: () => get('/tax/providers'),
  taxStates:   () => get('/tax/states'),
  taxEstimate: (d) => post('/tax/estimate', d),
  taxOrders:   (p) => get('/tax/orders', p),
  taxSaveOverride: (orderNumber, d) => put(`/tax/overrides/${encodeURIComponent(orderNumber)}`, d),
  taxClearOverride: (orderNumber) => del(`/tax/overrides/${encodeURIComponent(orderNumber)}`),

  completePasswordSetup: () => post('/auth/password-setup-complete'),
}

/** Download a protected GET endpoint (e.g. Excel export) with the current session token. */
export async function downloadApi(path, params, filename = 'export.xlsx') {
  const url = new URL(BASE + path, window.location.origin)
  if (params) Object.entries(params).forEach(([k, v]) => v != null && v !== '' && url.searchParams.set(k, String(v)))
  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) {
    const text = await res.text()
    let msg = `HTTP ${res.status}`
    try { msg = JSON.parse(text).error || msg } catch { /* ignore */ }
    throw new Error(msg)
  }
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(a.href)
}

export function fmt(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0)
}

export function fmtDate(d) {
  if (!d) return '—'
  const iso = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const dt = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return String(d)
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtDateTime(d) {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return String(d).slice(0, 16)
  return dt.toLocaleString('en-US', {
    month: 'numeric', day: 'numeric', year: '2-digit',
    hour: 'numeric', minute: '2-digit',
  })
}
