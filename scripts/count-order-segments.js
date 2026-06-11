import { config } from 'dotenv'
import { pool } from '../db.js'

config()

const COUPON = `LOWER(TRIM(s.raw_json::jsonb->'custom_field_hash'->>'cf_coupon_s'))`
const VALID = `NULLIF(${COUPON}, '') IS NOT NULL AND ${COUPON} NOT IN ('.','-','n/a','na','none')`

const { rows } = await pool.query(`
  SELECT
    CASE
      WHEN ${VALID} AND m.affiliate_id IS NOT NULL AND m.kind = 'affiliate'
        THEN 'wc_affiliate'
      WHEN ${VALID} AND m.kind = 'affiliate' AND w.code IS NULL
        THEN 'zoho_affiliate'
      WHEN ${VALID} AND m.kind = 'affiliate'
        THEN 'zoho_affiliate'
      WHEN s.salesorder_number ILIKE 'BB%'
        THEN 'bb'
      WHEN s.salesorder_number ILIKE 'SO%'
        THEN 'so'
      ELSE 'other'
    END AS segment,
    COUNT(*)::int AS n,
    COALESCE(SUM(s.total),0) AS revenue
  FROM sales_orders s
  LEFT JOIN coupon_map m ON m.coupon_code = ${COUPON}
  LEFT JOIN wc_coupons w ON w.code_normalized = ${COUPON}
  GROUP BY 1 ORDER BY n DESC
`)
console.table(rows)

await pool.end()
