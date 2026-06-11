import { config } from 'dotenv'
import { refreshWcOrder } from '../wooOrderUpdate.js'

config()
const id = parseInt(process.argv[2] || '217638', 10)
const result = await refreshWcOrder(id)
console.log('Updated:', result)
