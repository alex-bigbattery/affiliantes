/**
 * WC coupons with affiliate_check=1 but no affwp_discount_affiliate / AffiliatePress user.
 * These orders land in "Zoho affiliate coupon" (not the default Affiliate Coupon tab).
 *
 * Usage: node scripts/audit-unlinked-affiliate-coupons.js
 */
import { config } from 'dotenv'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { pool } from '../db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '..', '.env') })

function metaVal(meta, key) {
  if (!Array.isArray(meta)) return null
  const row = meta.find(m => m.key === key)
  const v = row?.value
  if (v === '' || v == null) return null
  return String(v)
}

const { rows: wc } = await pool.query(`
  SELECT code, description, discount_type, amount, meta_data
  FROM wc_coupons
  ORDER BY code
`)

const { rows: maps } = await pool.query(`
  SELECT coupon_code, kind, affiliate_id, affiliate_name, confirmed, notes
  FROM coupon_map
`)

const mapByCode = new Map(maps.map(r => [r.coupon_code, r]))

const COUPON = `LOWER(TRIM(s.raw_json::jsonb->'custom_field_hash'->>'cf_coupon_s'))`
const { rows: orderCounts } = await pool.query(`
  SELECT ${COUPON} AS coupon_code, COUNT(*)::int AS orders,
         MAX(s.order_date) AS last_order
  FROM sales_orders s
  WHERE NULLIF(${COUPON}, '') IS NOT NULL
    AND ${COUPON} NOT IN ('.','-','n/a','na','none')
  GROUP BY 1
`)
const ordersByCoupon = new Map(orderCounts.map(r => [r.coupon_code, r]))

const unlinked = []
for (const w of wc) {
  const code = String(w.code || '').toLowerCase().trim()
  if (!code) continue
  const affiliateCheck = metaVal(w.meta_data, 'affiliate_check')
  const affwpId = metaVal(w.meta_data, 'affwp_discount_affiliate')
  const affPress = metaVal(w.meta_data, 'affiliatepress_woo_coupon_affiliate_id')
  if (affiliateCheck !== '1' || affwpId || affPress) continue

  const m = mapByCode.get(code)
  const oc = ordersByCoupon.get(code)
  unlinked.push({
    code,
    description: (w.description || '').slice(0, 70),
    map_affiliate_id: m?.affiliate_id ?? null,
    map_affiliate_name: m?.affiliate_name ?? null,
    confirmed: m?.confirmed ?? null,
    orders: oc?.orders ?? 0,
    last_order: oc?.last_order ?? null,
    notes: m?.notes ?? null,
  })
}

unlinked.sort((a, b) => b.orders - a.orders || a.code.localeCompare(b.code))

console.log(`\nWC affiliate coupons missing AffiliateWP user link: ${unlinked.length}\n`)
console.log('code'.padEnd(16) + 'orders  last_order   affiliate_id  map_name              description')
console.log('-'.repeat(110))
for (const r of unlinked) {
  console.log(
    `${r.code.padEnd(16)}${String(r.orders).padStart(6)}  ${(r.last_order || '—').toString().slice(0, 10).padEnd(11)}`
    + `${String(r.map_affiliate_id ?? '—').padEnd(14)}`
    + `${(r.map_affiliate_name || '—').slice(0, 20).padEnd(22)}`
    + `${r.description}`
  )
}

const withOrders = unlinked.filter(r => r.orders > 0)
const hiddenFromDefaultTab = withOrders.filter(r => !r.map_affiliate_id)
console.log(`\nWith real orders: ${withOrders.length}`)
console.log(`Hidden from default "Affiliate Coupon" tab (orders + no affiliate_id): ${hiddenFromDefaultTab.length}`)
if (hiddenFromDefaultTab.length) {
  console.log('  →', hiddenFromDefaultTab.map(r => `${r.code} (${r.orders})`).join(', '))
}

await pool.end()
