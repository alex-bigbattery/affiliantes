import { config } from 'dotenv'
import { pool } from '../db.js'

config()

const summary = await pool.query(`
  SELECT
    COUNT(*) FILTER (WHERE kind='affiliate') AS affiliate_coupons,
    COUNT(*) FILTER (WHERE kind='affiliate' AND affiliate_id IS NOT NULL) AS with_awp_id,
    COUNT(*) FILTER (WHERE kind='affiliate' AND rate IS NOT NULL) AS with_rate,
    COUNT(*) FILTER (WHERE kind='promo') AS promos
  FROM coupon_map
`)
console.log('coupon_map summary:', summary.rows[0])

const sample = await pool.query(`
  SELECT coupon_code, kind, affiliate_name, affiliate_id, rate, confirmed
  FROM coupon_map
  WHERE coupon_code IN ('spicer10','tocci10','joe10','fentertainment','partner10','karr10','solarhav10','golfcarting5')
  ORDER BY coupon_code
`)
console.table(sample.rows)

await pool.end()
