/** SQL fragments for refund detection on orders joined to wc_orders */

function isRefundedSql(alias) {
  return `
  CASE
    WHEN ${alias}.order_id IS NULL THEN false
    WHEN ${alias}.status ILIKE '%refund%' THEN true
    WHEN COALESCE(jsonb_array_length(${alias}.raw->'refunds'), 0) > 0 THEN true
    WHEN EXISTS (
      SELECT 1 FROM awp_referrals r
      WHERE r.reference = ${alias}.order_id::text AND r.status IN ('rejected', 'refunded')
    ) THEN true
    ELSE false
  END`
}

function wcRefundsSql(alias) {
  return `COALESCE(${alias}.raw->'refunds', '[]'::jsonb)`
}

function affiliateReferralsSql(alias) {
  return `(
    SELECT COALESCE(json_agg(json_build_object(
      'referral_id', r.referral_id,
      'status', r.status,
      'amount', r.amount,
      'date', r.date,
      'description', r.description
    ) ORDER BY r.date DESC), '[]'::json)
    FROM awp_referrals r
    WHERE ${alias}.order_id IS NOT NULL AND r.reference = ${alias}.order_id::text
  )`
}

export const IS_REFUNDED_SQL = isRefundedSql('wo')
export const WC_REFUNDS_SQL = wcRefundsSql('wo')
export const AFFILIATE_REFERRALS_SQL = affiliateReferralsSql('wo')

export const WC_ONLY_IS_REFUNDED_SQL = isRefundedSql('w')
export const WC_ONLY_WC_REFUNDS_SQL = wcRefundsSql('w')
export const WC_ONLY_AFFILIATE_REFERRALS_SQL = affiliateReferralsSql('w')

function parseJsonArray(v) {
  if (!v) return []
  if (Array.isArray(v)) return v
  if (typeof v === 'string') {
    try { return JSON.parse(v) } catch { return [] }
  }
  return []
}

export function enrichRefundFields(row) {
  const wcRefunds = parseJsonArray(row.wc_refunds)
  const referrals = parseJsonArray(row.affiliate_referrals)

  const refund_details = wcRefunds.map(r => ({
    id: r.id,
    amount: Math.abs(Number.parseFloat(r.total) || 0),
    reason: (r.reason || '').trim() || 'Refund',
  }))

  const refund_amount = refund_details.reduce((s, r) => s + r.amount, 0) || null

  const { wc_refunds, affiliate_referrals, is_refunded, ...rest } = row

  return {
    ...rest,
    is_refunded: !!is_refunded,
    refund_amount,
    refund_details,
    affiliate_referrals: referrals.map(r => ({
      referral_id: r.referral_id,
      status: r.status,
      amount: r.amount != null ? Number.parseFloat(r.amount) : null,
      date: r.date,
      description: r.description,
    })),
  }
}
