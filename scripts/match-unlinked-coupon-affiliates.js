/**
 * Suggest and optionally apply affiliate links for WC coupons missing affwp meta.
 * Usage:
 *   node scripts/match-unlinked-coupon-affiliates.js          # dry run
 *   node scripts/match-unlinked-coupon-affiliates.js --apply  # write coupon_map
 */
import { config } from 'dotenv'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { pool } from '../db.js'
import { matchCouponToAffiliate, isWcAffiliateCouponWithoutUser } from '../couponAffiliateMatch.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '..', '.env') })

const apply = process.argv.includes('--apply')

const [{ rows: wc }, { rows: affiliates }, { rows: maps }] = await Promise.all([
  pool.query(`SELECT code, description, discount_type, amount, meta_data FROM wc_coupons ORDER BY code`),
  pool.query(`SELECT affiliate_id, display_name, username, email, payment_email FROM awp_affiliates`),
  pool.query(`SELECT coupon_code, affiliate_id, affiliate_name, confirmed FROM coupon_map`),
])
const mapByCode = new Map(maps.map(r => [r.coupon_code, r]))

const suggestions = []
for (const w of wc) {
  const code = String(w.code || '').toLowerCase().trim()
  if (!code || !isWcAffiliateCouponWithoutUser(w.meta_data)) continue

  const existing = mapByCode.get(code)
  const m = matchCouponToAffiliate({ code, description: w.description }, affiliates)
  suggestions.push({
    code,
    description: (w.description || '').slice(0, 60),
    current_affiliate_id: existing?.affiliate_id ?? null,
    match: m.affiliate
      ? { id: m.affiliate.affiliate_id, name: m.affiliate.display_name || m.affiliate.username, confidence: m.confidence, reason: m.reason }
      : null,
  })
}

console.log(`\nUnlinked WC affiliate coupons: ${suggestions.length}`)
console.log('code'.padEnd(16) + 'confidence   affiliate              reason')
console.log('-'.repeat(90))

let applied = 0
for (const s of suggestions) {
  const conf = s.match?.confidence || '—'
  const name = s.match?.name || '—'
  const reason = s.match?.reason || 'needs manual WC assignment'
  console.log(`${s.code.padEnd(16)}${conf.padEnd(13)}${name.slice(0, 22).padEnd(23)}${reason}`)

  if (!apply || !s.match) continue
  if (s.current_affiliate_id === s.match.id) continue

  const aff = affiliates.find(a => a.affiliate_id === s.match.id)
  const rate = w => (w.discount_type === 'percent' ? parseFloat(w.amount) : null)
  const row = wc.find(x => String(x.code).toLowerCase() === s.code)
  const pct = row ? rate(row) : null

  await pool.query(`
    INSERT INTO coupon_map (coupon_code, kind, affiliate_name, affiliate_email, affiliate_id, rate, confirmed, notes, updated_at)
    VALUES ($1,'affiliate',$2,$3,$4,$5,true,$6,NOW())
    ON CONFLICT (coupon_code) DO UPDATE SET
      kind='affiliate',
      affiliate_name=EXCLUDED.affiliate_name,
      affiliate_email=EXCLUDED.affiliate_email,
      affiliate_id=EXCLUDED.affiliate_id,
      rate=COALESCE(EXCLUDED.rate, coupon_map.rate),
      confirmed=true,
      notes=EXCLUDED.notes,
      updated_at=NOW()
  `, [
    s.code,
    aff.display_name || aff.username,
    aff.payment_email || aff.email,
    aff.affiliate_id,
    pct,
    `Auto-matched: ${s.match.reason} (WC missing affwp_discount_affiliate)`,
  ])
  applied++
}

if (apply) console.log(`\nApplied ${applied} coupon_map update(s).`)
else console.log('\nDry run — pass --apply to write coupon_map.')

await pool.end()
