import express from 'express'
import cors from 'cors'
import axios from 'axios'
import { config } from 'dotenv'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { pool, initTables } from './db.js'
import { runSync, lastSync, syncRunning } from './sync.js'
import { runWooSync, lastWooSync, wooSyncRunning } from './wooSync.js'
import { runWooOrderSync } from './wooOrderSync.js'
import { enrichOrderLineItems, enrichWcLineItems } from './orderLineItems.js'
import { refreshWcOrder, refreshWcOrdersBulk, wooConfigured as wooUpdateConfigured } from './wooOrderUpdate.js'
import { runCouponMapSync } from './couponMapSync.js'
import { registerZohoPriceHistory } from './zohoPriceHistory.js'

config()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3001
const SYNC_MS = (parseInt(process.env.SYNC_INTERVAL_MINUTES) || 30) * 60 * 1000

const BASE = 'https://bigbattery.com/wp-json/affwp/v1'
const AUTH = Buffer.from(`${process.env.AFFWP_PUBLIC_KEY}:${process.env.AFFWP_TOKEN}`).toString('base64')

// CORS: allow configured origins (ALLOWED_ORIGINS, comma-separated), any
// *.vercel.app deploy, and non-browser requests. Empty config = allow all.
const ALLOWED = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean)
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true)                  // curl / server-to-server
    const o = origin.replace(/\/+$/, '')
    if (!ALLOWED.length || ALLOWED.includes(o) || /\.vercel\.app$/i.test(o)) return cb(null, true)
    return cb(null, false)
  },
}))
app.use(express.json())

// Health check (used by Render)
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }))

// Zoho Price History — read-only consumption of external capture tables (additive)
registerZohoPriceHistory(app)

// ── AffiliateWP write helper (still calls API for mutations) ─────────────────
async function awp(method, endpoint, params = {}, data = null) {
  const res = await axios({ method, url: `${BASE}${endpoint}`,
    headers: { Authorization: `Basic ${AUTH}`, 'Content-Type': 'application/json' },
    params, data, timeout: 30000,
  })
  return res.data
}

/** Accept ISO (YYYY-MM-DD) or US (M/D/YYYY, MM/DD/YYYY) for order_date filters. */
function normalizeDateParam(raw) {
  if (raw == null || raw === '') return null
  const t = String(raw).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const us = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (us) {
    const [, m, d, y] = us
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  const parsed = new Date(t)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10)
  }
  return null
}

function handle(fn) {
  return async (req, res) => {
    try { res.json(await fn(req)) }
    catch (e) {
      const msg = e.response?.data || e.message || String(e)
      console.error(e.config?.url || e.message, msg)
      res.status(e.response?.status || 500).json({ error: msg })
    }
  }
}

