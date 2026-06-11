/**
 * Test AffiliateWP referral status update (Pay button).
 * Usage: node scripts/probe-affwp-referral-update.js [referral_id] [status]
 */
import { config } from 'dotenv'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { awpConfigured, awpUpdateReferral, awpRequest } from '../affwpClient.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '..', '.env') })

const referralId = process.argv[2] || '1'
const status = process.argv[3] || 'paid'

if (!awpConfigured()) {
  console.error('Set AFFWP_PUBLIC_KEY and AFFWP_TOKEN (or AFFWP_SECRET_KEY) in .env')
  process.exit(1)
}

console.log('GET referral', referralId, '…')
try {
  const before = await awpRequest('GET', `/referrals/${referralId}`)
  console.log('Before:', before.status, before.amount)
} catch (e) {
  console.warn('GET failed:', e.message)
}

console.log(`PATCH/POST status=${status} …`)
const after = await awpUpdateReferral(referralId, { status })
console.log('After:', after.status, after.referral_id || after.id)
