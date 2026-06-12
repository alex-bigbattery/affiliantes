/**
 * order_commissions — Supabase ledger from Zoho/WC orders (no WordPress writes).
 */
import { pool } from './db.js'

const COUPON_EXPR = `LOWER(TRIM(COALESCE(s.raw_json::jsonb->'custom_field_hash'->>'cf_coupon_s', wo.coupon_code)))`
const VALID_COUPON = `NULLIF(${COUPON_EXPR}, '') IS NOT NULL AND ${COUPON_EXPR} NOT IN ('.','-','n/a','na','none')`
const NET_SALES_ZOHO = `(
  SELECT COALESCE(SUM((li->>'item_total')::numeric), 0)
  FROM jsonb_array_elements(COALESCE(s.raw_json::jsonb->'line_items', '[]'::jsonb)) AS li
  WHERE COALESCE(li->>'name', '') <> 'Shipping Charge'
    AND COALESCE(li->>'line_item_type', '') <> 'service'
    AND NOT COALESCE((li->>'is_component')::boolean, false)
)`
const RATE_EXPR = `COALESCE(
  m.rate,
  NULLIF(REGEXP_REPLACE(COALESCE(a.rate, ''), '[^0-9.]+', '', 'g'), '')::numeric
)`
const REFERRAL_MATCH = `
  LEFT JOIN LATERAL (
    SELECT referral_id, status
    FROM awp_referrals
    WHERE reference IS NOT NULL AND (
      (wo.order_id IS NOT NULL AND TRIM(reference) = wo.order_id::text)
      OR UPPER(TRIM(reference)) = UPPER(TRIM(COALESCE(s.salesorder_number, wo.order_number)))
    )
    ORDER BY referral_id DESC
    LIMIT 1
  ) r ON true
`

const SYNC_SQL = `
  WITH base AS (
    SELECT
      COALESCE(s.salesorder_number, wo.order_number) AS salesorder_number,
      wo.order_id AS wc_order_id,
      COALESCE(
        NULLIF(LEFT(s.order_date, 10), '')::date,
        wo.date_created::date
      ) AS order_date,
      m.affiliate_id,
      m.affiliate_name,
      NULLIF(${COUPON_EXPR}, '') AS coupon_code,
      COALESCE(${NET_SALES_ZOHO}, wo.net_sales, wo.sub_total, 0)::numeric AS net_sales,
      ${RATE_EXPR} AS commission_rate,
      COALESCE(wo.status, s.status) AS order_status,
      r.referral_id AS awp_referral_id,
      r.status AS awp_status
    FROM sales_orders s
    FULL OUTER JOIN wc_orders wo ON wo.order_number_norm = UPPER(TRIM(s.salesorder_number))
    INNER JOIN coupon_map m ON m.coupon_code = ${COUPON_EXPR} AND m.kind = 'affiliate'
    LEFT JOIN awp_affiliates a ON a.affiliate_id = m.affiliate_id
    ${REFERRAL_MATCH}
    WHERE COALESCE(s.salesorder_number, wo.order_number, '') ILIKE 'BB%'
      AND ${VALID_COUPON}
      AND COALESCE(
        NULLIF(LEFT(s.order_date, 10), ''),
        to_char(wo.date_created, 'YYYY-MM-DD')
      ) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
  ),
  calc AS (
    SELECT *,
      ROUND(COALESCE(net_sales, 0) * COALESCE(commission_rate, 0) / 100.0, 2) AS commission_amount,
      CASE
        WHEN awp_status = 'paid' THEN 'paid'
        WHEN awp_status IN ('unpaid', 'pending', 'rejected') THEN awp_status
        WHEN awp_referral_id IS NOT NULL THEN COALESCE(awp_status, 'pending')
        ELSE 'estimated'
      END AS payout_status
    FROM base
    WHERE salesorder_number IS NOT NULL
  )
  INSERT INTO order_commissions (
    salesorder_number, wc_order_id, order_date, affiliate_id, affiliate_name,
    coupon_code, net_sales, commission_rate, commission_amount, order_status,
    awp_referral_id, awp_status, payout_status, updated_at
  )
  SELECT
    salesorder_number, wc_order_id, order_date, affiliate_id, affiliate_name,
    coupon_code, net_sales, commission_rate, commission_amount, order_status,
    awp_referral_id, awp_status, payout_status, NOW()
  FROM calc
  ON CONFLICT (salesorder_number) DO UPDATE SET
    wc_order_id = EXCLUDED.wc_order_id,
    order_date = EXCLUDED.order_date,
    affiliate_id = EXCLUDED.affiliate_id,
    affiliate_name = EXCLUDED.affiliate_name,
    coupon_code = EXCLUDED.coupon_code,
    net_sales = EXCLUDED.net_sales,
    commission_rate = EXCLUDED.commission_rate,
    commission_amount = EXCLUDED.commission_amount,
    order_status = EXCLUDED.order_status,
    awp_referral_id = EXCLUDED.awp_referral_id,
    awp_status = EXCLUDED.awp_status,
    payout_status = CASE
      WHEN order_commissions.payout_status IN ('paid') AND EXCLUDED.payout_status = 'estimated'
        THEN order_commissions.payout_status
      WHEN order_commissions.payout_status NOT IN ('paid', 'unpaid', 'pending', 'rejected', 'estimated')
        THEN EXCLUDED.payout_status
      WHEN order_commissions.payout_status IN ('unpaid', 'pending', 'rejected')
        AND EXCLUDED.awp_referral_id IS NULL
        THEN order_commissions.payout_status
      ELSE EXCLUDED.payout_status
    END,
    updated_at = NOW()
`

