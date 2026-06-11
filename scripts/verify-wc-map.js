import { config } from 'dotenv'
import { pool } from '../db.js'
config()
const r = await pool.query(`
  SELECT order_id, order_number FROM wc_orders
  WHERE order_number_norm IN ('BB138315', 'BB139165')
`)
console.table(r.rows)
await pool.end()
