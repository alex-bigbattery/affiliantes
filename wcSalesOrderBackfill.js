import { pool } from './db.js'
import { wcProductLineItems } from './orderLineItems.js'

const REAL_WC_STATUSES = new Set(['completed', 'processing', 'on-hold', 'refunded'])

function wcStatusToZoho(status) {
  const s = String(status || '').toLowerCase()
  if (s === 'completed') return 'closed'
  if (s === 'processing' || s === 'on-hold') return 'open'
  if (s === 'refunded') return 'closed'
  return s || 'open'
}

function parseWcRaw(raw) {
  if (!raw) return null
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return null }
  }
  return raw
}

function buildZohoLineItems(wcRaw) {
  const items = []
  for (const li of wcProductLineItems(wcRaw?.line_items)) {
    items.push({
      name: li.name || li.sku || 'Item',
      sku: li.sku || '',
      quantity: Number(li.quantity || 0),
      item_total: Number(li.total ?? li.subtotal ?? 0),
      line_item_type: 'goods',
      is_component: false,
    })
  }
  const shipTotal = Number(wcRaw?.shipping_total || 0)
  if (shipTotal > 0) {
    items.push({
      name: 'Shipping Charge',
      quantity: 1,
      item_total: shipTotal,
      line_item_type: 'service',
    })
  }
  return items
}

export function buildSalesOrderFromWc(row) {
  const wcRaw = parseWcRaw(row.raw)
  const orderDate = row.date_created
    ? String(row.date_created).slice(0, 10)
    : null
  const lineItems = buildZohoLineItems(wcRaw)
  const rawJson = {
    source: 'wc_backfill',
    wc_order_id: row.order_id,
    salesorder_number: row.order_number,
    reference_number: row.order_number,
    customer_name: row.customer_name,
    date: orderDate,
    created_time: row.date_created,
    status: wcStatusToZoho(row.status),
    custom_field_hash: {
      cf_coupon_s: row.coupon_code || '',
    },
    line_items: lineItems,
  }

  return {
    salesorder_id: `wcbf-${row.order_id}`,
    salesorder_number: row.order_number,
    order_date: orderDate,
    reference_number: row.order_number,
    status: wcStatusToZoho(row.status),
    customer_id: null,
    customer_name: row.customer_name,
    salesperson_name: null,
    shipping_charge: Number(wcRaw?.shipping_total || 0) || null,
    delivery_method: null,
    sub_total: Number(row.sub_total ?? row.total ?? 0),
    total: Number(row.total ?? 0),
    last_modified_time: row.date_created,
    raw_json: JSON.stringify(rawJson),
  }
}

/**
 * Insert sales_orders rows from wc_orders missing in Zoho mirror.
 * Skips checkout-draft / cancelled. Safe to re-run (by salesorder_id).
 */
export async function backfillWcOrdersToSalesOrders({
  orderNumbers = null,
  includeDrafts = false,
} = {}) {
  const vals = []
  const extra = []
  if (orderNumbers?.length) {
    vals.push(orderNumbers.map(n => String(n).toUpperCase().trim()))
    extra.push(`AND wo.order_number_norm = ANY($${vals.length})`)
  }
  if (!includeDrafts) {
    extra.push(`AND wo.status = ANY('{completed,processing,on-hold,refunded}')`)
  }

  const { rows } = await pool.query(`
    SELECT wo.*
    FROM wc_orders wo
    WHERE NOT EXISTS (
      SELECT 1 FROM sales_orders s
      WHERE UPPER(TRIM(s.salesorder_number)) = wo.order_number_norm
    )
    ${extra.join('\n    ')}
    ORDER BY wo.date_created DESC NULLS LAST
  `, vals)

  let inserted = 0
  let skipped = 0
  const samples = []

  for (const row of rows) {
    if (!includeDrafts && !REAL_WC_STATUSES.has(String(row.status || '').toLowerCase())) {
      skipped++
      continue
    }
    const so = buildSalesOrderFromWc(row)
    const { rowCount } = await pool.query(`
      INSERT INTO sales_orders (
        salesorder_id, salesorder_number, order_date, reference_number, status,
        customer_id, customer_name, salesperson_name, shipping_charge, delivery_method,
        sub_total, total, last_modified_time, raw_json, synced_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
      ON CONFLICT (salesorder_id) DO UPDATE SET
        salesorder_number=EXCLUDED.salesorder_number,
        order_date=EXCLUDED.order_date,
        reference_number=EXCLUDED.reference_number,
        status=EXCLUDED.status,
        customer_name=EXCLUDED.customer_name,
        shipping_charge=EXCLUDED.shipping_charge,
        sub_total=EXCLUDED.sub_total,
        total=EXCLUDED.total,
        last_modified_time=EXCLUDED.last_modified_time,
        raw_json=EXCLUDED.raw_json,
        synced_at=NOW()
    `, [
      so.salesorder_id, so.salesorder_number, so.order_date, so.reference_number, so.status,
      so.customer_id, so.customer_name, so.salesperson_name, so.shipping_charge, so.delivery_method,
      so.sub_total, so.total, so.last_modified_time, so.raw_json,
    ])
    if (rowCount) inserted++
    if (samples.length < 10) samples.push(so.salesorder_number)
  }

  return { candidates: rows.length, inserted, skipped, samples }
}
