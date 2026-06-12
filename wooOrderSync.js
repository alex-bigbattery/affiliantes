import axios from 'axios'
import { config } from 'dotenv'
import { pool } from './db.js'
import { enrichWcLineItems } from './orderLineItems.js'
import { backfillWcOrdersToSalesOrders } from './wcSalesOrderBackfill.js'

config()

const WOO_BASE = (process.env.WOO_STORE_URL || 'https://bigbattery.com').replace(/\/+$/, '')
const WOO_API = `${WOO_BASE}/wp-json/wc/v3`
const sleep = ms => new Promise(r => setTimeout(r, ms))

function wooConfigured() {
  return !!(process.env.WOO_CONSUMER_KEY && process.env.WOO_CONSUMER_SECRET)
}

function wooAuthHeader() {
  const key = process.env.WOO_CONSUMER_KEY || ''
  const secret = process.env.WOO_CONSUMER_SECRET || ''
  return `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`
}

function parseTs(v) {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function couponFromOrder(o) {
  const code = o.coupon_lines?.[0]?.code
  if (!code) return null
  const c = String(code).toLowerCase().trim()
  return c && !['.', '-', 'n/a', 'na', 'none'].includes(c) ? c : null
}

function customerFromOrder(o) {
  const b = o.billing || {}
  const name = [b.first_name, b.last_name].filter(Boolean).join(' ').trim()
  return name || b.company?.trim() || null
}

export function mapWcOrder(o) {
  const number = String(o.number || '').trim()
  if (!/^BB/i.test(number)) return null
  const { net_sales, items_sold, products_text } = enrichWcLineItems(o.line_items)
  return {
    order_id: o.id,
    order_number: number,
    order_number_norm: number.toUpperCase(),
    status: o.status || null,
    date_created: parseTs(o.date_created_gmt || o.date_created),
    customer_name: customerFromOrder(o),
    total: Number.parseFloat(o.total) || 0,
    sub_total: Number.parseFloat(o.subtotal ?? o.total) || 0,
    coupon_code: couponFromOrder(o),
    net_sales,
    items_sold,
    products_text,
    raw: o,
  }
}

async function wooGet(endpoint, params = {}) {
  const res = await axios.get(`${WOO_API}${endpoint}`, {
    headers: { Authorization: wooAuthHeader() },
    params,
    timeout: 60000,
  })
  return res
}

function decodePlainText(raw) {
  let s = String(raw || '').replace(/<[^>]+>/g, ' ')
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  s = s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
  return s.replace(/\s+/g, ' ').trim()
}

export async function fetchWcOrderNotes(orderId) {
  if (!wooConfigured()) {
    return { configured: false, notes: [] }
  }
  const res = await wooGet(`/orders/${orderId}/notes`, { per_page: 100, order: 'desc' })
  const notes = Array.isArray(res.data) ? res.data : []
  return {
    configured: true,
    notes: notes.map(n => ({
      id: n.id,
      date: n.date_created || n.date_created_gmt,
      text: decodePlainText(n.note),
      customer_note: !!n.customer_note,
    })),
  }
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
      const mapped = mapWcOrder(o)
      if (mapped) all.push(mapped)
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
      INSERT INTO wc_orders (
        order_id, order_number, order_number_norm, status, date_created,
        customer_name, total, sub_total, coupon_code, net_sales, items_sold, raw, synced_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
      ON CONFLICT (order_id) DO UPDATE SET
        order_number=EXCLUDED.order_number,
        order_number_norm=EXCLUDED.order_number_norm,
        status=EXCLUDED.status,
        date_created=EXCLUDED.date_created,
        customer_name=EXCLUDED.customer_name,
        total=EXCLUDED.total,
        sub_total=EXCLUDED.sub_total,
        coupon_code=EXCLUDED.coupon_code,
        net_sales=EXCLUDED.net_sales,
        items_sold=EXCLUDED.items_sold,
        raw=EXCLUDED.raw,
        synced_at=NOW()
    `, [
      o.order_id, o.order_number, o.order_number_norm, o.status, o.date_created,
      o.customer_name, o.total, o.sub_total, o.coupon_code, o.net_sales, o.items_sold,
      o.raw ? JSON.stringify(o.raw) : null,
    ])
  }
  return rows.length
}

export async function backfillWcOrderDetails({ limit = 500, all = false } = {}) {
  if (!wooConfigured()) {
    return { skipped: true, reason: 'missing_credentials', count: 0 }
  }

  const { rows } = await pool.query(`
    SELECT order_id FROM wc_orders
    ${all ? '' : 'WHERE raw IS NULL'}
    ORDER BY order_id DESC
    LIMIT $1
  `, [limit])

  let updated = 0
  for (const { order_id } of rows) {
    try {
      const res = await wooGet(`/orders/${order_id}`)
      const mapped = mapWcOrder(res.data)
      if (mapped) {
        await upsertOrders([mapped])
        updated++
      }
    } catch (e) {
      console.warn(`WC order ${order_id}:`, e.response?.status || e.message)
    }
    await sleep(350)
  }

  return { updated, attempted: rows.length }
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
  const backfill = await backfillWcOrdersToSalesOrders().catch(e => {
    console.warn('WC → sales_orders backfill:', e.message)
    return { inserted: 0, error: e.message }
  })

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

  return { count, after: syncAfter, backfill }
}
