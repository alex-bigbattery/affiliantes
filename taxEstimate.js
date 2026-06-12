// Sales Tax Estimator — multi-provider + Supabase overrides

import { pool } from './db.js'
import { resolveSalesOrderDate, effectiveOrderDateExpr, effectiveOrderDateFromClause, effectiveOrderDateToClause } from './dateUtils.js'
import {
  STATE_RATES, normalizeUsState, round2, num,
  extractShippingAddress,
} from './taxShared.js'
import {
  TAX_PROVIDERS, PROVIDER_LABELS,
  computeOrderTax, computeStateAvg,
} from './taxProviders.js'

export { STATE_RATES, normalizeUsState, round2, num, extractShippingAddress }

/** Web (WooCommerce) orders only — excludes Zoho SO bulk invoices. */
const TAX_ORDER_SCOPE = `s.salesorder_number ILIKE 'BB%'`

/** Not collected / reversed — exclude from tax estimates. */
const TAX_EXCLUDED_STATUSES = ['void', 'cancelled', 'canceled', 'refunded']

const SHIP_STATE_SQL = `
  UPPER(TRIM(COALESCE(
    NULLIF(s.raw_json::jsonb->'shipping_address'->>'state', ''),
    NULLIF(s.raw_json::jsonb->'shipping_address'->>'state_code', ''),
    NULLIF(wo.raw::jsonb->'shipping'->>'state', ''),
    NULLIF(s.raw_json::jsonb->'billing_address'->>'state', ''),
    NULLIF(wo.raw::jsonb->'billing'->>'state', '')
  )))
`

function parseProvider(raw) {
  const p = String(raw || 'state_avg').toLowerCase()
  return TAX_PROVIDERS.includes(p) ? p : 'state_avg'
}

async function loadOverrides(numbers) {
  if (!numbers?.length) return new Map()
  const { rows } = await pool.query(`
    SELECT salesorder_number, rate, tax_amount, provider, notes, updated_by, updated_at
    FROM sales_tax_overrides
    WHERE salesorder_number = ANY($1)
  `, [numbers])
  return new Map(rows.map(r => [r.salesorder_number, r]))
}

function taxPayload(result) {
  if (result.error) return null
  return {
    state: result.state,
    rate_pct: result.rate_pct,
    tax: result.tax,
    total_with_tax: result.total,
    is_estimate: result.is_estimate,
    source: result.source,
    override: !!result.override,
    note: result.note || null,
    breakdown: result.breakdown || null,
    provider_error: result.provider_error || null,
  }
}

async function mapOrderTax(row, { provider, overrides, cache, useOverrides }) {
  const shipping_address = extractShippingAddress(row.raw_json, row.wc_raw)
  const subtotal = num(row.sub_total)
  const shipping = num(row.shipping_charge)
  const override = useOverrides ? overrides.get(row.salesorder_number) : null

  const taxResult = await computeOrderTax({
    provider,
    address: shipping_address,
    subtotal,
    shipping,
    override,
    cache,
  })

  return {
    salesorder_id: row.salesorder_id,
    salesorder_number: row.salesorder_number,
    order_date: row.effective_order_date || resolveSalesOrderDate(row.order_date, row.raw_json, row.wc_date_created),
    customer_name: row.customer_name,
    status: row.status,
    sub_total: round2(subtotal),
    shipping_charge: round2(shipping),
    order_total: round2(num(row.total)),
    shipping_address,
    ship_state_raw: row.ship_state_raw || null,
    has_override: overrides.has(row.salesorder_number),
    tax: taxPayload(taxResult),
    tax_error: taxResult.error || null,
  }
}

