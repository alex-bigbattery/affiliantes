import { config } from 'dotenv'
import { initTables } from '../db.js'
import { runWooSync } from '../wooSync.js'

config()

const result = await initTables()
void result
const sync = await runWooSync()
console.log(sync)
process.exit(sync?.status === 'error' ? 1 : 0)
