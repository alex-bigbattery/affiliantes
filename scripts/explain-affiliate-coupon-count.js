import { config } from 'dotenv'
import { pool } from '../db.js'

config()

function metaVal(meta, key) {
  const row = meta?.find?.(m => m.key === key)
  return row?.value == null || row?.value === '' ? null : String(row.value)
}

const affCount = await pool.query(`SELECT COUNT(*)::int AS n FROM awp_affiliates`)
const affActive = await pool.query(`SELECT COUNT(*)::int AS n FROM awp_affiliates WHERE status = 'active'`)

const map = await pool.query(`
  SELECT coupon_code, affiliate_id, affiliate_name, kind
  FROM coupon_map WHERE kind = 'affiliate'
`)

const byAffiliate = new Map()
let noAffiliateId = 0
for (const r of map.rows) {
  if (r.affiliate_id) {
    if (!byAffiliate.has(r.affiliate_id)) byAffiliate.set(r.affiliate_id, [])
    byAffiliate.get(r.affiliate_id).push(r.coupon_code)
  } else {
    noAffiliateId++
  }
}

const multiCoupon = [...byAffiliate.entries()].filter(([, codes]) => codes.length > 1)
  .sort((a, b) => b[1].length - a[1].length)

console.log('AffiliateWP affiliates (total):', affCount.rows[0].n)
console.log('AffiliateWP affiliates (active):', affActive.rows[0].n)
console.log('coupon_map kind=affiliate:', map.rows.length)
console.log('Unique affiliates with ≥1 coupon:', byAffiliate.size)
console.log('Affiliate coupons with NO affiliate_id:', noAffiliateId)
console.log('\nAffiliates with multiple coupons:', multiCoupon.length)
console.table(multiCoupon.slice(0, 15).map(([id, codes]) => ({
  affiliate_id: id,
  coupon_count: codes.length,
  coupons: codes.join(', '),
})))

const wcAff = await pool.query(`SELECT code, meta_data FROM wc_coupons`)
let wcAffiliateCheck = 0
let wcWithAwpId = 0
for (const r of wcAff.rows) {
  if (metaVal(r.meta_data, 'affiliate_check') === '1') wcAffiliateCheck++
  if (metaVal(r.meta_data, 'affwp_discount_affiliate')) wcWithAwpId++
}
console.log('\nWooCommerce coupons with affiliate_check=1:', wcAffiliateCheck)
console.log('WooCommerce coupons with affwp_discount_affiliate:', wcWithAwpId)
console.log('Total WC coupons:', wcAff.rows.length)

await pool.end()
