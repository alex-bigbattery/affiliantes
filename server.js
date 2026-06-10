import express from 'express'
import cors from 'cors'
import axios from 'axios'
import { config } from 'dotenv'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { pool, initTables } from './db.js'
import { runSync, lastSync, syncRunning } from './sync.js'

config()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3001
const SYNC_MS = (parseInt(process.env.SYNC_INTERVAL_MINUTES) || 30) * 60 * 1000

const BASE = 'https://bigbattery.com/wp-json/affwp/v1'
const AUTH = Buffer.from(`${process.env.AFFWP_PUBLIC_KEY}:${process.env.AFFWP_TOKEN}`).toString('base64')

// CORS: in production set ALLOWED_ORIGINS to your Vercel URL(s) (comma-separated).
// Empty = allow all (local dev).
const ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
app.use(cors(ALLOWED.length ? { origin: ALLOWED } : {}))
app.use(express.json())

// Health check (used by Render)
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }))

// ── AffiliateWP write helper (still calls API for mutations) ─────────────────
async function awp(method, endpoint, params = {}, data = null) {
  const res = await axios({ method, url: `${BASE}${endpoint}`,
    headers: { Authorization: `Basic ${AUTH}`, 'Content-Type': 'application/json' },
    params, data, timeout: 30000,
  })
  return res.data
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
    const { rows } = await pool.query(
      `SELECT * FROM awp_sync_log ORDER BY id DESC LIMIT 5`
    )
    res.json({ running: syncRunning, last: lastSync, log: rows })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/api/sync/run', async (_req, res) => {
  if (syncRunning) return res.json({ message: 'Sync already running' })
  runSync().catch(console.error)
  res.json({ message: 'Sync started' })
})

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
        MIN(raw_json::jsonb->>'date')                  AS first_order,
        MAX(raw_json::jsonb->>'date')                  AS last_order
      FROM sales_orders
      WHERE NULLIF(TRIM(raw_json::jsonb->'custom_field_hash'->>'cf_coupon_s'),'') IS NOT NULL
        AND LOWER(TRIM(raw_json::jsonb->'custom_field_hash'->>'cf_coupon_s'))
            NOT IN ('.', '-', 'n/a', 'na', 'none')
      GROUP BY 1
    )
    SELECT
      u.coupon AS coupon_code, u.orders, u.revenue, u.subtotal,
      u.first_order, u.last_order,
      COALESCE(m.kind, 'unclassified') AS kind,
      m.affiliate_name, m.affiliate_email, m.affiliate_id, m.rate,
      COALESCE(m.confirmed, false) AS confirmed, m.notes,
      CASE WHEN m.rate IS NOT NULL
           THEN ROUND((u.subtotal * m.rate / 100.0)::numeric, 2) END AS est_commission
    FROM usage u
    LEFT JOIN coupon_map m ON m.coupon_code = u.coupon
    ORDER BY u.revenue DESC NULLS LAST
  `)

  const summary = {
    total_codes:     rows.length,
    affiliate_codes: rows.filter(r => r.kind === 'affiliate').length,
    promo_codes:     rows.filter(r => r.kind === 'promo').length,
    unclassified:    rows.filter(r => r.kind === 'unclassified').length,
    total_orders:    rows.reduce((s, r) => s + Number(r.orders), 0),
    total_revenue:   rows.reduce((s, r) => s + Number(r.revenue || 0), 0),
    affiliate_revenue: rows.filter(r => r.kind === 'affiliate').reduce((s, r) => s + Number(r.revenue || 0), 0),
    est_commission:  rows.reduce((s, r) => s + Number(r.est_commission || 0), 0),
  }

  const data = { items: rows, summary, source: 'zoho_sales_orders' }
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
  await runSync()
  console.log(`  ⏰ Auto-sync every ${SYNC_MS / 60000} minutes`)
  setInterval(() => runSync().catch(console.error), SYNC_MS)
}

start().catch(e => { console.error('Fatal startup error:', e); process.exit(1) })
