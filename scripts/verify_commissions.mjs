import { config } from 'dotenv'
import { initTables } from '../db.js'
import { syncOrderCommissions, queryOrderCommissions, orderCommissionsMonthly } from '../orderCommissionsSync.js'

config()
await initTables()
await syncOrderCommissions()

const apr = await queryOrderCommissions({ status: 'all', date: '2026-04-01', end_date: '2026-04-30', number: 100 })
const may = await queryOrderCommissions({ status: 'all', date: '2026-05-01', end_date: '2026-05-31', number: 100 })
const est = await queryOrderCommissions({ status: 'estimated', number: 5000 })

console.log('Apr 2026:', apr.total, 'orders')
console.log('May 2026:', may.total, 'orders')
console.log('Estimated (no WP referral):', est.total)
console.log('Sample Apr:', apr.items.slice(0, 3).map(r => `${r.salesorder_number} $${r.amount} ${r.status}`))
