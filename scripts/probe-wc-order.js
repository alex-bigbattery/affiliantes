import axios from 'axios'
import { config } from 'dotenv'
config()

const WOO_BASE = 'https://bigbattery.com'
const auth = Buffer.from(`${process.env.WOO_CONSUMER_KEY}:${process.env.WOO_CONSUMER_SECRET}`).toString('base64')

async function get(path, params = {}) {
  const res = await axios.get(`${WOO_BASE}/wp-json/wc/v3${path}`, {
    headers: { Authorization: `Basic ${auth}` },
    params,
  })
  return res.data
}

const byId = await get('/orders/216772')
console.log('Order 216772:', { id: byId.id, number: byId.number, status: byId.status })

const byNum = await get('/orders', { search: '139165', per_page: 5 })
console.log('Search 139165:', byNum.map(o => ({ id: o.id, number: o.number })))

const bbOrder = await get('/orders', { search: 'BB139165', per_page: 5 })
console.log('Search BB139165:', bbOrder.map(o => ({ id: o.id, number: o.number })))
