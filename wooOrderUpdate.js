import axios from 'axios'
import { config } from 'dotenv'

config()

const WOO_BASE = (process.env.WOO_STORE_URL || 'https://bigbattery.com').replace(/\/+$/, '')
const WOO_API = `${WOO_BASE}/wp-json/wc/v3`
const sleep = ms => new Promise(r => setTimeout(r, ms))

export function wooConfigured() {
  return !!(process.env.WOO_CONSUMER_KEY && process.env.WOO_CONSUMER_SECRET)
}

function wooAuthHeader() {
  const key = process.env.WOO_CONSUMER_KEY || ''
  const secret = process.env.WOO_CONSUMER_SECRET || ''
  return `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`
}

function wrapWooError(e) {
  const msg = e.response?.data?.message || e.message || String(e)
  if (e.response?.status === 401 && /write permissions/i.test(msg)) {
    throw new Error(
      'WooCommerce API key is read-only. In WP Admin go to WooCommerce → Settings → Advanced → REST API, ' +
      'edit the key to Read/Write, then update WOO_CONSUMER_KEY/SECRET on Render. ' +
      'Or run locally: npm run wc:admin-update (browser automation).'
    )
  }
  throw new Error(msg)
}

async function wooRequest(method, endpoint, data = null) {
  try {
    const res = await axios({
      method,
      url: `${WOO_API}${endpoint}`,
      headers: { Authorization: wooAuthHeader(), 'Content-Type': 'application/json' },
      data,
      timeout: 60000,
    })
    return res.data
  } catch (e) {
    wrapWooError(e)
  }
}

/** Re-save a WC order (same as clicking Update in wp-admin — fires save hooks / AffiliateWP). */
export async function refreshWcOrder(orderId) {
  const order = await wooRequest('GET', `/orders/${orderId}`)
  await wooRequest('PUT', `/orders/${orderId}`, { status: order.status })
  return {
    wc_order_id: order.id,
    order_number: order.number,
    status: order.status,
  }
}

export async function refreshWcOrdersBulk(orderIds, { delayMs = 600, onProgress } = {}) {
  const results = { ok: [], failed: [] }

  for (let i = 0; i < orderIds.length; i++) {
    const id = orderIds[i]
    try {
      const row = await refreshWcOrder(id)
      results.ok.push(row)
      onProgress?.({ index: i + 1, total: orderIds.length, id, status: 'ok', row })
    } catch (e) {
      const msg = e.response?.data?.message || e.message || String(e)
      results.failed.push({ wc_order_id: id, error: msg })
      onProgress?.({ index: i + 1, total: orderIds.length, id, status: 'error', error: msg })
    }
    if (i < orderIds.length - 1) await sleep(delayMs)
  }

  return results
}
