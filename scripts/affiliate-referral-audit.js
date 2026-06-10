import { config } from 'dotenv'
import axios from 'axios'
import { pool } from '../db.js'

config()

const COUPON = `LOWER(TRIM(s.raw_json::jsonb->'custom_field_hash'->>'cf_coupon_s'))`
const VALID = `NULLIF(${COUPON}, '') IS NOT NULL AND ${COUPON} NOT IN ('.','-','n/a','na','none')`
const NET_SALES = `(
  SELECT COALESCE(SUM((li->>'item_total')::numeric), 0)
  FROM jsonb_array_elements(COALESCE(s.raw_json::jsonb->'line_items', '[]'::jsonb)) AS li
  WHERE COALESCE(li->>'name', '') <> 'Shipping Charge'
    AND COALESCE(li->>'line_item_type', '') <> 'service'
    AND NOT COALESCE((li->>'is_component')::boolean, false)
)`

const AUTH = Buffer.from(`${process.env.AFFWP_PUBLIC_KEY}:${process.env.AFFWP_TOKEN}`).toString('base64')
const AWP = 'https://bigbattery.com/wp-json/affwp/v1'

async function fetchAllReferrals() {
  const all = []
  let offset = 0
  while (true) {
    const res = await axios.get(`${AWP}/referrals`, {
      headers: { Authorization: `Basic ${AUTH}` },
      params: { number: 100, offset },
      timeout: 30000,
    })
    const page = Array.isArray(res.data) ? res.data : []
    if (!page.length) break
    all.push(...page)
    if (page.length < 100) break
    offset += 100
    await new Promise(r => setTimeout(r, 400))
  }
  return all
}

function normRef(v) {
  return String(v || '').toLowerCase().replace(/\s+/g, '').trim()
}

function buildReferralIndex(referrals) {
  const byRef = new Map()
  const byWcId = new Map()
  const byBb = new Map()

  for (const r of referrals) {
    const ref = normRef(r.reference)
    const desc = normRef(r.description)
    const hay = `${ref} ${desc} ${normRef(r.custom)}`

    const entry = {
      referral_id: r.referral_id,
      affiliate_id: r.affiliate_id,
      amount: parseFloat(r.amount || 0),
      status: r.status,
      reference: r.reference,
      description: r.description,
      date: r.date,
    }

    if (ref) {
      if (!byRef.has(ref)) byRef.set(ref, [])
      byRef.get(ref).push(entry)
    }

    const wcMatch = hay.match(/\b(\d{5,7})\b/)
    if (wcMatch) {
      const id = wcMatch[1]
      if (!byWcId.has(id)) byWcId.set(id, [])
      byWcId.get(id).push(entry)
    }

    const bbMatch = hay.match(/bb\d{4,7}/i) || ref.match(/bb\d{4,7}/i)
    if (bbMatch) {
      const bb = normRef(bbMatch[0])
      if (!byBb.has(bb)) byBb.set(bb, [])
      byBb.get(bb).push(entry)
    }
  }

  return { byRef, byWcId, byBb }
}

function findReferral(order, index) {
  const bb = normRef(order.salesorder_number)
  const wcId = String(order.wc_order_id || '')
  const refs = [
    ...(index.byBb.get(bb) || []),
    ...(index.byWcId.get(wcId) || []),
    ...(index.byRef.get(bb) || []),
    ...(index.byRef.get(wcId) || []),
  ]
  const unique = [...new Map(refs.map(r => [r.referral_id, r])).values()]
  const matched = unique.filter(r => r.affiliate_id === order.affiliate_id)
  return matched.length ? matched : unique
}

// ── Orders with affiliate coupon (WC-linked) ──
const { rows: orders } = await pool.query(`
  SELECT
    s.salesorder_number,
    s.order_date,
    s.customer_name,
    s.sub_total,
    s.total,
    NULLIF(${COUPON}, '') AS coupon_code,
    m.affiliate_name,
    m.affiliate_id,
    m.rate AS coupon_rate,
    wo.order_id AS wc_order_id,
    ROUND((${NET_SALES}) * m.rate / 100.0)::numeric, 2) AS est_commission
  FROM sales_orders s
  JOIN wc_orders wo ON wo.order_number_norm = UPPER(TRIM(s.salesorder_number))
  LEFT JOIN coupon_map m ON m.coupon_code = ${COUPON}
  WHERE wo.order_id IS NOT NULL
    AND ${VALID} AND m.affiliate_id IS NOT NULL AND m.kind = 'affiliate'
  ORDER BY s.order_date DESC
`)

