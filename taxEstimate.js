// ─────────────────────────────────────────────────────────────────────────────
// Sales Tax Estimator — FREE estimate using static US state AVERAGE rates.
// ─────────────────────────────────────────────────────────────────────────────

import { pool } from './db.js'

export const STATE_RATES = {
  AL: 0.0925, AK: 0.0176, AZ: 0.0837, AR: 0.0945, CA: 0.0857, CO: 0.0777,
  CT: 0.0635, DE: 0.0000, FL: 0.0700, GA: 0.0735, HI: 0.0444, ID: 0.0603,
  IL: 0.0873, IN: 0.0700, IA: 0.0694, KS: 0.0869, KY: 0.0600, LA: 0.0955,
  ME: 0.0550, MD: 0.0600, MA: 0.0625, MI: 0.0600, MN: 0.0746, MS: 0.0707,
  MO: 0.0836, MT: 0.0000, NE: 0.0697, NV: 0.0823, NH: 0.0000, NJ: 0.0660,
  NM: 0.0762, NY: 0.0852, NC: 0.0698, ND: 0.0704, OH: 0.0723, OK: 0.0899,
  OR: 0.0000, PA: 0.0634, RI: 0.0700, SC: 0.0744, SD: 0.0611, TN: 0.0955,
  TX: 0.0820, UT: 0.0719, VT: 0.0624, VA: 0.0577, WA: 0.0938, WV: 0.0655,
  WI: 0.0543, WY: 0.0544, DC: 0.0600,
}

const STATE_NAMES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC', 'washington dc': 'DC',
}

export const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100
export const num = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0 }

export function normalizeUsState(raw) {
  if (!raw) return ''
  const t = String(raw).trim()
  if (!t) return ''
  const up = t.toUpperCase()
  if (up.length === 2 && up in STATE_RATES) return up
  const code = STATE_NAMES[t.toLowerCase()]
  if (code) return code
  if (up.length === 2) return up
  return ''
}

export function parseJson(val) {
  if (!val) return null
  if (typeof val === 'object') return val
  try { return JSON.parse(val) } catch { return null }
}

export function extractShippingAddress(zohoRaw, wcRaw) {
  const z = parseJson(zohoRaw) || {}
  const w = parseJson(wcRaw) || {}
  const ship = z.shipping_address || {}
  const bill = z.billing_address || {}
  const wcShip = w.shipping || {}
  const wcBill = w.billing || {}

  const line1 = String(ship.address || ship.street || wcShip.address_1 || wcBill.address_1 || '').trim()
  const city = String(ship.city || wcShip.city || bill.city || '').trim()
  const zip = String(ship.zip || ship.zipcode || ship.postal_code || wcShip.postcode || '').trim()
  const county = String(ship.county || '').trim()
  const state = normalizeUsState(
    ship.state || ship.state_code || wcShip.state || bill.state || wcBill.state,
  )

  return { line1, city, state, postal_code: zip, county, country: 'US' }
}

export function computeTaxEstimate({ state, subtotal, shipping = 0, exempt = false }) {
  const st = normalizeUsState(state)
  const sub = num(subtotal)
  const ship = num(shipping)
  if (!st) return { error: 'missing_state', state: '', subtotal: round2(sub), shipping: round2(ship) }
  if (!(st in STATE_RATES)) return { error: 'unknown_state', state: st, subtotal: round2(sub), shipping: round2(ship) }
  if (sub <= 0) return { error: 'invalid_subtotal', state: st, subtotal: 0, shipping: round2(ship) }

  const rate = exempt ? 0 : STATE_RATES[st]
  const taxableBase = sub
  const tax = round2(taxableBase * rate)
  const total = round2(sub + ship + tax)

  return {
    subtotal: round2(sub),
    shipping: round2(ship),
    taxable_base: round2(taxableBase),
    state: st,
    rate,
    rate_pct: round2(rate * 100),
    tax,
    total,
    customer_type: exempt ? 'exempt' : 'retail',
    source: 'free_state_avg_rate_table',
    is_estimate: true,
    note: exempt
      ? 'Tax-exempt customer — $0 tax applied.'
      : 'Estimated tax using the state AVERAGE combined rate. Real tax varies by city/ZIP/special district and product taxability.',
  }
}

const SHIP_STATE_SQL = `
  UPPER(TRIM(COALESCE(
    NULLIF(s.raw_json::jsonb->'shipping_address'->>'state', ''),
    NULLIF(s.raw_json::jsonb->'shipping_address'->>'state_code', ''),
    NULLIF(wo.raw::jsonb->'shipping'->>'state', ''),
    NULLIF(s.raw_json::jsonb->'billing_address'->>'state', ''),
    NULLIF(wo.raw::jsonb->'billing'->>'state', '')
  )))
`

