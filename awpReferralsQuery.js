/**
 * Query AffiliateWP referrals synced to awp_referrals (full WP history).
 */
import { pool } from './db.js'

export function mapAwpReferralRow(row) {
  return {
    referral_id: row.referral_id,
    affiliate_id: row.affiliate_id,
    affiliate_name: row.affiliate_name,
    amount: parseFloat(row.amount || 0),
    currency: row.currency || 'USD',
    status: row.status,
    date: row.date,
    reference: row.reference,
    description: row.description,
    salesorder_number: row.salesorder_number || null,
    in_ledger: !!row.in_ledger,
    source: 'affiliatewp',
    wp_editable: true,
  }
}

export async function queryAwpReferrals({
  number = 50, offset = 0, status, affiliate_id, date, end_date, search,
  orderby = 'date', order = 'DESC',
}) {
  const vals = []
  const clauses = []

  if (status && status !== 'all') {
    if (status === 'open') {
      clauses.push(`r.status <> 'paid'`)
    } else {
      vals.push(status)
      clauses.push(`r.status = $${vals.length}`)
    }
  }
  if (affiliate_id) {
    vals.push(parseInt(affiliate_id, 10))
    clauses.push(`r.affiliate_id = $${vals.length}`)
  }
  if (search) {
    vals.push(`%${search}%`)
    clauses.push(`(
      r.reference ILIKE $${vals.length}
      OR r.description ILIKE $${vals.length}
      OR r.referral_id::text ILIKE $${vals.length}
      OR COALESCE(a.display_name, '') ILIKE $${vals.length}
      OR COALESCE(a.payment_email, '') ILIKE $${vals.length}
      OR COALESCE(oc.salesorder_number, '') ILIKE $${vals.length}
    )`)
  }
  if (date) {
    vals.push(date)
    clauses.push(`r.date >= $${vals.length}::date`)
  }
  if (end_date) {
    vals.push(end_date)
    clauses.push(`r.date < ($${vals.length}::date + INTERVAL '1 day')`)
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const sortMap = {
    referral_id: 'r.referral_id',
    date: 'r.date',
    amount: 'r.amount',
    affiliate_id: 'r.affiliate_id',
    status: 'r.status',
  }
  const sortCol = sortMap[orderby] || 'r.date'
  const sortDir = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
  const filterVals = [...vals]
  const pageVals = [...vals]
  const lim = `$${pageVals.push(Math.min(Math.max(parseInt(number, 10) || 50, 1), 5000))}`
  const off = `$${pageVals.push(Math.max(parseInt(offset, 10) || 0, 0))}`

  const fromSql = `
    FROM awp_referrals r
    LEFT JOIN awp_affiliates a ON a.affiliate_id = r.affiliate_id
    LEFT JOIN order_commissions oc ON oc.awp_referral_id = r.referral_id
  `

  const [{ rows }, { rows: [countRow] }] = await Promise.all([
    pool.query(`
      SELECT
        r.*,
        COALESCE(a.display_name, a.username) AS affiliate_name,
        oc.salesorder_number,
        (oc.salesorder_number IS NOT NULL) AS in_ledger
      ${fromSql}
      ${where}
      ORDER BY ${sortCol} ${sortDir} NULLS LAST, r.referral_id ${sortDir}
      LIMIT ${lim} OFFSET ${off}
    `, pageVals),
    pool.query(`SELECT COUNT(*)::int AS total ${fromSql} ${where}`, filterVals),
  ])

  return { items: rows.map(mapAwpReferralRow), total: countRow.total }
}
