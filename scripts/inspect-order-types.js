import { config } from 'dotenv'
import { pool } from '../db.js'

config()

// Sample orders and look for type/discriminator fields
const samples = await pool.query(`
  SELECT salesorder_number, reference_number, status, customer_name,
         raw_json::jsonb->>'salesorder_number' AS rn,
         raw_json::jsonb->'custom_field_hash'->>'cf_coupon_s' AS coupon,
         raw_json::jsonb->'custom_field_hash' AS cf_hash,
         LEFT(raw_json, 800) AS raw_preview
  FROM sales_orders
  ORDER BY order_date DESC NULLS LAST
  LIMIT 5
`)
console.log('=== Recent samples ===')
for (const r of samples.rows) {
  console.log('\n---', r.salesorder_number, r.reference_number)
  console.log('coupon:', r.coupon)
  console.log('cf_hash keys:', r.cf_hash ? Object.keys(r.cf_hash).slice(0, 20) : null)
}

// Prefix patterns on salesorder_number
const prefixes = await pool.query(`
  SELECT
    CASE
      WHEN salesorder_number ILIKE 'SO-%' OR salesorder_number ILIKE 'SO%' THEN 'SO'
      WHEN salesorder_number ILIKE 'BB-%' OR salesorder_number ILIKE 'BB%' THEN 'BB'
      ELSE 'other'
    END AS prefix,
    COUNT(*)::int AS n
  FROM sales_orders
  GROUP BY 1 ORDER BY n DESC
`)
console.log('\n=== Number prefix ===')
console.table(prefixes.rows)

// reference_number patterns
const ref = await pool.query(`
  SELECT LEFT(reference_number, 20) AS ref_prefix, COUNT(*)::int AS n
  FROM sales_orders
  WHERE reference_number IS NOT NULL AND reference_number != ''
  GROUP BY 1 ORDER BY n DESC LIMIT 15
`)
console.log('\n=== reference_number prefixes ===')
console.table(ref.rows)

// custom fields that might indicate order source
const cfKeys = await pool.query(`
  SELECT DISTINCT jsonb_object_keys(raw_json::jsonb->'custom_field_hash') AS key
  FROM sales_orders
  WHERE raw_json::jsonb->'custom_field_hash' IS NOT NULL
  ORDER BY 1
`)
console.log('\n=== All custom_field_hash keys ===')
console.log(cfKeys.rows.map(r => r.key))

// coupon orders count
const withCoupon = await pool.query(`
  SELECT COUNT(*)::int AS n FROM sales_orders
  WHERE NULLIF(TRIM(raw_json::jsonb->'custom_field_hash'->>'cf_coupon_s'),'') IS NOT NULL
    AND LOWER(TRIM(raw_json::jsonb->'custom_field_hash'->>'cf_coupon_s'))
        NOT IN ('.','-','n/a','na','none')
`)
console.log('\nWith coupon:', withCoupon.rows[0].n)

await pool.end()
