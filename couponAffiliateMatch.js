/**
 * Suggest / resolve affiliate for WC coupons missing affwp_discount_affiliate.
 */

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function tokens(s) {
  return norm(s).split(/\s+/).filter(t => t.length > 2)
}

/** High-confidence manual overrides (code → affiliate_id). */
export const COUPON_AFFILIATE_OVERRIDES = {
  karr10: 299,
  karr5: 299,
  kgsgarage10: 295,
}

/** Description / code hints when no WC meta affiliate id. */
const DESCRIPTION_HINTS = [
  { match: /project\s*karr|karr\d/i, affiliateId: 299, reason: 'Project Karr → Kerry Koehler' },
  { match: /kg'?s?\s*garage|keith\s*gill/i, affiliateId: 295, reason: "KG's Garage / Keith Gill" },
  { match: /jarrod\s*tocci|tocci/i, affiliateId: 230, reason: 'Jarrod Tocci' },
  { match: /kyle\s*spicer|spicer/i, affiliateId: 293, reason: 'Kyle Spicer' },
  { match: /willie\s*fenters|fentertainment/i, affiliateId: 139, reason: 'Ryan/Willie Fenters' },
  { match: /kira\s*belan|solarrolla/i, affiliateId: 294, reason: 'Kira Belan / Solarrolla' },
  { match: /jeff\s*stege|stege/i, affiliateId: 236, reason: 'Jeff Stege' },
  { match: /dale\s*marshall|solarhav/i, affiliateId: 219, reason: 'Dale Marshall' },
  { match: /dave\s*(and|&)\s*sonya/i, affiliateId: 248, reason: 'Dave & Sonya' },
  { match: /landtohouse/i, affiliateId: 273, reason: 'landtohouse' },
  { match: /zac|nowyouknow/i, affiliateId: 18, reason: 'NowYouKnow / Zac' },
  { match: /joe\s*williams|averagejoe/i, affiliateId: 53, reason: 'Joe Williams' },
  { match: /mike\s*nacko|mikenacko/i, affiliateId: 301, reason: 'mikenacko' },
]

function scoreAffiliate(affiliate, hay) {
  const fields = [
    affiliate.display_name,
    affiliate.username,
    affiliate.email,
    affiliate.payment_email,
  ].filter(Boolean).join(' ')
  const affTokens = new Set(tokens(fields))
  let score = 0
  for (const t of tokens(hay)) {
    if (affTokens.has(t)) score += 3
    if (norm(fields).includes(t)) score += 1
  }
  if (affiliate.username && hay.includes(norm(affiliate.username).replace(/\s/g, ''))) score += 4
  return score
}

/**
 * @returns {{ affiliate: object|null, confidence: 'override'|'hint'|'fuzzy'|'none', reason: string, score?: number }}
 */
export function matchCouponToAffiliate({ code, description }, affiliates) {
  const c = String(code || '').toLowerCase().trim()
  const desc = String(description || '')
  const hay = `${c} ${desc}`

  const overrideId = COUPON_AFFILIATE_OVERRIDES[c]
  if (overrideId) {
    const affiliate = affiliates.find(a => a.affiliate_id === overrideId) || null
    return { affiliate, confidence: 'override', reason: `Manual override for ${c}` }
  }

  for (const hint of DESCRIPTION_HINTS) {
    if (hint.match.test(hay)) {
      const affiliate = affiliates.find(a => a.affiliate_id === hint.affiliateId) || null
      if (affiliate) return { affiliate, confidence: 'hint', reason: hint.reason }
    }
  }

  let best = null
  let bestScore = 0
  for (const a of affiliates) {
    const s = scoreAffiliate(a, hay)
    if (s > bestScore) {
      bestScore = s
      best = a
    }
  }
  if (best && bestScore >= 4) {
    return { affiliate: best, confidence: 'fuzzy', reason: `Name/token match (score ${bestScore})`, score: bestScore }
  }

  return { affiliate: null, confidence: 'none', reason: 'No confident match' }
}

export function isWcAffiliateCouponWithoutUser(meta) {
  if (!Array.isArray(meta)) return false
  const affiliateCheck = meta.find(m => m.key === 'affiliate_check')?.value
  const affwp = meta.find(m => m.key === 'affwp_discount_affiliate')?.value
  const affPress = meta.find(m => m.key === 'affiliatepress_woo_coupon_affiliate_id')?.value
  return affiliateCheck === '1' && !affwp && !affPress
}
