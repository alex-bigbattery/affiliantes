import { config } from 'dotenv'
import { initTables } from '../db.js'
import { backfillWcOrderDetails } from '../wooOrderSync.js'

config()
await initTables()

const limit = parseInt(process.argv[2], 10) || 500
const all = process.argv.includes('--all')
const result = await backfillWcOrderDetails({ limit, all })
console.log('Backfill WC order details:', result)
process.exit(0)
