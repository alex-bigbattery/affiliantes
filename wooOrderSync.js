import axios from 'axios'
import { config } from 'dotenv'
import { pool } from './db.js'

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

function parseTs(v) {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

async function wooGet(endpoint, params = {}) {
  const res = await axios.get(`${WOO_API}${endpoint}`, {
    headers: { Authorization: `Basic ${WOO_AUTH}` },
    params,
    timeout: 60000,
  })
  return res
}

async function fetchOrders({ after } = {}) {
  const all = []
  let page = 1
  let totalPages = 1

  while (page <= totalPages) {
    const params = { per_page: 100, page, orderby: 'id', order: 'desc' }
    if (after) params.after = after
    const res = await wooGet('/orders', params)
    totalPages = parseInt(res.headers['x-wp-totalpages'] || '1', 10)
    const batch = Array.isArray(res.data) ? res.data : []
    for (const o of batch) {
      const number = String(o.number || '').trim()
      if (/^BB/i.test(number)) {
        all.push({
          order_id: o.id,
          order_number: number,
          order_number_norm: number.toUpperCase(),
          status: o.status || null,
          date_created: parseTs(o.date_created_gmt || o.date_created),
        })
      }
    }
    if (!batch.length) break
    page++
    if (page <= totalPages) await sleep(350)
  }

  return all
}

async function upsertOrders(rows) {
  if (!rows.length) return 0
  for (const o of rows) {
    await pool.query(`
      INSERT INTO wc_orders (order_id, order_number, order_number_norm, status, date_created, synced_at)
      VALUES ($1,$2,$3,$4,$5,NOW())
      ON CONFLICT (order_id) DO UPDATE SET
        order_number=EXCLUDED.order_number,
        order_number_norm=EXCLUDED.order_number_norm,
        status=EXCLUDED.status,
        date_created=EXCLUDED.date_created,
        synced_at=NOW()
    `, [o.order_id, o.order_number, o.order_number_norm, o.status, o.date_created])
  }
  return rows.length
}

export async function runWooOrderSync({ after } = {}) {
  if (!wooConfigured()) {
    return { skipped: true, reason: 'missing_credentials', count: 0 }
  }

  let syncAfter = after
  if (!syncAfter) {
    const { rows: [setting] } = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'wc_orders_sync_after'`
    ).catch(() => ({ rows: [] }))
    syncAfter = setting?.value || '2025-08-01T00:00:00'
  }

  const orders = await fetchOrders({ after: syncAfter })
  const count = await upsertOrders(orders)

  if (orders.length) {
    const latest = orders.reduce((max, o) => {
      const t = o.date_created ? new Date(o.date_created).getTime() : 0
      return t > max ? t : max
    }, 0)
    if (latest) {
      await pool.query(`
        INSERT INTO app_settings (key, value) VALUES ('wc_orders_sync_after', $1)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
      `, [new Date(latest).toISOString()])
    }
  }

  return { count, after: syncAfter }
}
