import { config } from 'dotenv'
import { pool } from '../db.js'

config()

const samples = await pool.query(`
  SELECT salesorder_number, reference_number,
    raw_json::jsonb->'custom_field_hash' AS cf,
    raw_json::jsonb AS full_json
  FROM sales_orders
  WHERE salesorder_number ILIKE 'BB%'
  ORDER BY order_date DESC NULLS LAST
  LIMIT 5
`)

for (const row of samples.rows) {
  console.log('\n===', row.salesorder_number, row.reference_number, '===')
  if (row.cf) console.log('cf keys:', Object.keys(row.cf).sort().join(', '))
  // search for 216772-like patterns in full json text
  const text = JSON.stringify(row.full_json)
  const wcFields = ['woocommerce', 'wc_order', 'shopify', 'order_id', 'web_order']
  for (const k of Object.keys(row.cf || {})) {
    if (/wc|woo|web|shop/i.test(k)) console.log(k, '=', row.cf[k])
  }
}

// Try to find order that might map to WC id 216772
const hunt = await pool.query(`
  SELECT salesorder_number, reference_number,
    raw_json::jsonb->'custom_field_hash' AS cf
  FROM sales_orders
  WHERE raw_json::text ILIKE '%216772%'
  LIMIT 5
`)
console.log('\n=== Rows containing 216772 ===')
console.table(hunt.rows.map(r => ({
  so: r.salesorder_number,
  ref: r.reference_number,
  cf: r.cf,
})))

await pool.end()
