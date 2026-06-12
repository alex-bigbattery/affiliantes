/**
 * Test AffiliateWP referral status update (Pay button).
 * Usage: node scripts/probe-affwp-referral-update.js [referral_id] [status]
 */
import { config } from 'dotenv'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { awpConfigured, awpUpdateReferral, awpRequest, probeAffwpWriteSupport } from '../affwpClient.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '..', '.env') })

const referralId = process.argv[2] || '1'
const status = process.argv[3] || 'paid'

if (!awpConfigured()) {
  console.error('Set AFFWP_PUBLIC_KEY and AFFWP_TOKEN (or AFFWP_SECRET_KEY) in .env')
  process.exit(1)
}

const support = await probeAffwpWriteSupport(referralId)
console.log('Write support:', support)
if (!support.extended_api && !support.bridge_plugin) {
  console.error('\nNo write path available.')
  console.error('Install wordpress/bb-affiliate-dashboard-bridge.php on bigbattery.com')
  console.error('OR install AffiliateWP REST API Extended addon.\n')
}

console.log('GET referral', referralId, '…')
let before
try {
  before = await awpRequest('GET', `/referrals/${referralId}`)
  console.log('Before:', before.status, before.amount)
} catch (e) {
  console.error('GET failed:', e.message)
  process.exit(1)
}

console.log(`Update status=${status} …`)
try {
  const after = await awpUpdateReferral(referralId, { status })
  console.log('After:', after.status, after.referral_id || after.id)
} catch (e) {
  console.error('Update failed:', e.message)
  process.exit(1)
}
