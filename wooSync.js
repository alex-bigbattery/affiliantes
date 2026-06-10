import axios from 'axios'
import { config } from 'dotenv'
import { pool } from './db.js'
import { runCouponMapSync } from './couponMapSync.js'

config()

const WOO_BASE = (process.env.WOO_STORE_URL || 'https://bigbattery.com').replace(/\/+$/, '')
const WOO_API = `${WOO_BASE}/wp-json/wc/v3`
const WOO_AUTH = Buffer.from(
  `${process.env.WOO_CONSUMER_KEY}:${process.env.WOO_CONSUMER_SECRET}`
).toString('base64')
const sleep = ms => new Promise(r => setTimeout(r, ms))

function wooConfigured() {
  return !!(process.env.WOO_CONSUMER_KEY && process.env.WOO_CONSUMER_SECRET)
}

async function wooGet(endpoint, params = {}) {
  const res = await axios.get(`${WOO_API}${endpoint}`, {
    headers: { Authorization: `Basic ${WOO_AUTH}` },
    params,
    timeout: 60000,
  })
  return res
}

async function fetchAllCoupons() {
  const all = []
  let page = 1
  let totalPages = 1

  while (page <= totalPages) {
    const res = await wooGet('/coupons', { per_page: 100, page })
    totalPages = parseInt(res.headers['x-wp-totalpages'] || '1', 10)
    const batch = Array.isArray(res.data) ? res.data : []
    all.push(...batch)
    if (!batch.length) break
    page++
    if (page <= totalPages) await sleep(400)
  }

  return all
}

function parseTs(v) {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

async function upsertCoupons(rows) {
  if (!rows.length) return 0

  for (const c of rows) {
    const code = String(c.code || '').trim()
    await pool.query(`
      INSERT INTO wc_coupons (
        coupon_id, code, code_normalized, status, discount_type, amount, description,
        date_created, date_modified, date_expires, usage_count, usage_limit,
        usage_limit_per_user, individual_use, free_shipping, minimum_amount,
        maximum_amount, product_ids, excluded_product_ids, product_categories,
        email_restrictions, used_by, meta_data, raw, synced_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,NOW()
      )
      ON CONFLICT (coupon_id) DO UPDATE SET
        code=EXCLUDED.code, code_normalized=EXCLUDED.code_normalized,
        status=EXCLUDED.status, discount_type=EXCLUDED.discount_type,
        amount=EXCLUDED.amount, description=EXCLUDED.description,
        date_created=EXCLUDED.date_created, date_modified=EXCLUDED.date_modified,
        date_expires=EXCLUDED.date_expires, usage_count=EXCLUDED.usage_count,
        usage_limit=EXCLUDED.usage_limit, usage_limit_per_user=EXCLUDED.usage_limit_per_user,
        individual_use=EXCLUDED.individual_use, free_shipping=EXCLUDED.free_shipping,
        minimum_amount=EXCLUDED.minimum_amount, maximum_amount=EXCLUDED.maximum_amount,
        product_ids=EXCLUDED.product_ids, excluded_product_ids=EXCLUDED.excluded_product_ids,
        product_categories=EXCLUDED.product_categories, email_restrictions=EXCLUDED.email_restrictions,
        used_by=EXCLUDED.used_by, meta_data=EXCLUDED.meta_data, raw=EXCLUDED.raw,
        synced_at=NOW()
    `, [
      c.id,
      code,
      code.toLowerCase(),
      c.status || null,
      c.discount_type || null,
      parseFloat(c.amount || 0),
      c.description || null,
      parseTs(c.date_created_gmt || c.date_created),
      parseTs(c.date_modified_gmt || c.date_modified),
      parseTs(c.date_expires_gmt || c.date_expires),
      parseInt(c.usage_count || 0, 10),
      c.usage_limit != null ? parseInt(c.usage_limit, 10) : null,
      c.usage_limit_per_user != null ? parseInt(c.usage_limit_per_user, 10) : null,
      !!c.individual_use,
      !!c.free_shipping,
      parseFloat(c.minimum_amount || 0),
      parseFloat(c.maximum_amount || 0),
      JSON.stringify(c.product_ids || []),
      JSON.stringify(c.excluded_product_ids || []),
      JSON.stringify(c.product_categories || []),
      JSON.stringify(c.email_restrictions || []),
      JSON.stringify(c.used_by || []),
      JSON.stringify(c.meta_data || []),
      JSON.stringify(c),
    ])
  }

  return rows.length
}

export let lastWooSync = null
export let wooSyncRunning = false

export async function runWooSync() {
  if (!wooConfigured()) {
    console.log('  ⏭ WooCommerce sync skipped — WOO_CONSUMER_KEY/SECRET not set')
    return { skipped: true, reason: 'missing_credentials' }
  }
  if (wooSyncRunning) {
    console.log('  ⏭ WooCommerce sync already running, skipping')
    return { skipped: true, reason: 'already_running' }
  }

  wooSyncRunning = true
  const { rows: [log] } = await pool.query(
    `INSERT INTO wc_sync_log (started_at) VALUES (NOW()) RETURNING id`
  )
  const logId = log.id
  console.log(`  🛒 WooCommerce coupon sync started (log #${logId})`)

  let count = 0
  let error = null

  try {
    const coupons = await fetchAllCoupons()
    count = await upsertCoupons(coupons)
    console.log(`    ✔ ${count} WooCommerce coupons saved to Supabase`)
    const map = await runCouponMapSync()
    console.log(`    ✔ Coupon map updated (${map.stats.mapped} coupons linked to affiliates)`)
  } catch (e) {
    error = e.response?.data?.message || e.message || String(e)
    console.error('  ✗ WooCommerce sync error:', error)
  } finally {
    wooSyncRunning = false
    lastWooSync = {
      finished_at: new Date().toISOString(),
      status: error ? 'error' : 'success',
      coupons: count,
      error,
    }
    await pool.query(`
      UPDATE wc_sync_log
      SET finished_at=NOW(), status=$1, coupons_synced=$2, error=$3
      WHERE id=$4
    `, [lastWooSync.status, count, error, logId])
  }

  return lastWooSync
}
