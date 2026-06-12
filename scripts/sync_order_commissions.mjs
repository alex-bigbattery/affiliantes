import { config } from 'dotenv'
import { initTables } from '../db.js'
import { syncOrderCommissions, orderCommissionsMonthly } from '../orderCommissionsSync.js'

config()

await initTables()
const result = await syncOrderCommissions()
console.log('Synced order_commissions:', result)

const monthly = await orderCommissionsMonthly(12)
console.log('\nLast 12 months (by order date):')
for (const [m, d] of Object.entries(monthly).sort()) {
  console.log(`  ${m}  orders=${d.count}  paid=$${d.paid.toFixed(2)}  unpaid=$${d.unpaid.toFixed(2)}`)
}