console.log('Fetching AffiliateWP referrals (live API)…')
let liveReferrals = []
try {
  liveReferrals = await fetchAllReferrals()
  console.log(`  ${liveReferrals.length} referrals from AffiliateWP API\n`)
} catch (e) {
  console.warn('  Live API failed, using Supabase cache:', e.message)
  const { rows } = await pool.query(`SELECT * FROM awp_referrals ORDER BY date DESC`)
  liveReferrals = rows.map(r => ({
    referral_id: r.referral_id,
    affiliate_id: r.affiliate_id,
    amount: parseFloat(r.amount),
    status: r.status,
    reference: r.reference,
    description: r.description,
    custom: r.custom,
    date: r.date,
  }))
  console.log(`  ${liveReferrals.length} referrals from Supabase cache\n`)
}

const index = buildReferralIndex(liveReferrals)

const withRef = []
const missing = []
const wrongAff = []

for (const o of orders) {
  const matches = findReferral(o, index)
  if (!matches.length) {
    missing.push(o)
  } else {
    const best = matches[0]
    if (best.affiliate_id !== o.affiliate_id) {
      wrongAff.push({ ...o, referral: best })
    } else {
      withRef.push({ ...o, referral: best })
    }
  }
}

console.log('═══════════════════════════════════════════════════')
console.log(' AFFILIATE COUPON ORDERS vs AffiliateWP REFERRALS')
console.log('═══════════════════════════════════════════════════')
console.log(`Total affiliate-coupon orders (WC-linked): ${orders.length}`)
console.log(`  ✔ With referral match:     ${withRef.length}`)
console.log(`  ✗ Missing referral:        ${missing.length}`)
console.log(`  ⚠ Referral, wrong affiliate: ${wrongAff.length}`)
console.log('')

const estTotal = orders.reduce((s, o) => s + parseFloat(o.est_commission || 0), 0)
const refTotal = withRef.reduce((s, o) => s + parseFloat(o.referral.amount || 0), 0)
console.log(`Est. commission (Zoho subtotal × WC %): $${estTotal.toFixed(2)}`)
console.log(`Matched referral amounts (AffiliateWP):   $${refTotal.toFixed(2)}`)
console.log('')

if (missing.length) {
  console.log('── MISSING REFERRAL (first 25) ──')
  console.table(missing.slice(0, 25).map(o => ({
    order: o.salesorder_number,
    wc_id: o.wc_order_id,
    date: String(o.order_date).slice(0, 10),
    coupon: o.coupon_code,
    affiliate: o.affiliate_name,
    awp_id: o.affiliate_id,
    est: `$${o.est_commission}`,
  })))
  if (missing.length > 25) console.log(`  … and ${missing.length - 25} more`)
  console.log('')
}

if (wrongAff.length) {
  console.log('── WRONG AFFILIATE ON REFERRAL ──')
  console.table(wrongAff.slice(0, 10).map(o => ({
    order: o.salesorder_number,
    expected: `${o.affiliate_name} (${o.affiliate_id})`,
    got: `ref #${o.referral.referral_id} aff ${o.referral.affiliate_id}`,
    amount: o.referral.amount,
  })))
}

// Sample matched
if (withRef.length) {
  console.log('── MATCHED SAMPLE (5 most recent) ──')
  console.table(withRef.slice(0, 5).map(o => ({
    order: o.salesorder_number,
    wc_id: o.wc_order_id,
    affiliate: o.affiliate_name,
    est: `$${o.est_commission}`,
    referral: `#${o.referral.referral_id}`,
    ref_amt: `$${o.referral.amount}`,
    status: o.referral.status,
    ref_field: (o.referral.reference || o.referral.description || '').slice(0, 40),
  })))
}

if (missing.length) {
  const wcIds = missing.map(o => o.wc_order_id).join(' ')
  console.log('── RE-RUN MISSING (Plan B) ──')
  console.log(`node scripts/wc-admin-bulk-update.js ${wcIds}`)
}

await pool.end()
