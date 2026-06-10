import { config } from 'dotenv'
import axios from 'axios'
config()
// quick local segment check via SQL
import { pool } from '../db.js'

const { rows } = await pool.query(`
  WITH usage AS (
    SELECT LOWER(TRIM(raw_json::jsonb->'custom_field_hash'->>'cf_coupon_s')) AS coupon,
      COUNT(*) AS orders, COALESCE(SUM(sub_total),0) AS subtotal
    FROM sales_orders
    WHERE NULLIF(TRIM(raw_json::jsonb->'custom_field_hash'->>'cf_coupon_s'),'') IS NOT NULL
      AND LOWER(TRIM(raw_json::jsonb->'custom_field_hash'->>'cf_coupon_s')) NOT IN ('.','-','n/a','na','none')
    GROUP BY 1
  ),
  catalog AS (SELECT code_normalized AS coupon FROM wc_coupons),
  codes AS (SELECT coupon FROM usage UNION SELECT coupon FROM catalog)
  SELECT
    CASE
      WHEN cat.coupon IS NOT NULL AND m.affiliate_id IS NOT NULL AND m.kind='affiliate' THEN 'wc_linked'
      WHEN cat.coupon IS NOT NULL AND m.kind='affiliate' THEN 'wc_unlinked'
      WHEN cat.coupon IS NOT NULL AND m.kind='promo' THEN 'wc_promo'
      WHEN cat.coupon IS NULL AND u.coupon IS NOT NULL THEN 'zoho_only'
      ELSE 'other'
    END AS segment,
    COUNT(*)::int AS n
  FROM codes c
  LEFT JOIN usage u ON u.coupon=c.coupon
  LEFT JOIN catalog cat ON cat.coupon=c.coupon
  LEFT JOIN coupon_map m ON m.coupon_code=c.coupon
  GROUP BY 1 ORDER BY 1
`)
console.table(rows)
await pool.end()