export function mapCommissionRow(row) {
  const wpLinked = row.awp_referral_id != null
  return {
    referral_id: wpLinked ? row.awp_referral_id : row.salesorder_number,
    salesorder_number: row.salesorder_number,
    affiliate_id: row.affiliate_id,
    affiliate_name: row.affiliate_name,
    amount: parseFloat(row.commission_amount || 0),
    currency: 'USD',
    status: row.payout_status,
    date: row.order_date,
    reference: row.wc_order_id ? String(row.wc_order_id) : row.salesorder_number,
    description: [row.salesorder_number, row.coupon_code, row.affiliate_name].filter(Boolean).join(' · '),
    coupon_code: row.coupon_code,
    net_sales: row.net_sales != null ? parseFloat(row.net_sales) : null,
    commission_rate: row.commission_rate != null ? parseFloat(row.commission_rate) : null,
    order_status: row.order_status,
    source: wpLinked ? 'affiliatewp' : 'orders',
    wp_editable: wpLinked,
    awp_referral_id: row.awp_referral_id,
  }
}

export async function syncOrderCommissions() {
  const { rowCount } = await pool.query(SYNC_SQL)
  const { rows: [summary] } = await pool.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE payout_status = 'estimated')::int AS estimated,
      COUNT(*) FILTER (WHERE payout_status = 'paid')::int AS paid,
      COUNT(*) FILTER (WHERE payout_status = 'unpaid')::int AS unpaid,
      COUNT(*) FILTER (WHERE payout_status = 'pending')::int AS pending,
      ROUND(COALESCE(SUM(commission_amount), 0)::numeric, 2) AS total_commission,
      ROUND(COALESCE(SUM(commission_amount) FILTER (WHERE payout_status <> 'paid'), 0)::numeric, 2) AS open_commission
    FROM order_commissions
  `)
  return { upserted: rowCount, ...summary }
}

export async function orderCommissionsMonthly(months = 12) {
  const { rows } = await pool.query(`
    SELECT
      TO_CHAR(order_date, 'YYYY-MM') AS month,
      COUNT(*)::int AS count,
      ROUND(COALESCE(SUM(commission_amount), 0)::numeric, 2) AS amount,
      ROUND(COALESCE(SUM(commission_amount) FILTER (WHERE payout_status = 'paid'), 0)::numeric, 2) AS paid,
      ROUND(COALESCE(SUM(commission_amount) FILTER (WHERE payout_status <> 'paid'), 0)::numeric, 2) AS unpaid
    FROM order_commissions
    WHERE order_date >= (CURRENT_DATE - ($1::int * INTERVAL '1 month'))
    GROUP BY 1 ORDER BY 1
  `, [months])
  const map = {}
  for (const r of rows) {
    map[r.month] = {
      count: r.count,
      amount: parseFloat(r.amount),
      paid: parseFloat(r.paid),
      unpaid: parseFloat(r.unpaid),
    }
  }
  return map
}

export async function findOrderCommissionById(id) {
  const key = String(id || '').trim()
  if (!key) return null
  let { rows } = await pool.query(`SELECT * FROM order_commissions WHERE salesorder_number = $1`, [key])
  if (rows.length) return rows[0]
  if (/^BB/i.test(key)) {
    const bare = key.replace(/^BB/i, '')
    ;({ rows } = await pool.query(`SELECT * FROM order_commissions WHERE salesorder_number = $1`, [bare]))
    if (rows.length) return rows[0]
  } else if (/^\d+$/.test(key)) {
    ;({ rows } = await pool.query(`SELECT * FROM order_commissions WHERE salesorder_number = $1`, [`BB${key}`]))
    if (rows.length) return rows[0]
    ;({ rows } = await pool.query(`SELECT * FROM order_commissions WHERE awp_referral_id = $1`, [parseInt(key, 10)]))
    if (rows.length) return rows[0]
  }
  return null
}

export async function queryOrderCommissions({
  number = 50, offset = 0, status, affiliate_id, date, end_date, reference, orderby = 'date', order = 'DESC',
}) {
  const vals = []
  const clauses = []
  if (status && status !== 'all') {
    if (status === 'open') {
      clauses.push(`payout_status <> 'paid'`)
    } else {
      vals.push(status)
      clauses.push(`payout_status = $${vals.length}`)
    }
  }
  if (affiliate_id) {
    vals.push(parseInt(affiliate_id, 10))
    clauses.push(`affiliate_id = $${vals.length}`)
  }
  if (reference) {
    vals.push(`%${reference}%`)
    clauses.push(`(salesorder_number ILIKE $${vals.length} OR wc_order_id::text ILIKE $${vals.length})`)
  }
  if (date) {
    vals.push(date)
    clauses.push(`order_date >= $${vals.length}::date`)
  }
  if (end_date) {
    vals.push(end_date)
    clauses.push(`order_date <= $${vals.length}::date`)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const sortMap = {
    referral_id: 'awp_referral_id',
    date: 'order_date',
    amount: 'commission_amount',
    affiliate_id: 'affiliate_id',
    status: 'payout_status',
  }
  const sortCol = sortMap[orderby] || 'order_date'
  const sortDir = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
  const filterVals = [...vals]
  const pageVals = [...vals]
  const lim = `$${pageVals.push(Math.min(Math.max(parseInt(number, 10) || 50, 1), 5000))}`
  const off = `$${pageVals.push(Math.max(parseInt(offset, 10) || 0, 0))}`

  const [{ rows }, { rows: [countRow] }] = await Promise.all([
    pool.query(`
      SELECT * FROM order_commissions ${where}
      ORDER BY ${sortCol} ${sortDir} NULLS LAST, salesorder_number ${sortDir}
      LIMIT ${lim} OFFSET ${off}
    `, pageVals),
    pool.query(`SELECT COUNT(*)::int AS total FROM order_commissions ${where}`, filterVals),
  ])
  return { items: rows.map(mapCommissionRow), total: countRow.total }
}

export async function updateCommissionStatus(salesorderNumber, status) {
  const allowed = ['estimated', 'paid', 'unpaid', 'pending', 'rejected']
  if (!allowed.includes(status)) {
    const err = new Error(`status must be one of: ${allowed.join(', ')}`)
    err.status = 400
    throw err
  }
  const { rows: [row] } = await pool.query(`
    UPDATE order_commissions SET payout_status = $2, updated_at = NOW()
    WHERE salesorder_number = $1
    RETURNING *
  `, [salesorderNumber, status])
  if (!row) {
    const err = new Error('Commission row not found')
    err.status = 404
    throw err
  }
  return mapCommissionRow(row)
}

export async function commissionStatsSummary() {
  const { rows: [s] } = await pool.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE payout_status = 'paid')::int AS paid,
      COUNT(*) FILTER (WHERE payout_status = 'unpaid')::int AS unpaid,
      COUNT(*) FILTER (WHERE payout_status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE payout_status = 'estimated')::int AS estimated,
      COUNT(*) FILTER (WHERE payout_status = 'rejected')::int AS rejected,
      ROUND(COALESCE(SUM(commission_amount), 0)::numeric, 2) AS total_amount,
      ROUND(COALESCE(SUM(commission_amount) FILTER (WHERE payout_status = 'paid'), 0)::numeric, 2) AS amount_paid,
      ROUND(COALESCE(SUM(commission_amount) FILTER (WHERE payout_status <> 'paid'), 0)::numeric, 2) AS amount_open
    FROM order_commissions
  `)
  return s
}
