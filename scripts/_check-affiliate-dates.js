import { config } from 'dotenv'
import { pool } from '../db.js'
config()

const COUPON = `LOWER(TRIM(s.raw_json::jsonb->'custom_field_hash'->>'cf_coupon_s'))`
const VALID = `NULLIF(${COUPON}, '') IS NOT NULL AND ${COUPON} NOT IN ('.','-','n/a','na','none')`
const SEG = `
  CASE
    WHEN ${VALID} AND m.affiliate_id IS NOT NULL AND m.kind = 'affiliate' THEN 'wc_affiliate'
    WHEN ${VALID} AND m.kind = 'affiliate' THEN 'zoho_affiliate'
    ELSE 'other'
  END
`

const { rows: months } = await pool.query(`
  SELECT to_char(s.order_date::date, 'YYYY-MM') AS month, ${SEG} AS segment, COUNT(*)::int AS n
  FROM sales_orders s
  LEFT JOIN coupon_map m ON m.coupon_code = ${COUPON}
  WHERE s.order_date >= '2025-08-01'
  GROUP BY 1, 2
  HAVING ${SEG} IN ('wc_affiliate', 'zoho_affiliate')
  ORDER BY 1, 2
`)
console.log('Affiliate coupon orders by month:')
console.table(months)

const { rows: [novDec] } = await pool.query(`
  SELECT COUNT(*)::int AS wc_affiliate
  FROM sales_orders s
  LEFT JOIN coupon_map m ON m.coupon_code = ${COUPON}
  WHERE ${VALID} AND m.affiliate_id IS NOT NULL AND m.kind = 'affiliate'
    AND s.order_date >= '2025-11-01' AND s.order_date <= '2025-12-31'
`)
console.log('\nWC affiliate coupon Nov-Dec 2025:', novDec)

const { rows: samples } = await pool.query(`
  SELECT s.salesorder_number, s.order_date, ${COUPON} AS coupon, m.affiliate_name
  FROM sales_orders s
  LEFT JOIN coupon_map m ON m.coupon_code = ${COUPON}
  WHERE ${VALID} AND m.affiliate_id IS NOT NULL AND m.kind = 'affiliate'
  ORDER BY s.order_date ASC
  LIMIT 10
`)
console.log('\nFirst 10 WC affiliate coupon orders ever:')
console.table(samples)

await pool.end()
