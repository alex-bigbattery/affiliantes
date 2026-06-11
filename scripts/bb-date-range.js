import { config } from 'dotenv'
import { pool } from '../db.js'
config()
const r = await pool.query(`
  SELECT MIN(order_date) min, MAX(order_date) max, COUNT(*)::int n
  FROM sales_orders WHERE salesorder_number ILIKE 'BB%'
`)
console.log(r.rows[0])
await pool.end()
