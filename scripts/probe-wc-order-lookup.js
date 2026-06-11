import axios from 'axios'
import { config } from 'dotenv'
config()

const WOO_BASE = 'https://bigbattery.com'
const auth = Buffer.from(`${process.env.WOO_CONSUMER_KEY}:${process.env.WOO_CONSUMER_SECRET}`).toString('base64')

async function tryGet(path, params = {}) {
  try {
    const res = await axios.get(`${WOO_BASE}/wp-json/wc/v3${path}`, {
      headers: { Authorization: `Basic ${auth}` },
      params,
    })
    return { ok: true, data: res.data, total: res.headers['x-wp-total'] }
  } catch (e) {
    return { ok: false, status: e.response?.status, msg: e.response?.data?.message || e.message }
  }
}

for (const params of [
  { search: 'BB138315' },
  { number: 'BB138315' },
  { orderby: 'id', order: 'desc', per_page: 3 },
]) {
  console.log('params', params, await tryGet('/orders', params))
}

// page through recent and find BB numbers
const recent = await tryGet('/orders', { per_page: 20, orderby: 'id', order: 'desc' })
if (recent.ok) {
  console.log('recent BB:', recent.data.filter(o => String(o.number).startsWith('BB')).map(o => ({ id: o.id, number: o.number })))
}
