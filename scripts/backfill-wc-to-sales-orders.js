/**
 * Backfill sales_orders from wc_orders not yet in Zoho.
 * Usage:
 *   node scripts/backfill-wc-to-sales-orders.js
 *   node scripts/backfill-wc-to-sales-orders.js BB138617 BB138892
 */
import { config } from 'dotenv'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { backfillWcOrdersToSalesOrders } from '../wcSalesOrderBackfill.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '..', '.env') })

const orderNumbers = process.argv.slice(2).filter(a => !a.startsWith('--'))
const result = await backfillWcOrdersToSalesOrders({
  orderNumbers: orderNumbers.length ? orderNumbers : null,
})
console.log(result)
process.exit(0)
