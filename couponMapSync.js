import { pool } from './db.js'
import { matchCouponToAffiliate } from './couponAffiliateMatch.js'

function metaVal(meta, key) {
  if (!Array.isArray(meta)) return null
  const row = meta.find(m => m.key === key)
  const v = row?.value
  if (v === '' || v == null) return null
  return String(v)
}

function parseRate(v) {
  if (v == null || v === '') return null
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Map WooCommerce coupons → coupon_map.
 * Affiliate link comes from WC meta (affwp_discount_affiliate).
 * Rate comes ONLY from the WC coupon amount (percent discounts).
 */
export async function runCouponMapSync({ dryRun = false } = {}) {
  const [wcRes, affRes, mapRes] = await Promise.all([
    pool.query(`SELECT code, amount, discount_type, description, meta_data FROM wc_coupons`),
    pool.query(`SELECT affiliate_id, display_name, username, email, payment_email FROM awp_affiliates`),
    pool.query(`SELECT coupon_code, kind, affiliate_name, affiliate_email, affiliate_id, rate, confirmed, notes FROM coupon_map`),
  ])

  const affById = new Map(affRes.rows.map(a => [a.affiliate_id, a]))
  const existingMap = new Map(mapRes.rows.map(r => [r.coupon_code, r]))

  const stats = {
    scanned: wcRes.rows.length,
    affiliate_linked: 0,
    promo_marked: 0,
    mapped: 0,
    skipped: 0,
    unchanged: 0,
  }
  const changes = []

  for (const w of wcRes.rows) {
    const code = String(w.code || '').toLowerCase().trim()
    if (!code) continue

    const affiliateCheck = metaVal(w.meta_data, 'affiliate_check')
    const affwpIdRaw = metaVal(w.meta_data, 'affwp_discount_affiliate')
    const affwpId = affwpIdRaw ? parseInt(affwpIdRaw, 10) : null
    const hasAffiliatePress = !!metaVal(w.meta_data, 'affiliatepress_woo_coupon_affiliate_id')
    const wcPercent = w.discount_type === 'percent' ? parseRate(w.amount) : null

    const existing = existingMap.get(code)

    let kind
    let affiliate = affwpId && affById.has(affwpId) ? affById.get(affwpId) : null

    if (affiliate || affiliateCheck === '1' || hasAffiliatePress) {
      kind = 'affiliate'
      stats.affiliate_linked++
    } else if (affiliateCheck === '0') {
      kind = 'promo'
      stats.promo_marked++
    } else {
      stats.skipped++
      continue
    }

    // WC often has affiliate_check=1 but no affwp_discount_affiliate — keep manual/seed/fuzzy link.
    let matchReason = null
    if (!affiliate && kind === 'affiliate') {
      if (existing?.affiliate_id && affById.has(existing.affiliate_id)) {
        affiliate = affById.get(existing.affiliate_id)
        matchReason = 'preserved existing map'
      } else if (existing?.affiliate_email) {
        const want = existing.affiliate_email.toLowerCase()
        affiliate = affRes.rows.find(a =>
          a.email?.toLowerCase() === want || a.payment_email?.toLowerCase() === want
        ) || null
        if (affiliate) matchReason = 'preserved email from map'
      }
      if (!affiliate) {
        const m = matchCouponToAffiliate({ code, description: w.description }, affRes.rows)
        if (m.affiliate && m.confidence !== 'none') {
          affiliate = m.affiliate
          matchReason = m.reason
        }
      }
    }
    const email = affiliate?.payment_email || affiliate?.email || null
    const name = affiliate?.display_name || affiliate?.username || null
    const affiliateId = affiliate?.affiliate_id ?? null
    const rate = kind === 'affiliate' && wcPercent != null ? wcPercent : null
    const confirmed = kind === 'affiliate' ? !!affiliate : true

    const notes = !affiliate && kind === 'affiliate'
      ? (existing?.notes || 'WC affiliate coupon — no affwp_discount_affiliate in WooCommerce')
      : (matchReason && kind === 'affiliate'
        ? `Auto-matched: ${matchReason} (WC missing affwp_discount_affiliate)`
        : (existing?.notes || null))

    const row = {
      coupon_code: code,
      kind,
      affiliate_name: name,
      affiliate_email: email,
      affiliate_id: affiliateId,
      rate,
      confirmed,
      notes,
    }

    const prior = existingMap.get(code)
    const changed = !prior
      || prior.kind !== row.kind
      || prior.affiliate_id !== row.affiliate_id
      || (prior.affiliate_email || '') !== (row.affiliate_email || '')
      || (prior.affiliate_name || '') !== (row.affiliate_name || '')
      || parseRate(prior.rate) !== row.rate
      || !!prior.confirmed !== !!row.confirmed
      || (prior.notes || '') !== (row.notes || '')

    if (!changed) {
      stats.unchanged++
      continue
    }

    changes.push(row)
    if (!dryRun) {
      await pool.query(`
        INSERT INTO coupon_map
          (coupon_code, kind, affiliate_name, affiliate_email, affiliate_id, rate, confirmed, notes, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
        ON CONFLICT (coupon_code) DO UPDATE SET
          kind=EXCLUDED.kind,
          affiliate_name=EXCLUDED.affiliate_name,
          affiliate_email=EXCLUDED.affiliate_email,
          affiliate_id=EXCLUDED.affiliate_id,
          rate=EXCLUDED.rate,
          confirmed=EXCLUDED.confirmed,
          notes=EXCLUDED.notes,
          updated_at=NOW()
      `, [row.coupon_code, row.kind, row.affiliate_name, row.affiliate_email,
          row.affiliate_id, row.rate, row.confirmed, row.notes])
    }
    stats.mapped++
  }

  return { stats, changes, dryRun }
}
