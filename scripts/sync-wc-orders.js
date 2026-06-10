import { config } from 'dotenv'
import { initTables } from '../db.js'
import { runWooOrderSync } from '../wooOrderSync.js'

config()
await initTables()
const result = await runWooOrderSync({ after: '2025-08-01T00:00:00' })
console.log('Synced WC orders:', result)
process.exit(0)