// ── SYNC STATUS ──────────────────────────────────────────────────────────────
app.get('/api/sync/status', async (_req, res) => {
  try {
    const [awp, woo] = await Promise.all([
      pool.query(`SELECT * FROM awp_sync_log ORDER BY id DESC LIMIT 5`),
      pool.query(`SELECT * FROM wc_sync_log ORDER BY id DESC LIMIT 5`),
    ])
    res.json({
      running: syncRunning,
      last: lastSync,
      log: awp.rows,
      woo: { running: wooSyncRunning, last: lastWooSync, log: woo.rows },
    })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/sync/run', async (_req, res) => {
  if (syncRunning) return res.json({ message: 'Sync already running' })
  runSync().catch(console.error)
  res.json({ message: 'Sync started' })
})

app.post('/api/sync/woo/run', async (_req, res) => {
  if (wooSyncRunning) return res.json({ message: 'WooCommerce sync already running' })
  runWooSync().catch(console.error)
  res.json({ message: 'WooCommerce sync started (coupons + order IDs)' })
})

app.post('/api/sync/woo/orders/run', handle(async () => runWooOrderSync()))

app.post('/api/sync/coupon-map/run', handle(async () => {
  couponCache = null
  return runCouponMapSync()
}))

app.get('/api/woocommerce/coupons', handle(async req => {
  const { status, search, number = 200, offset = 0 } = req.query
  let q = `SELECT * FROM wc_coupons`
  const vals = []
  const clauses = []
  if (status) { vals.push(status); clauses.push(`status = $${vals.length}`) }
  if (search) {
    vals.push(`%${search}%`)
    clauses.push(`(code ILIKE $${vals.length} OR description ILIKE $${vals.length})`)
  }
  if (clauses.length) q += ' WHERE ' + clauses.join(' AND ')
  q += ` ORDER BY code_normalized LIMIT $${vals.push(number)} OFFSET $${vals.push(offset)}`
  const { rows } = await pool.query(q, vals)
  const { rows: [countRow] } = await pool.query(`SELECT COUNT(*)::int AS total FROM wc_coupons`)
  return { items: rows, total: countRow.total, source: 'woocommerce' }
}))

// ── AFFILIATES (read from Supabase) ─────────────────────────────────────────
app.get('/api/affiliates', handle(async req => {
  const { status, search, number = 100, offset = 0 } = req.query
  let q = `SELECT * FROM awp_affiliates`
  const vals = []
  const clauses = []
  if (status) { vals.push(status); clauses.push(`status = $${vals.length}`) }
  if (search) { vals.push(`%${search}%`); clauses.push(`(username ILIKE $${vals.length} OR email ILIKE $${vals.length} OR display_name ILIKE $${vals.length})`) }
  if (clauses.length) q += ' WHERE ' + clauses.join(' AND ')
  q += ` ORDER BY earnings DESC LIMIT $${vals.push(number)} OFFSET $${vals.push(offset)}`
  const { rows } = await pool.query(q, vals)
  return rows
}))

app.get('/api/affiliates/:id', handle(async req => {
  const { rows } = await pool.query(
    `SELECT * FROM awp_affiliates WHERE affiliate_id = $1`, [req.params.id]
  )
  if (!rows.length) return awp('GET', `/affiliates/${req.params.id}`)
  return rows[0]
}))

// Mutations still go to AffiliateWP, then update Supabase
app.post('/api/affiliates', handle(async req => {
  const result = await awp('POST', '/affiliates', {}, req.body)
  if (result?.affiliate_id) {
    await pool.query(`
      INSERT INTO awp_affiliates (affiliate_id, user_id, status, rate, rate_type, raw, synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,NOW())
      ON CONFLICT (affiliate_id) DO UPDATE SET status=EXCLUDED.status, raw=EXCLUDED.raw, synced_at=NOW()
    `, [result.affiliate_id, result.user_id, result.status, result.rate, result.rate_type, JSON.stringify(result)])
  }
  return result
}))

app.put('/api/affiliates/:id', handle(async req => {
  const result = await awp('PUT', `/affiliates/${req.params.id}`, {}, req.body)
  if (result?.affiliate_id) {
    await pool.query(`
      UPDATE awp_affiliates SET status=$1, rate=$2, rate_type=$3,
        payment_email=$4, raw=$5, synced_at=NOW()
      WHERE affiliate_id=$6
    `, [result.status, result.rate, result.rate_type, result.payment_email, JSON.stringify(result), result.affiliate_id])
  }
  return result
}))

app.delete('/api/affiliates/:id', handle(async req => {
  const result = await awp('DELETE', `/affiliates/${req.params.id}`, { remove_data: req.query.remove_data || false })
  await pool.query(`DELETE FROM awp_affiliates WHERE affiliate_id=$1`, [req.params.id])
  return result
}))

// ── REFERRALS (read from Supabase) ──────────────────────────────────────────
app.get('/api/referrals', handle(async req => {
  const { number = 50, offset = 0, status, affiliate_id, date, end_date, reference, orderby = 'date', order = 'DESC' } = req.query
  const vals = []
  const clauses = []
  if (status)       { vals.push(status);       clauses.push(`status = $${vals.length}`) }
  if (affiliate_id) { vals.push(affiliate_id); clauses.push(`affiliate_id = $${vals.length}`) }
  if (reference)    { vals.push(`%${reference}%`); clauses.push(`reference ILIKE $${vals.length}`) }
  if (date)         { vals.push(date);         clauses.push(`date >= $${vals.length}`) }
  if (end_date)     { vals.push(end_date);     clauses.push(`date <= $${vals.length}`) }

  const safeOrder = order?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
  const safeOrderby = ['referral_id','date','amount','affiliate_id','status'].includes(orderby) ? orderby : 'date'
  let q = `SELECT * FROM awp_referrals`
  if (clauses.length) q += ' WHERE ' + clauses.join(' AND ')
  q += ` ORDER BY ${safeOrderby} ${safeOrder} LIMIT $${vals.push(number)} OFFSET $${vals.push(offset)}`
  const { rows } = await pool.query(q, vals)
  return rows
}))

app.get('/api/referrals/:id', handle(async req => {
  const { rows } = await pool.query(`SELECT * FROM awp_referrals WHERE referral_id=$1`, [req.params.id])
  if (!rows.length) return awp('GET', `/referrals/${req.params.id}`)
  return rows[0]
}))

app.put('/api/referrals/:id', handle(async req => {
  const result = await awp('PUT', `/referrals/${req.params.id}`, {}, req.body)
  if (result?.referral_id) {
    await pool.query(`
      UPDATE awp_referrals SET status=$1, amount=$2, raw=$3, synced_at=NOW()
      WHERE referral_id=$4
    `, [result.status, parseFloat(result.amount || 0), JSON.stringify(result), result.referral_id])
  }
  return result
}))

app.delete('/api/referrals/:id', handle(async req => {
  const result = await awp('DELETE', `/referrals/${req.params.id}`)
  await pool.query(`DELETE FROM awp_referrals WHERE referral_id=$1`, [req.params.id])
  return result
}))

app.post('/api/referrals/bulk', handle(async req => {
  const { ids, status } = req.body
  const results = await Promise.allSettled(ids.map(id => awp('PUT', `/referrals/${id}`, {}, { status })))
  const updated = results.filter(r => r.status === 'fulfilled').length
  // Update Supabase for successful ones
  const succeeded = ids.filter((_, i) => results[i].status === 'fulfilled')
  if (succeeded.length) {
    await pool.query(
      `UPDATE awp_referrals SET status=$1, synced_at=NOW() WHERE referral_id = ANY($2::int[])`,
      [status, succeeded]
    )
  }
  return { updated, failed: results.length - updated }
}))

// ── PAYOUTS (read from Supabase) ─────────────────────────────────────────────
app.get('/api/payouts', handle(async req => {
  const { number = 50, offset = 0, affiliate_id, status, payout_method, date, end_date } = req.query
  const vals = []
  const clauses = []
  if (affiliate_id)  { vals.push(affiliate_id);  clauses.push(`affiliate_id = $${vals.length}`) }
  if (status)        { vals.push(status);        clauses.push(`status = $${vals.length}`) }
  if (payout_method) { vals.push(payout_method); clauses.push(`payout_method = $${vals.length}`) }
  if (date)          { vals.push(date);          clauses.push(`date >= $${vals.length}`) }
  if (end_date)      { vals.push(end_date);      clauses.push(`date <= $${vals.length}`) }
  let q = `SELECT * FROM awp_payouts`
  if (clauses.length) q += ' WHERE ' + clauses.join(' AND ')
  q += ` ORDER BY date DESC LIMIT $${vals.push(number)} OFFSET $${vals.push(offset)}`
  const { rows } = await pool.query(q, vals)
  return rows
}))

app.post('/api/payouts', handle(async req => {
  const result = await awp('POST', '/payouts', {}, req.body)
  if (result?.payout_id) {
    await pool.query(`
      INSERT INTO awp_payouts (payout_id, affiliate_id, referrals, amount, currency, status, payout_method, date, raw, synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
      ON CONFLICT (payout_id) DO UPDATE SET amount=EXCLUDED.amount, status=EXCLUDED.status, raw=EXCLUDED.raw, synced_at=NOW()
    `, [result.payout_id, result.affiliate_id, JSON.stringify(result.referrals || []),
        parseFloat(result.amount || 0), result.currency || 'USD', result.status,
        result.payout_method || null, result.date || null, JSON.stringify(result)])
  }
  return result
}))

app.delete('/api/payouts/:id', handle(async req => {
  const result = await awp('DELETE', `/payouts/${req.params.id}`)
  await pool.query(`DELETE FROM awp_payouts WHERE payout_id=$1`, [req.params.id])
  return result
}))

// ── VISITS (read from Supabase) ──────────────────────────────────────────────
app.get('/api/visits', handle(async req => {
  const { number = 50, offset = 0, affiliate_id, date, end_date } = req.query
  const vals = []
  const clauses = []
  if (affiliate_id) { vals.push(affiliate_id); clauses.push(`affiliate_id = $${vals.length}`) }
  if (date)         { vals.push(date);         clauses.push(`date >= $${vals.length}`) }
  if (end_date)     { vals.push(end_date);     clauses.push(`date <= $${vals.length}`) }
  let q = `SELECT * FROM awp_visits`
  if (clauses.length) q += ' WHERE ' + clauses.join(' AND ')
  q += ` ORDER BY date DESC LIMIT $${vals.push(number)} OFFSET $${vals.push(offset)}`
  const { rows } = await pool.query(q, vals)
  return rows
}))

// ── ORDERS (Zoho sales_orders in Supabase) ───────────────────────────────────
// SO- = Zoho B2B/quote orders · BB = web/WooCommerce orders · affiliate split by WC link
const COUPON_EXPR = `LOWER(TRIM(s.raw_json::jsonb->'custom_field_hash'->>'cf_coupon_s'))`
const VALID_COUPON = `NULLIF(${COUPON_EXPR}, '') IS NOT NULL AND ${COUPON_EXPR} NOT IN ('.','-','n/a','na','none')`
const LINE_ITEMS_JSON = `COALESCE(s.raw_json::jsonb->'line_items', '[]'::jsonb)`
const PRODUCT_LINE_FILTER = `
  COALESCE(li->>'name', '') <> 'Shipping Charge'
  AND COALESCE(li->>'line_item_type', '') <> 'service'
  AND NOT COALESCE((li->>'is_component')::boolean, false)
`
const netSalesSql = (jsonRef) => `(
  SELECT COALESCE(SUM((li->>'item_total')::numeric), 0)
  FROM jsonb_array_elements(COALESCE(${jsonRef}::jsonb->'line_items', '[]'::jsonb)) AS li
  WHERE ${PRODUCT_LINE_FILTER}
)`
const itemsSoldSql = (jsonRef) => `(
  SELECT COALESCE(SUM((li->>'quantity')::numeric), 0)::int
  FROM jsonb_array_elements(COALESCE(${jsonRef}::jsonb->'line_items', '[]'::jsonb)) AS li
  WHERE ${PRODUCT_LINE_FILTER}
)`
const NET_SALES_EXPR = netSalesSql('s.raw_json')
const ITEMS_SOLD_EXPR = itemsSoldSql('s.raw_json')

const ORDER_SEGMENT_EXPR = `
  CASE
    WHEN ${VALID_COUPON} AND m.affiliate_id IS NOT NULL AND m.kind = 'affiliate'
      THEN 'wc_affiliate'
    WHEN ${VALID_COUPON} AND m.kind = 'affiliate'
      THEN 'zoho_affiliate'
    WHEN s.salesorder_number ILIKE 'BB%'
      THEN 'bb'
    WHEN s.salesorder_number ILIKE 'SO%'
      THEN 'so'
    ELSE 'other'
  END
`

app.get('/api/orders/statuses', handle(async () => {
  const { rows } = await pool.query(`
    SELECT DISTINCT COALESCE(wo.status, s.status) AS status
    FROM sales_orders s
    LEFT JOIN wc_orders wo ON wo.order_number_norm = UPPER(TRIM(s.salesorder_number))
    WHERE COALESCE(wo.status, s.status) IS NOT NULL
      AND TRIM(COALESCE(wo.status, s.status)) <> ''
    ORDER BY status
  `)
  return rows.map(r => r.status)
}))

function presentOrder(row) {
  const lineEnrich = enrichOrderLineItems(row.line_items)
  const { line_items, ...rest } = row
  return {
    ...rest,
    ...lineEnrich,
    status: row.display_status || row.status,
  }
}

function presentWcOnlyOrder(row) {
  const fromRaw = row.raw?.line_items ? enrichWcLineItems(row.raw.line_items) : {}
  return {
    salesorder_id: `wc-${row.order_id}`,
    salesorder_number: row.order_number,
    order_date: row.date_created ? String(row.date_created).slice(0, 10) : null,
    order_datetime: row.date_created,
    reference_number: null,
    customer_name: row.customer_name,
    sub_total: row.sub_total,
    total: row.total,
    status: row.status,
    display_status: row.status,
    wc_order_id: row.order_id,
    coupon_code: row.coupon_code,
    affiliate_name: row.affiliate_name,
    affiliate_email: row.affiliate_email,
    affiliate_id: row.affiliate_id,
    coupon_kind: row.coupon_kind,
    est_commission: row.est_commission != null ? parseFloat(row.est_commission) : null,
    net_sales: row.net_sales != null ? parseFloat(row.net_sales) : fromRaw.net_sales,
    items_sold: row.items_sold ?? fromRaw.items_sold,
    products_text: fromRaw.products_text,
    segment: 'wc_only',
    order_source: 'woocommerce_only',
  }
}

const WC_ONLY_BASE = `
  WITH wc_unsynced AS (
    SELECT wo.*
    FROM wc_orders wo
    WHERE NOT EXISTS (
      SELECT 1 FROM sales_orders s
      WHERE UPPER(TRIM(s.salesorder_number)) = wo.order_number_norm
    )
  ),
  enriched AS (
    SELECT
      w.order_id,
      w.order_number,
      w.order_number_norm,
      w.status,
      w.date_created,
      w.customer_name,
      w.total,
      w.sub_total,
      w.coupon_code,
      w.net_sales,
      w.items_sold,
      w.raw,
      w.status AS display_status,
      m.affiliate_name,
      COALESCE(NULLIF(TRIM(m.affiliate_email), ''), NULLIF(TRIM(a.payment_email), ''), NULLIF(TRIM(a.email), '')) AS affiliate_email,
      m.affiliate_id,
      m.kind AS coupon_kind,
      m.rate AS coupon_rate,
      CASE WHEN m.affiliate_id IS NOT NULL AND m.kind = 'affiliate' AND m.rate IS NOT NULL AND w.net_sales IS NOT NULL
           THEN ROUND((w.net_sales * m.rate / 100.0)::numeric, 2) END AS est_commission
    FROM wc_unsynced w
    LEFT JOIN coupon_map m ON m.coupon_code = LOWER(TRIM(w.coupon_code))
    LEFT JOIN awp_affiliates a ON a.affiliate_id = m.affiliate_id
  ),
  filtered AS (SELECT * FROM enriched o)
`

async function queryWcOnlyOrders(req) {
  const {
    number = 50, offset = 0, search, status, coupon, order = 'DESC',
    date_from, date_to, affiliate_id,
  } = req.query

  const vals = []
  const clauses = []

  if (status) {
    vals.push(status)
    clauses.push(`o.display_status = $${vals.length}`)
  }
  if (search) {
    vals.push(`%${search}%`)
    clauses.push(`(
      o.order_number ILIKE $${vals.length}
      OR o.customer_name ILIKE $${vals.length}
      OR o.coupon_code ILIKE $${vals.length}
    )`)
  }
  if (coupon === 'yes' || coupon === 'true') {
    clauses.push(`o.coupon_code IS NOT NULL`)
  } else if (coupon) {
    vals.push(String(coupon).toLowerCase().trim())
    clauses.push(`o.coupon_code = $${vals.length}`)
  }
  const fromDate = normalizeDateParam(date_from)
  if (fromDate) {
    vals.push(fromDate)
    clauses.push(`o.date_created::date >= $${vals.length}::date`)
  }
  const toDate = normalizeDateParam(date_to)
  if (toDate) {
    vals.push(toDate)
    clauses.push(`o.date_created::date <= $${vals.length}::date`)
  }
  if (affiliate_id) {
    vals.push(parseInt(affiliate_id, 10))
    clauses.push(`o.affiliate_id = $${vals.length}`)
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const sortDir = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
  const baseCte = WC_ONLY_BASE.replace(
    'filtered AS (SELECT * FROM enriched o)',
    `filtered AS (SELECT * FROM enriched o ${where})`,
  )
  const filterVals = [...vals]
  const pageVals = [...vals, number, offset]

  const [{ rows }, { rows: [countRow] }, { rows: [sumRow] }, { rows: [wcOnlyRow] }] = await Promise.all([
    pool.query(`
      ${baseCte}
      SELECT * FROM filtered o
      ORDER BY o.date_created ${sortDir} NULLS LAST, o.order_number ${sortDir}
      LIMIT $${filterVals.length + 1} OFFSET $${filterVals.length + 2}
    `, pageVals),
    pool.query(`${baseCte} SELECT COUNT(*)::int AS total FROM filtered`, filterVals),
    pool.query(`
      ${baseCte}
      SELECT
        COUNT(*)::int AS filtered_orders,
        COUNT(*) FILTER (WHERE o.coupon_code IS NOT NULL)::int AS with_coupon,
        COALESCE(SUM(o.total), 0) AS total_revenue,
        COALESCE(SUM(o.sub_total), 0) AS total_subtotal,
        COALESCE(SUM(o.net_sales), 0) AS total_net_sales,
        COALESCE(SUM(o.items_sold), 0)::int AS total_items_sold,
        COALESCE(SUM(o.est_commission), 0) AS est_commission
      FROM filtered o
    `, filterVals),
    pool.query(`
      SELECT COUNT(*)::int AS n FROM wc_orders wo
      WHERE NOT EXISTS (
        SELECT 1 FROM sales_orders s
        WHERE UPPER(TRIM(s.salesorder_number)) = wo.order_number_norm
      )
    `),
  ])

  return {
    items: rows.map(presentWcOnlyOrder),
    total: countRow.total,
    summary: {
      filtered_orders: sumRow.filtered_orders,
      with_coupon: sumRow.with_coupon,
      total_revenue: parseFloat(sumRow.total_revenue),
      total_subtotal: parseFloat(sumRow.total_subtotal),
      total_net_sales: parseFloat(sumRow.total_net_sales),
      total_items_sold: sumRow.total_items_sold,
      est_commission: parseFloat(sumRow.est_commission),
      wc_only: wcOnlyRow.n,
    },
    source: 'woocommerce_only',
  }
}

async function wcOnlyCount() {
  const { rows: [row] } = await pool.query(`
    SELECT COUNT(*)::int AS n FROM wc_orders wo
    WHERE NOT EXISTS (
      SELECT 1 FROM sales_orders s
      WHERE UPPER(TRIM(s.salesorder_number)) = wo.order_number_norm
    )
  `)
  return row?.n || 0
}

app.get('/api/orders', handle(async req => {
  if (req.query.segment === 'wc_only') {
    return queryWcOnlyOrders(req)
  }

  const {
    number = 50, offset = 0, search, status, coupon, segment,
    date_from, date_to, has_coupon, order = 'DESC', affiliate_id,
  } = req.query

  const vals = []
  const clauses = []

  if (status) {
    vals.push(status)
    clauses.push(`o.display_status = $${vals.length}`)
  }
  if (search) {
    vals.push(`%${search}%`)
    clauses.push(`(
      o.salesorder_number ILIKE $${vals.length}
      OR o.customer_name ILIKE $${vals.length}
      OR o.reference_number ILIKE $${vals.length}
      OR o.coupon_code ILIKE $${vals.length}
    )`)
  }
  if (coupon === 'yes' || coupon === 'true') {
    clauses.push(`o.coupon_code IS NOT NULL`)
  } else if (coupon) {
    vals.push(String(coupon).toLowerCase().trim())
    clauses.push(`o.coupon_code = $${vals.length}`)
  }
  if (segment === 'affiliate_coupon') {
    clauses.push(`o.segment IN ('wc_affiliate', 'zoho_affiliate')`)
  } else if (segment) {
    vals.push(segment)
    clauses.push(`o.segment = $${vals.length}`)
  }
  const fromDate = normalizeDateParam(date_from)
  if (fromDate) {
    vals.push(fromDate)
    clauses.push(`o.order_date::date >= $${vals.length}::date`)
  }
  const toDate = normalizeDateParam(date_to)
  if (toDate) {
    vals.push(toDate)
    clauses.push(`o.order_date::date <= $${vals.length}::date`)
  }
  if (has_coupon === 'true') {
    clauses.push(`o.coupon_code IS NOT NULL`)
  } else if (has_coupon === 'false') {
    clauses.push(`o.coupon_code IS NULL`)
  }
  if (affiliate_id) {
    vals.push(parseInt(affiliate_id, 10))
    clauses.push(`o.affiliate_id = $${vals.length}`)
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const sortDir = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC'

  const baseCte = `
    WITH customer_first AS (
      SELECT salesorder_id,
        ROW_NUMBER() OVER (
          PARTITION BY customer_id
          ORDER BY order_date ASC NULLS LAST, salesorder_id ASC
        ) = 1 AS is_new_customer
      FROM sales_orders
      WHERE customer_id IS NOT NULL AND TRIM(customer_id) <> ''
    ),
    enriched AS (
      SELECT
        s.salesorder_id,
        s.salesorder_number,
        s.order_date,
        s.reference_number,
        s.status AS zoho_status,
        COALESCE(wo.status, s.status) AS display_status,
        s.customer_name,
        s.customer_id,
        s.salesperson_name,
        s.sub_total,
        s.total,
        s.shipping_charge,
        s.last_modified_time,
        COALESCE(NULLIF(TRIM(s.raw_json::jsonb->>'created_time'), ''), s.order_date::text) AS order_datetime,
        ${LINE_ITEMS_JSON} AS line_items,
        ${NET_SALES_EXPR} AS net_sales,
        ${ITEMS_SOLD_EXPR} AS items_sold,
        CASE
          WHEN cf.is_new_customer THEN 'new'
          WHEN s.customer_id IS NOT NULL AND TRIM(s.customer_id) <> '' THEN 'returning'
        END AS customer_type,
        wo.order_id AS wc_order_id,
        NULLIF(${COUPON_EXPR}, '') AS coupon_code,
        m.affiliate_name,
        COALESCE(NULLIF(TRIM(m.affiliate_email), ''), NULLIF(TRIM(a.payment_email), ''), NULLIF(TRIM(a.email), '')) AS affiliate_email,
        m.affiliate_id,
        m.kind AS coupon_kind,
        m.rate AS coupon_rate,
        ${ORDER_SEGMENT_EXPR} AS segment,
        CASE
          WHEN ${VALID_COUPON} AND m.affiliate_id IS NOT NULL AND m.kind = 'affiliate' THEN 'woocommerce'
          WHEN ${VALID_COUPON} AND m.kind = 'affiliate' THEN 'zoho'
        END AS affiliate_source,
        CASE WHEN m.affiliate_id IS NOT NULL AND m.kind = 'affiliate' AND m.rate IS NOT NULL
             THEN ROUND(((${NET_SALES_EXPR}) * m.rate / 100.0)::numeric, 2) END AS est_commission
      FROM sales_orders s
      LEFT JOIN wc_orders wo ON wo.order_number_norm = UPPER(TRIM(s.salesorder_number))
      LEFT JOIN coupon_map m ON m.coupon_code = ${COUPON_EXPR}
      LEFT JOIN awp_affiliates a ON a.affiliate_id = m.affiliate_id
      LEFT JOIN customer_first cf ON cf.salesorder_id = s.salesorder_id
    ),
    filtered AS (SELECT * FROM enriched o ${where})
  `

  const filterVals = [...vals]
  const pageVals = [...vals, number, offset]

  const affiliateSort = segment === 'affiliate_coupon'
    ? `CASE o.segment WHEN 'wc_affiliate' THEN 0 WHEN 'zoho_affiliate' THEN 1 ELSE 2 END, `
    : ''

  const [{ rows }, { rows: [countRow] }, { rows: [sumRow] }, { rows: segRows }, wcOnlyTotal] = await Promise.all([
    pool.query(`
      ${baseCte}
      SELECT * FROM filtered o
      ORDER BY ${affiliateSort}o.order_date ${sortDir} NULLS LAST, o.salesorder_number ${sortDir}
      LIMIT $${filterVals.length + 1} OFFSET $${filterVals.length + 2}
    `, pageVals),
    pool.query(`${baseCte} SELECT COUNT(*)::int AS total FROM filtered`, filterVals),
    pool.query(`
      ${baseCte}
      SELECT
        COUNT(*)::int AS filtered_orders,
        COUNT(*) FILTER (WHERE o.coupon_code IS NOT NULL)::int AS with_coupon,
        COALESCE(SUM(o.total), 0) AS total_revenue,
        COALESCE(SUM(o.sub_total), 0) AS total_subtotal,
        COALESCE(SUM(o.net_sales), 0) AS total_net_sales,
        COALESCE(SUM(o.items_sold), 0)::int AS total_items_sold,
        COALESCE(SUM(o.est_commission), 0) AS est_commission
      FROM filtered o
    `, filterVals),
    pool.query(`
      WITH enriched AS (
        SELECT ${ORDER_SEGMENT_EXPR} AS segment
        FROM sales_orders s
        LEFT JOIN coupon_map m ON m.coupon_code = ${COUPON_EXPR}
      )
      SELECT segment, COUNT(*)::int AS n
      FROM enriched
      GROUP BY segment
    `),
    wcOnlyCount(),
  ])

  const segments = Object.fromEntries(segRows.map(r => [r.segment, r.n]))

  return {
    items: rows.map(presentOrder),
    total: countRow.total,
    summary: {
      filtered_orders: sumRow.filtered_orders,
      with_coupon:     sumRow.with_coupon,
      total_revenue:   parseFloat(sumRow.total_revenue),
      total_subtotal:  parseFloat(sumRow.total_subtotal),
      total_net_sales: parseFloat(sumRow.total_net_sales),
      total_items_sold: sumRow.total_items_sold,
      est_commission:  parseFloat(sumRow.est_commission),
      so:              segments.so || 0,
      bb:              segments.bb || 0,
      wc_affiliate:    segments.wc_affiliate || 0,
      zoho_affiliate:  segments.zoho_affiliate || 0,
      affiliate_coupon: (segments.wc_affiliate || 0) + (segments.zoho_affiliate || 0),
      other:           segments.other || 0,
      wc_only:         wcOnlyTotal,
    },
    source: 'zoho_sales_orders',
  }
}))

// WC order IDs for affiliate-coupon orders (bulk Update in WooCommerce admin)
app.get('/api/orders/wc-ids', handle(async req => {
  const { segment = 'wc_affiliate' } = req.query
  let segmentClause = ''
  if (segment === 'wc_affiliate') {
    segmentClause = `AND ${VALID_COUPON} AND m.affiliate_id IS NOT NULL AND m.kind = 'affiliate'`
  } else if (segment === 'affiliate_coupon') {
    segmentClause = `AND ${VALID_COUPON} AND m.kind = 'affiliate'`
  } else if (segment === 'bb') {
    segmentClause = `AND s.salesorder_number ILIKE 'BB%'`
  }

  const { rows } = await pool.query(`
    SELECT DISTINCT wo.order_id AS wc_order_id, s.salesorder_number,
      NULLIF(${COUPON_EXPR}, '') AS coupon_code
    FROM sales_orders s
    JOIN wc_orders wo ON wo.order_number_norm = UPPER(TRIM(s.salesorder_number))
    LEFT JOIN coupon_map m ON m.coupon_code = ${COUPON_EXPR}
    WHERE wo.order_id IS NOT NULL ${segmentClause}
    ORDER BY wo.order_id DESC
  `)

  return {
    ids: rows.map(r => r.wc_order_id),
    items: rows,
    total: rows.length,
  }
}))

// Re-save WC orders (same effect as opening wp-admin edit page and clicking Update)
app.post('/api/orders/wc-bulk-update', handle(async req => {
  if (!wooUpdateConfigured()) {
    throw new Error('WooCommerce API credentials not configured on server')
  }

  let ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : []
  if (!ids.length && req.body?.segment) {
    const list = await pool.query(`
      SELECT DISTINCT wo.order_id AS wc_order_id
      FROM sales_orders s
      JOIN wc_orders wo ON wo.order_number_norm = UPPER(TRIM(s.salesorder_number))
      LEFT JOIN coupon_map m ON m.coupon_code = ${COUPON_EXPR}
      WHERE wo.order_id IS NOT NULL
        AND ${VALID_COUPON} AND m.affiliate_id IS NOT NULL AND m.kind = 'affiliate'
      ORDER BY wo.order_id DESC
      LIMIT $1
    `, [Math.min(parseInt(req.body.limit, 10) || 500, 500)])
    ids = list.rows.map(r => r.wc_order_id)
  }

  if (!ids.length) return { ok: [], failed: [], message: 'No WooCommerce order IDs to update' }
  if (ids.length > 25) {
    throw new Error('Send at most 25 order IDs per request — call in batches from the UI')
  }

  return refreshWcOrdersBulk(ids)
}))

app.post('/api/orders/wc-update/:id', handle(async req => {
  if (!wooUpdateConfigured()) {
    throw new Error('WooCommerce API credentials not configured on server')
  }
  const id = parseInt(req.params.id, 10)
  if (!id) throw new Error('Invalid WC order ID')
  return refreshWcOrder(id)
}))

// ── COUPONS / CREATIVES (live proxy — graceful on "not available"/"empty") ──
// AffiliateWP on bigbattery.com does not register the /coupons REST route
// (rest_no_route) and has no creatives (no_creatives). Treat those as empty
// results with an explanatory note instead of surfacing a raw error.
const SOFT_404 = ['rest_no_route', 'no_creatives', 'no_coupons', 'no_referrals', 'no_visits']
async function awpSoft(endpoint, params, note) {
  try {
    const data = await awp('GET', endpoint, params)
    return Array.isArray(data) ? { items: data, available: true } : { items: [], available: true }
  } catch (e) {
    const code = e.response?.data?.code
    if (e.response?.status === 404 || SOFT_404.includes(code)) {
      return { items: [], available: false, note }
    }
    throw e
  }
}

// COUPONS — real usage aggregated from Zoho sales_orders (cf_coupon_s custom
// field), joined to the editable coupon_map classification. AffiliateWP does
// not expose coupons, but the order data does — this is the source of truth.
let couponCache = null
const COUPON_TTL = 5 * 60 * 1000

app.get('/api/coupons', handle(async () => {
  if (couponCache && Date.now() - couponCache.ts < COUPON_TTL) return couponCache.data

  const { rows } = await pool.query(`
    WITH usage AS (
      SELECT
        LOWER(TRIM(raw_json::jsonb->'custom_field_hash'->>'cf_coupon_s')) AS coupon,
        COUNT(*)                                       AS orders,
        COALESCE(SUM(total), 0)                        AS revenue,
        COALESCE(SUM(sub_total), 0)                    AS subtotal,
        COALESCE(SUM((${netSalesSql('raw_json')})::numeric), 0) AS net_sales,
        MIN(raw_json::jsonb->>'date')                  AS first_order,
        MAX(raw_json::jsonb->>'date')                  AS last_order
      FROM sales_orders
      WHERE NULLIF(TRIM(raw_json::jsonb->'custom_field_hash'->>'cf_coupon_s'),'') IS NOT NULL
        AND LOWER(TRIM(raw_json::jsonb->'custom_field_hash'->>'cf_coupon_s'))
            NOT IN ('.', '-', 'n/a', 'na', 'none')
      GROUP BY 1
    ),
    catalog AS (
      SELECT code_normalized AS coupon, code AS wc_code, coupon_id, status AS wc_status,
             discount_type, amount AS discount_amount, description AS wc_description,
             usage_count AS wc_usage_count, usage_limit, date_expires, date_created AS wc_created
      FROM wc_coupons
    ),
    codes AS (
      SELECT coupon FROM usage
      UNION
      SELECT coupon FROM catalog
    )
    SELECT
      c.coupon AS coupon_code,
      COALESCE(u.orders, 0) AS orders,
      COALESCE(u.revenue, 0) AS revenue,
      COALESCE(u.subtotal, 0) AS subtotal,
      u.first_order, u.last_order,
      cat.wc_code, cat.coupon_id, cat.wc_status, cat.discount_type, cat.discount_amount,
      cat.wc_description, cat.wc_usage_count, cat.usage_limit, cat.date_expires, cat.wc_created,
      COALESCE(m.kind, 'unclassified') AS kind,
      m.affiliate_name, m.affiliate_email, m.affiliate_id, m.rate,
      COALESCE(m.confirmed, false) AS confirmed, m.notes,
      CASE
        WHEN cat.coupon IS NOT NULL AND m.affiliate_id IS NOT NULL AND m.kind = 'affiliate'
          THEN 'wc_linked'
        WHEN cat.coupon IS NOT NULL AND m.kind = 'affiliate'
          THEN 'wc_unlinked'
        WHEN cat.coupon IS NOT NULL AND m.kind = 'promo'
          THEN 'wc_promo'
        WHEN cat.coupon IS NULL AND u.coupon IS NOT NULL
          THEN 'zoho_only'
        ELSE 'other'
      END AS segment,
      CASE WHEN m.affiliate_id IS NOT NULL AND m.kind = 'affiliate' AND m.rate IS NOT NULL
           THEN ROUND((COALESCE(u.net_sales, 0) * m.rate / 100.0)::numeric, 2) END AS est_commission,
      (cat.coupon IS NOT NULL) AS in_woocommerce,
      (u.coupon IS NOT NULL) AS in_zoho_orders
    FROM codes c
    LEFT JOIN usage u ON u.coupon = c.coupon
    LEFT JOIN catalog cat ON cat.coupon = c.coupon
    LEFT JOIN coupon_map m ON m.coupon_code = c.coupon
    ORDER BY COALESCE(u.revenue, 0) DESC NULLS LAST, cat.wc_code ASC NULLS LAST
  `)

  const { rows: [wcCount] } = await pool.query(`SELECT COUNT(*)::int AS n FROM wc_coupons`)

  const bySeg = seg => rows.filter(r => r.segment === seg)
  const summary = {
    total_codes:       rows.length,
    woocommerce_codes: wcCount.n,
    wc_linked:         bySeg('wc_linked').length,
    wc_unlinked:       bySeg('wc_unlinked').length,
    wc_promo:          bySeg('wc_promo').length,
    zoho_only:         bySeg('zoho_only').length,
    affiliate_codes:   rows.filter(r => r.kind === 'affiliate').length,
    promo_codes:       rows.filter(r => r.kind === 'promo').length,
    unclassified:      rows.filter(r => r.kind === 'unclassified').length,
    unused_in_zoho:    rows.filter(r => r.in_woocommerce && !r.in_zoho_orders).length,
    total_orders:      rows.reduce((s, r) => s + Number(r.orders), 0),
    total_revenue:     rows.reduce((s, r) => s + Number(r.revenue || 0), 0),
    linked_revenue:    bySeg('wc_linked').reduce((s, r) => s + Number(r.revenue || 0), 0),
    zoho_only_revenue: bySeg('zoho_only').reduce((s, r) => s + Number(r.revenue || 0), 0),
    est_commission:    bySeg('wc_linked').reduce((s, r) => s + Number(r.est_commission || 0), 0),
  }

  const data = { items: rows, summary, source: 'woocommerce+zoho' }
  couponCache = { data, ts: Date.now() }
  return data
}))

// Edit a coupon's classification (kind / affiliate / rate).
// Code travels in the BODY, not the URL — coupon codes can contain '.', '-',
// spaces, etc. that don't round-trip cleanly through a path param.
app.put('/api/coupons', handle(async req => {
  const { coupon_code, kind, affiliate_name, affiliate_email, affiliate_id, rate, confirmed, notes } = req.body
  if (!coupon_code) throw new Error('coupon_code required')
  const code = String(coupon_code).toLowerCase().trim()
  const { rows } = await pool.query(`
    INSERT INTO coupon_map (coupon_code, kind, affiliate_name, affiliate_email, affiliate_id, rate, confirmed, notes, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
    ON CONFLICT (coupon_code) DO UPDATE SET
      kind=EXCLUDED.kind, affiliate_name=EXCLUDED.affiliate_name,
      affiliate_email=EXCLUDED.affiliate_email, affiliate_id=EXCLUDED.affiliate_id,
      rate=EXCLUDED.rate, confirmed=EXCLUDED.confirmed, notes=EXCLUDED.notes, updated_at=NOW()
    RETURNING *
  `, [code, kind || 'unclassified', affiliate_name || null, affiliate_email || null,
      affiliate_id || null, rate ?? null, confirmed ?? false, notes || null])
  couponCache = null // invalidate
  return rows[0]
}))

// Live AffiliateWP creatives (kept for completeness; usually empty)
app.get('/api/creatives', handle(req =>
  awpSoft('/creatives', req.query, 'No creatives in AffiliateWP — use the local Banner library below.')
))

// ── SETTINGS (key/value) ─────────────────────────────────────────────────────
app.get('/api/settings', handle(async () => {
  const { rows } = await pool.query(`SELECT key, value FROM app_settings`)
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}))
app.put('/api/settings', handle(async req => {
  const entries = Object.entries(req.body || {})
  for (const [key, value] of entries) {
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ($1,$2)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
      [key, String(value)]
    )
  }
  const { rows } = await pool.query(`SELECT key, value FROM app_settings`)
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}))

// ── AFFILIATE KIT — per-affiliate referral link + coupons + promo text ───────
// Joins AffiliateWP affiliates (real IDs) to coupon_map (by email match).
app.get('/api/affiliate-kit', handle(async () => {
  const { rows } = await pool.query(`
    SELECT
      a.affiliate_id, a.display_name, a.username, a.email, a.payment_email,
      a.status, a.rate, a.rate_type, a.earnings, a.unpaid_earnings, a.referrals,
      COALESCE(
        json_agg(json_build_object('code', m.coupon_code, 'rate', m.rate, 'confirmed', m.confirmed)
                 ORDER BY m.coupon_code) FILTER (WHERE m.coupon_code IS NOT NULL),
        '[]'
      ) AS coupons
    FROM awp_affiliates a
    LEFT JOIN coupon_map m
      ON m.kind = 'affiliate'
     AND m.affiliate_email IS NOT NULL
     AND (LOWER(m.affiliate_email) = LOWER(a.payment_email)
          OR LOWER(m.affiliate_email) = LOWER(a.email))
    GROUP BY a.affiliate_id, a.display_name, a.username, a.email, a.payment_email,
             a.status, a.rate, a.rate_type, a.earnings, a.unpaid_earnings, a.referrals
    ORDER BY a.earnings DESC NULLS LAST
  `)
  const { rows: sr } = await pool.query(`SELECT key, value FROM app_settings`)
  const settings = Object.fromEntries(sr.map(r => [r.key, r.value]))
  return { items: rows, settings }
}))

// ── MATERIALS — local banner/material library (CRUD) ─────────────────────────
app.get('/api/materials', handle(async () => {
  const { rows } = await pool.query(`SELECT * FROM creatives_library ORDER BY created_at DESC`)
  return rows
}))
app.post('/api/materials', handle(async req => {
  const { name, type, image_url, destination_url, width, height, description, promo_text, active } = req.body
  if (!name) throw new Error('name required')
  const { rows } = await pool.query(`
    INSERT INTO creatives_library (name, type, image_url, destination_url, width, height, description, promo_text, active)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
  `, [name, type || 'banner', image_url || null, destination_url || null,
      width || null, height || null, description || null, promo_text || null, active !== false])
  return rows[0]
}))
app.put('/api/materials/:id', handle(async req => {
  const { name, type, image_url, destination_url, width, height, description, promo_text, active } = req.body
  const { rows } = await pool.query(`
    UPDATE creatives_library SET
      name=COALESCE($2,name), type=COALESCE($3,type), image_url=$4, destination_url=$5,
      width=$6, height=$7, description=$8, promo_text=$9, active=COALESCE($10,active), updated_at=NOW()
    WHERE id=$1 RETURNING *
  `, [req.params.id, name, type, image_url || null, destination_url || null,
      width || null, height || null, description || null, promo_text || null, active])
  if (!rows.length) throw new Error('Material not found')
  return rows[0]
}))
app.delete('/api/materials/:id', handle(async req => {
  await pool.query(`DELETE FROM creatives_library WHERE id=$1`, [req.params.id])
  return { ok: true }
}))

// ── STATS (pure SQL — instant, no API calls) ─────────────────────────────────
app.get('/api/stats', handle(async () => {
  const [agg, monthly, topAff, payAgg] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*)                                     AS total,
        COUNT(*) FILTER (WHERE status='active')      AS active,
        COUNT(*) FILTER (WHERE status='inactive')    AS inactive,
        COUNT(*) FILTER (WHERE status='pending')     AS pending,
        COALESCE(SUM(earnings),0)                    AS total_earnings,
        COALESCE(SUM(unpaid_earnings),0)             AS total_unpaid,
        COALESCE(SUM(referrals),0)                   AS total_referrals
      FROM awp_affiliates
    `),
    pool.query(`
      SELECT
        TO_CHAR(date,'YYYY-MM')          AS month,
        COUNT(*)                          AS count,
        COALESCE(SUM(amount),0)           AS amount,
        COALESCE(SUM(amount) FILTER (WHERE status='paid'),0)   AS paid,
        COALESCE(SUM(amount) FILTER (WHERE status='unpaid'),0) AS unpaid
      FROM awp_referrals
      WHERE date >= NOW() - INTERVAL '12 months'
      GROUP BY month ORDER BY month
    `),
    pool.query(`
      SELECT r.affiliate_id,
        COALESCE(a.display_name, a.username, a.payment_email, r.affiliate_id::text) AS name,
        COALESCE(SUM(r.amount),0)  AS total,
        COALESCE(SUM(r.amount) FILTER (WHERE r.status='unpaid'),0) AS unpaid,
        COUNT(*)                    AS count
      FROM awp_referrals r
      LEFT JOIN awp_affiliates a ON a.affiliate_id = r.affiliate_id
      GROUP BY r.affiliate_id, a.display_name, a.username, a.payment_email
      ORDER BY total DESC LIMIT 10
    `),
    pool.query(`
      SELECT COUNT(*) AS total, COALESCE(SUM(amount),0) AS amount FROM awp_payouts
    `),
  ])

  const a = agg.rows[0]
  const pa = payAgg.rows[0]

  const monthlyMap = {}
  for (const r of monthly.rows) {
    monthlyMap[r.month] = {
      count:  parseInt(r.count),
      amount: parseFloat(r.amount),
      paid:   parseFloat(r.paid),
      unpaid: parseFloat(r.unpaid),
    }
  }

  const refCounts = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status='paid')     AS paid,
      COUNT(*) FILTER (WHERE status='unpaid')   AS unpaid,
      COUNT(*) FILTER (WHERE status='pending')  AS pending,
      COUNT(*) FILTER (WHERE status='rejected') AS rejected
    FROM awp_referrals
  `)
  const rc = refCounts.rows[0]

  return {
    affiliates: {
      total:          parseInt(a.total),
      active:         parseInt(a.active),
      inactive:       parseInt(a.inactive),
      pending:        parseInt(a.pending),
      total_earnings: parseFloat(a.total_earnings),
      total_unpaid:   parseFloat(a.total_unpaid),
    },
    referrals: {
      total:         parseInt(a.total_referrals),
      paid:          parseInt(rc.paid),
      unpaid:        parseInt(rc.unpaid),
      pending:       parseInt(rc.pending),
      rejected:      parseInt(rc.rejected),
      amount_paid:   parseFloat(a.total_earnings) - parseFloat(a.total_unpaid),
      amount_unpaid: parseFloat(a.total_unpaid),
    },
    payouts: {
      total:  parseInt(pa.total),
      amount: parseFloat(pa.amount),
    },
    monthly: monthlyMap,
    by_affiliate: topAff.rows.map(r => ({
      affiliate_id: r.affiliate_id,
      name:   r.name,
      total:  parseFloat(r.total),
      unpaid: parseFloat(r.unpaid),
      count:  parseInt(r.count),
    })),
  }
}))

// ── Cache clear (kept for compat) ────────────────────────────────────────────
app.post('/api/cache/clear', (_req, res) => res.json({ ok: true }))

// ── Optional static serving — only if a built client exists. On Render the
// backend is API-only (no dist); the frontend is served separately by Vercel. ─
const distDir = path.join(__dirname, 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')))
}

// ── Startup ──────────────────────────────────────────────────────────────────
async function start() {
  await initTables()
  app.listen(PORT, () => console.log(`\n  ⚡ Affiliate Dashboard API → http://localhost:${PORT}\n`))
  console.log('  🔄 Running initial sync...')
  await Promise.all([runSync(), runWooSync()])
  console.log(`  ⏰ Auto-sync every ${SYNC_MS / 60000} minutes`)
  setInterval(() => {
    runSync().catch(console.error)
    runWooSync().catch(console.error)
  }, SYNC_MS)
}

start().catch(e => { console.error('Fatal startup error:', e); process.exit(1) })
