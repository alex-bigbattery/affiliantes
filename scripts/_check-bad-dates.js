import { config } from 'dotenv'
import { pool } from '../db.js'
config()

const bad = await pool.query(`
  SELECT order_date, COUNT(*)::int n
  FROM sales_orders
  WHERE order_date IS NOT NULL
    AND order_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
  GROUP BY 1 LIMIT 10
`)
console.log('Non-ISO order_date:', bad.rows)

try {
  const r = await pool.query(`
    SELECT COUNT(*)::int n FROM sales_orders WHERE order_date::date >= '2025-11-01'::date
  `)
  console.log('Cast works, count >= Nov 2025:', r.rows[0])
} catch (e) {
  console.log('Cast FAILED:', e.message)
}

await pool.end()
