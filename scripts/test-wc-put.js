import axios from 'axios'
import { config } from 'dotenv'
config()

const auth = Buffer.from(`${process.env.WOO_CONSUMER_KEY}:${process.env.WOO_CONSUMER_SECRET}`).toString('base64')
const base = 'https://bigbattery.com/wp-json/wc/v3'
const id = 217638

const get = await axios.get(`${base}/orders/${id}`, { headers: { Authorization: `Basic ${auth}` } })
console.log('GET ok:', get.data.id, get.data.number, get.data.status)

try {
  const put = await axios.put(`${base}/orders/${id}`, { status: get.data.status }, {
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
  })
  console.log('PUT ok:', put.data.id)
} catch (e) {
  console.log('PUT failed:', e.response?.status, e.response?.data?.message || e.response?.data?.code)
}
