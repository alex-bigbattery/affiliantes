import { pool } from './db.js'

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
 * Map WooCommerce coupons → coupon_map using AffiliateWP affiliate IDs stored
 * in WC meta (affwp_discount_affiliate). Commission rate prefers AffiliateWP
 * affiliate.rate; falls back to existing coupon_map.rate; then WC percent amount.
 */
export async function runCouponMapSync({ dryRun = false } = {}) {
  const [wcRes, affRes, mapRes] = await Promise.all([
    pool.query(`SELECT code, amount, discount_type, description, meta_data FROM wc_coupons`),
    pool.query(`SELECT affiliate_id, display_name, username, email, payment_email, rate FROM awp_affiliates`),
    pool.query(`SELECT coupon_code, kind, affiliate_name, affiliate_email, affiliate_id, rate, confirmed FROM coupon_map`),
  ])

  const affById = new Map(affRes.rows.map(a => [a.affiliate_id, a]))
  const affByEmail = new Map()
  for (const a of affRes.rows) {
    for (const e of [a.payment_email, a.email]) {
      if (e) affByEmail.set(e.toLowerCase(), a)
    }
  }
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

    let kind
    let affiliate = null
    const existing = existingMap.get(code)

    if (affwpId && affById.has(affwpId)) {
      affiliate = affById.get(affwpId)
    } else {
      const emailHint = existing?.affiliate_email?.toLowerCase()
      if (emailHint && affByEmail.has(emailHint)) {
        affiliate = affByEmail.get(emailHint)
      }
    }

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
    const email = affiliate?.payment_email || affiliate?.email || existing?.affiliate_email || null
    const name = affiliate?.display_name || affiliate?.username || existing?.affiliate_name || null
    const affiliateId = affiliate?.affiliate_id ?? existing?.affiliate_id ?? null

    const awpRate = parseRate(affiliate?.rate)
    let rate
    if (existing?.confirmed && existing.rate != null) {
      rate = parseRate(existing.rate)
    } else if (awpRate != null) {
      rate = awpRate
    } else if (existing?.rate != null) {
      rate = parseRate(existing.rate)
    } else if (kind === 'affiliate' && wcPercent != null) {
      rate = wcPercent
    } else {
      rate = null
    }

    const confirmed = kind === 'affiliate'
      ? !!(existing?.confirmed || (affiliate && awpRate != null))
      : (existing?.confirmed ?? true)

    const notes = !affiliate && kind === 'affiliate'
      ? (existing?.notes || 'WC affiliate coupon — AffiliateWP ID missing or not synced')
      : (existing?.notes || null)

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

    const changed = !existing
      || existing.kind !== row.kind
      || existing.affiliate_id !== row.affiliate_id
      || (existing.affiliate_email || '') !== (row.affiliate_email || '')
      || (existing.affiliate_name || '') !== (row.affiliate_name || '')
      || parseRate(existing.rate) !== row.rate
      || !!existing.confirmed !== !!row.confirmed

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
          affiliate_name=COALESCE(EXCLUDED.affiliate_name, coupon_map.affiliate_name),
          affiliate_email=COALESCE(EXCLUDED.affiliate_email, coupon_map.affiliate_email),
          affiliate_id=COALESCE(EXCLUDED.affiliate_id, coupon_map.affiliate_id),
          rate=EXCLUDED.rate,
          confirmed=EXCLUDED.confirmed,
          notes=COALESCE(EXCLUDED.notes, coupon_map.notes),
          updated_at=NOW()
      `, [row.coupon_code, row.kind, row.affiliate_name, row.affiliate_email,
          row.affiliate_id, row.rate, row.confirmed, row.notes])
    }
    stats.mapped++
  }

  return { stats, changes, dryRun }
}
