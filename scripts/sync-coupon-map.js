import { config } from 'dotenv'
import { initTables } from '../db.js'
import { runCouponMapSync } from '../couponMapSync.js'

config()

const dryRun = process.argv.includes('--dry-run')
await initTables()
const result = await runCouponMapSync({ dryRun })
console.log(result.stats)
if (dryRun) {
  console.log(`Would update ${result.changes.length} coupons`)
  console.table(result.changes.slice(0, 30))
} else {
  console.log(`Updated ${result.changes.length} coupons`)
}
