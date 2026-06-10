/**
 * CLI: re-save all affiliate-coupon WC orders (wp-admin Update equivalent).
 * Usage: node scripts/bulk-wc-order-update.js
 */
import { config } from 'dotenv'
import { pool } from '../db.js'
import { refreshWcOrdersBulk, wooConfigured } from '../wooOrderUpdate.js'

config()

if (!wooConfigured()) {
  console.error('Missing WOO_CONSUMER_KEY / WOO_CONSUMER_SECRET in .env')
  process.exit(1)
}

const COUPON = `LOWER(TRIM(s.raw_json::jsonb->'custom_field_hash'->>'cf_coupon_s'))`
const VALID = `NULLIF(${COUPON}, '') IS NOT NULL AND ${COUPON} NOT IN ('.','-','n/a','na','none')`

const { rows } = await pool.query(`
  SELECT DISTINCT wo.order_id AS wc_order_id, s.salesorder_number
  FROM sales_orders s
  JOIN wc_orders wo ON wo.order_number_norm = UPPER(TRIM(s.salesorder_number))
  LEFT JOIN coupon_map m ON m.coupon_code = ${COUPON}
  WHERE wo.order_id IS NOT NULL
    AND ${VALID} AND m.affiliate_id IS NOT NULL AND m.kind = 'affiliate'
  ORDER BY wo.order_id DESC
`)

const ids = rows.map(r => r.wc_order_id)
console.log(`Updating ${ids.length} WooCommerce orders…`)

const result = await refreshWcOrdersBulk(ids, {
  onProgress: ({ index, total, id, status }) => {
    process.stdout.write(`\r  ${index}/${total} WC #${id} ${status}`)
  },
})

console.log(`\n✔ ${result.ok.length} ok, ${result.failed.length} failed`)
if (result.failed.length) console.table(result.failed)

await pool.end()
