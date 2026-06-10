// API base. Local dev: VITE_API_URL is empty → '/api' (Vite proxies to :3001).
// Production (Vercel): set VITE_API_URL to the Render backend URL.
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '') + '/api'

async function req(method, path, body, params) {
  const url = new URL(BASE + path, window.location.origin)
  if (params) Object.entries(params).forEach(([k, v]) => v != null && v !== '' && url.searchParams.set(k, v))
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || data?.error || `HTTP ${res.status}`)
  return data
}

const get  = (path, params) => req('GET',    path, null, params)
const post = (path, body)   => req('POST',   path, body)
const put  = (path, body)   => req('PUT',    path, body)
const del  = (path)         => req('DELETE', path)

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
}

export function fmt(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0)
}

export function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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