export function registerTaxEstimate(app, { normalizeDateParam } = {}) {
  app.get('/api/tax/states', (_req, res) => {
    res.json({ states: Object.keys(STATE_RATES).sort() })
  })

  app.post('/api/tax/estimate', (req, res) => {
    try {
      const b = req.body || {}
      const addr = b.shipping_address || {}
      const exempt = String(b.customer_type || '').toLowerCase() === 'exempt'
      const result = computeTaxEstimate({
        state: addr.state,
        subtotal: b.subtotal,
        shipping: b.shipping_amount,
        exempt,
      })
      if (result.error === 'missing_state') {
        return res.status(400).json({ error: 'shipping_address.state is required (2-letter US state)' })
      }
      if (result.error === 'unknown_state') {
        return res.status(400).json({ error: `Unknown US state: ${result.state}` })
      }
      if (result.error === 'invalid_subtotal') {
        return res.status(400).json({ error: 'subtotal must be a positive number' })
      }
      res.json(result)
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) })
    }
  })

  app.get('/api/tax/orders', async (req, res) => {
    try {
      const {
        number: numberRaw = 'all', offset: offsetRaw = 0, search, status, ship_state,
        date_from, date_to, has_state, order = 'DESC',
      } = req.query

      const fetchAll = numberRaw === 'all' || numberRaw === '0' || Number(numberRaw) === 0
      const offset = fetchAll ? 0 : Math.max(0, Number(offsetRaw) || 0)
      const number = fetchAll ? null : Math.min(Math.max(1, Number(numberRaw) || 50), 5000)

      const vals = []
      const clauses = [`s.order_date IS NOT NULL`]

      if (status) {
        vals.push(status)
        clauses.push(`COALESCE(wo.status, s.status) = $${vals.length}`)
      }
      if (search) {
        vals.push(`%${search}%`)
        clauses.push(`(
          s.salesorder_number ILIKE $${vals.length}
          OR s.customer_name ILIKE $${vals.length}
        )`)
      }
      if (ship_state) {
        vals.push(normalizeUsState(ship_state))
        clauses.push(`${SHIP_STATE_SQL} = $${vals.length}`)
      }
      if (has_state === 'true') {
        clauses.push(`${SHIP_STATE_SQL} IS NOT NULL AND ${SHIP_STATE_SQL} <> ''`)
      } else if (has_state === 'false') {
        clauses.push(`(${SHIP_STATE_SQL} IS NULL OR ${SHIP_STATE_SQL} = '')`)
      }
      const fromDate = normalizeDateParam?.(date_from)
      if (fromDate) {
        vals.push(fromDate)
        clauses.push(`s.order_date::date >= $${vals.length}::date`)
      }
      const toDate = normalizeDateParam?.(date_to)
      if (toDate) {
        vals.push(toDate)
        clauses.push(`s.order_date::date <= $${vals.length}::date`)
      }

      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
      const sortDir = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
      const limitClause = fetchAll
        ? ''
        : `LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`
      const pageVals = fetchAll ? vals : [...vals, number, offset]

      const [{ rows }, { rows: [countRow] }] = await Promise.all([
        pool.query(`
          SELECT
            s.salesorder_id,
            s.salesorder_number,
            s.order_date,
            s.customer_name,
            s.sub_total,
            s.shipping_charge,
            s.total,
            COALESCE(wo.status, s.status) AS status,
            s.raw_json,
            wo.raw AS wc_raw,
            ${SHIP_STATE_SQL} AS ship_state_raw
          FROM sales_orders s
          LEFT JOIN wc_orders wo ON wo.order_number_norm = UPPER(TRIM(s.salesorder_number))
          ${where}
          ORDER BY s.order_date ${sortDir} NULLS LAST, s.salesorder_number ${sortDir}
          ${limitClause}
        `, pageVals),
        pool.query(`
          SELECT COUNT(*)::int AS total
          FROM sales_orders s
          LEFT JOIN wc_orders wo ON wo.order_number_norm = UPPER(TRIM(s.salesorder_number))
          ${where}
        `, vals),
      ])

      let sumSubtotal = 0
      let sumShipping = 0
      let sumTax = 0
      let sumTotal = 0
      let withState = 0
      let missingState = 0

      const items = rows.map((row) => {
        const shipping_address = extractShippingAddress(row.raw_json, row.wc_raw)
        const subtotal = num(row.sub_total)
        const shipping = num(row.shipping_charge)
        const taxResult = shipping_address.state
          ? computeTaxEstimate({ state: shipping_address.state, subtotal, shipping })
          : { error: 'missing_state', subtotal: round2(subtotal), shipping: round2(shipping), tax: 0, total: round2(subtotal + shipping), rate_pct: 0, state: '' }

        if (shipping_address.state) withState += 1
        else missingState += 1

        if (!taxResult.error) {
          sumSubtotal += taxResult.subtotal
          sumShipping += taxResult.shipping
          sumTax += taxResult.tax
          sumTotal += taxResult.total
        } else {
          sumSubtotal += subtotal
          sumShipping += shipping
          sumTotal += subtotal + shipping
        }

        return {
          salesorder_id: row.salesorder_id,
          salesorder_number: row.salesorder_number,
          order_date: row.order_date ? String(row.order_date).slice(0, 10) : null,
          customer_name: row.customer_name,
          status: row.status,
          sub_total: round2(subtotal),
          shipping_charge: round2(shipping),
          order_total: round2(num(row.total)),
          shipping_address,
          ship_state_raw: row.ship_state_raw || null,
          tax: taxResult.error ? null : {
            state: taxResult.state,
            rate_pct: taxResult.rate_pct,
            tax: taxResult.tax,
            total_with_tax: taxResult.total,
            is_estimate: taxResult.is_estimate,
            source: taxResult.source,
          },
          tax_error: taxResult.error || null,
        }
      })

      res.json({
        items,
        total: countRow.total,
        summary: {
          orders_count: items.length,
          with_shipping_state: withState,
          missing_shipping_state: missingState,
          total_subtotal: round2(sumSubtotal),
          total_shipping: round2(sumShipping),
          total_estimated_tax: round2(sumTax),
          total_with_tax: round2(sumTotal),
        },
        source: 'free_state_avg_rate_table',
        is_estimate: true,
      })
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) })
    }
  })
}