export function registerTaxEstimate(app, { normalizeDateParam } = {}) {
  app.get('/api/tax/providers', (_req, res) => {
    res.json({
      providers: TAX_PROVIDERS.map(id => ({
        id,
        label: PROVIDER_LABELS[id],
        configured: id === 'state_avg' || id === 'salestaxzip'
          || (id === 'ziptax' && !!process.env.ZIPTAX_API_KEY)
          || (id === 'taxlocus' && !!process.env.TAXLOCUS_API_KEY),
      })),
    })
  })

  app.get('/api/tax/states', (_req, res) => {
    res.json({ states: Object.keys(STATE_RATES).sort() })
  })

  app.get('/api/tax/overrides', async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT salesorder_number, rate, tax_amount, provider, notes, updated_by, updated_at
        FROM sales_tax_overrides
        ORDER BY updated_at DESC
        LIMIT 5000
      `)
      res.json({ items: rows })
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) })
    }
  })

  app.put('/api/tax/overrides/:salesorder_number', async (req, res) => {
    try {
      const salesorder_number = String(req.params.salesorder_number || '').trim()
      if (!salesorder_number) return res.status(400).json({ error: 'salesorder_number required' })

      const ratePct = req.body?.rate_pct != null ? Number(req.body.rate_pct) : null
      const rateRaw = req.body?.rate != null ? Number(req.body.rate) : null
      let rate = rateRaw
      if (ratePct != null && Number.isFinite(ratePct)) rate = ratePct / 100
      if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
        return res.status(400).json({ error: 'rate_pct (0–100) or rate (0–1) required' })
      }

      const tax_amount = req.body?.tax_amount != null ? round2(Number(req.body.tax_amount)) : null
      const notes = req.body?.notes != null ? String(req.body.notes).trim() : null
      const provider = parseProvider(req.body?.provider || 'state_avg')
      const updated_by = req.authUser?.email || null

      const { rows: [row] } = await pool.query(`
        INSERT INTO sales_tax_overrides (salesorder_number, rate, tax_amount, provider, notes, updated_by, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (salesorder_number) DO UPDATE SET
          rate = EXCLUDED.rate,
          tax_amount = EXCLUDED.tax_amount,
          provider = EXCLUDED.provider,
          notes = EXCLUDED.notes,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
        RETURNING *
      `, [salesorder_number, rate, tax_amount, provider, notes, updated_by])

      res.json(row)
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) })
    }
  })

  app.delete('/api/tax/overrides/:salesorder_number', async (req, res) => {
    try {
      const salesorder_number = String(req.params.salesorder_number || '').trim()
      await pool.query(`DELETE FROM sales_tax_overrides WHERE salesorder_number = $1`, [salesorder_number])
      res.json({ ok: true })
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) })
    }
  })

  app.post('/api/tax/estimate', async (req, res) => {
    try {
      const b = req.body || {}
      const addr = b.shipping_address || {}
      const exempt = String(b.customer_type || '').toLowerCase() === 'exempt'
      const provider = parseProvider(b.provider)

      if (provider === 'state_avg' && exempt) {
        const r = computeStateAvg({
          state: addr.state,
          subtotal: b.subtotal,
          shipping: b.shipping_amount,
          exempt: true,
        })
        return res.json(r)
      }

      const result = await computeOrderTax({
        provider,
        address: addr,
        subtotal: b.subtotal,
        shipping: b.shipping_amount,
        cache: new Map(),
      })

      if (result.error === 'missing_state') {
        return res.status(400).json({ error: 'shipping_address.state or postal_code is required' })
      }
      if (result.error === 'unknown_state') {
        return res.status(400).json({ error: `Unknown US state: ${result.state}` })
      }
      if (result.error === 'invalid_subtotal') {
        return res.status(400).json({ error: 'subtotal must be a positive number' })
      }
      if (result.error && !result.tax) {
        return res.status(502).json({ error: result.error, provider, source: result.source })
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
        provider: providerRaw = 'state_avg',
      } = req.query

      const provider = parseProvider(providerRaw)
      const fetchAll = numberRaw === 'all' || numberRaw === '0' || Number(numberRaw) === 0
      const offset = fetchAll ? 0 : Math.max(0, Number(offsetRaw) || 0)
      const number = fetchAll ? null : Math.min(Math.max(1, Number(numberRaw) || 50), 5000)

      const vals = []
      const clauses = [
        `s.order_date IS NOT NULL`,
        TAX_ORDER_SCOPE,
        `LOWER(COALESCE(wo.status, s.status, '')) NOT IN (${TAX_EXCLUDED_STATUSES.map(s => `'${s}'`).join(', ')})`,
      ]

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
        clauses.push(effectiveOrderDateFromClause('s', 'wo', `$${vals.length}`))
      }
      const toDate = normalizeDateParam?.(date_to)
      if (toDate) {
        vals.push(toDate)
        clauses.push(effectiveOrderDateToClause('s', 'wo', `$${vals.length}`))
      }

      const effectiveDate = effectiveOrderDateExpr('s', 'wo')
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
      const sortDir = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
      const limitClause = fetchAll ? '' : `LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`
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
            wo.date_created AS wc_date_created,
            ${effectiveDate} AS effective_order_date,
            ${SHIP_STATE_SQL} AS ship_state_raw
          FROM sales_orders s
          LEFT JOIN wc_orders wo ON wo.order_number_norm = UPPER(TRIM(s.salesorder_number))
          ${where}
          ORDER BY ${effectiveDate} ${sortDir} NULLS LAST, s.salesorder_number ${sortDir}
          ${limitClause}
        `, pageVals),
        pool.query(`
          SELECT COUNT(*)::int AS total
          FROM sales_orders s
          LEFT JOIN wc_orders wo ON wo.order_number_norm = UPPER(TRIM(s.salesorder_number))
          ${where}
        `, vals),
      ])

      const orderNumbers = rows.map(r => r.salesorder_number).filter(Boolean)
      const overrides = await loadOverrides(orderNumbers)
      const cache = new Map()
      const useOverrides = provider === 'state_avg'

      const items = []
      for (const row of rows) {
        items.push(await mapOrderTax(row, { provider, overrides, cache, useOverrides }))
      }

      let sumSubtotal = 0
      let sumShipping = 0
      let sumTax = 0
      let sumTotal = 0
      let withState = 0
      let missingState = 0

      for (const item of items) {
        if (item.shipping_address?.state) withState += 1
        else missingState += 1
        sumSubtotal += item.sub_total
        sumShipping += item.shipping_charge
        if (item.tax) {
          sumTax += item.tax.tax
          sumTotal += item.tax.total_with_tax
        } else {
          sumTotal += item.sub_total + item.shipping_charge
        }
      }

      res.json({
        items,
        total: countRow.total,
        provider,
        provider_label: PROVIDER_LABELS[provider],
        summary: {
          orders_count: items.length,
          with_shipping_state: withState,
          missing_shipping_state: missingState,
          total_subtotal: round2(sumSubtotal),
          total_shipping: round2(sumShipping),
          total_estimated_tax: round2(sumTax),
          total_with_tax: round2(sumTotal),
          unique_rate_lookups: cache.size,
        },
        is_estimate: true,
      })
    } catch (e) {
      res.status(500).json({ error: e.message || String(e) })
    }
  })
}

// Legacy export for tests
export function computeTaxEstimate(opts) {
  return computeStateAvg(opts)
}
