import { config } from 'dotenv'
import { pool } from '../db.js'

config()

const wc = await pool.query(`
  SELECT code, amount, discount_type, description,
         meta_data
  FROM wc_coupons
  WHERE discount_type = 'percent'
  ORDER BY amount::numeric DESC, code
`)

function metaVal(meta, key) {
  const row = meta?.find?.(m => m.key === key)
  return row?.value == null || row?.value === '' ? null : String(row.value)
}

const affiliate = []
const all = []
for (const r of wc.rows) {
  const amt = parseFloat(r.amount)
  const isAff = metaVal(r.meta_data, 'affiliate_check') === '1'
    || metaVal(r.meta_data, 'affwp_discount_affiliate')
    || metaVal(r.meta_data, 'affiliatepress_woo_coupon_affiliate_id')
  all.push({ code: r.code, pct: amt, isAff })
  if (isAff) affiliate.push({ code: r.code, pct: amt, description: r.description })
}

const over5 = all.filter(r => r.pct > 5)
const affOver5 = affiliate.filter(r => r.pct > 5)

console.log('=== All WC percent coupons with rate > 5% ===')
console.table(over5)

console.log('\n=== Affiliate-linked WC coupons with rate > 5% ===')
console.table(affOver5)

const map = await pool.query(`
  SELECT m.coupon_code, m.rate AS map_rate, m.affiliate_name,
         w.amount AS wc_amount, w.discount_type
  FROM coupon_map m
  LEFT JOIN wc_coupons w ON w.code_normalized = m.coupon_code
  WHERE m.kind = 'affiliate' AND m.rate > 5
  ORDER BY m.rate DESC, m.coupon_code
`)
console.log('\n=== coupon_map affiliate rates > 5% (current dashboard) ===')
console.table(map.rows)

await pool.end()
