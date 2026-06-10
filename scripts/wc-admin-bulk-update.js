/**
 * Browser automation: open each WC order in wp-admin and click Update.
 * Requires: npm install playwright && npx playwright install chromium
 * Env: WP_ADMIN_USER, WP_ADMIN_PASSWORD (add to .env)
 * Usage: node scripts/wc-admin-bulk-update.js [wc_order_id ...]
 *        node scripts/wc-admin-bulk-update.js   (all affiliate-coupon orders from DB)
 */
import { config } from 'dotenv'
import { pool } from '../db.js'

config()

const WP_USER = process.env.WP_ADMIN_USER
const WP_PASS = process.env.WP_ADMIN_PASSWORD
const WOO_BASE = (process.env.WOO_STORE_URL || 'https://bigbattery.com').replace(/\/+$/, '')
const DELAY_MS = parseInt(process.env.WC_ADMIN_DELAY_MS || '2500', 10)

if (!WP_USER || !WP_PASS) {
  console.error('Set WP_ADMIN_USER and WP_ADMIN_PASSWORD in .env')
  process.exit(1)
}

let chromium
try {
  ({ chromium } = await import('playwright'))
} catch {
  console.error('Install Playwright first: npm install playwright && npx playwright install chromium')
  process.exit(1)
}

async function loadIds() {
  const cliIds = process.argv.slice(2).map(Number).filter(Boolean)
  if (cliIds.length) return cliIds

  const COUPON = `LOWER(TRIM(s.raw_json::jsonb->'custom_field_hash'->>'cf_coupon_s'))`
  const VALID = `NULLIF(${COUPON}, '') IS NOT NULL AND ${COUPON} NOT IN ('.','-','n/a','na','none')`
  const { rows } = await pool.query(`
    SELECT DISTINCT wo.order_id AS wc_order_id
    FROM sales_orders s
    JOIN wc_orders wo ON wo.order_number_norm = UPPER(TRIM(s.salesorder_number))
    LEFT JOIN coupon_map m ON m.coupon_code = ${COUPON}
    WHERE wo.order_id IS NOT NULL
      AND ${VALID} AND m.affiliate_id IS NOT NULL AND m.kind = 'affiliate'
    ORDER BY wo.order_id DESC
  `)
  return rows.map(r => r.wc_order_id)
}

async function login(page) {
  await page.goto(`${WOO_BASE}/wp-admin/`, { waitUntil: 'domcontentloaded' })
  if (await page.locator('#wpadminbar').count()) return
  await page.fill('#user_login', WP_USER)
  await page.fill('#user_pass', WP_PASS)
  await page.click('#wp-submit')
  await page.waitForSelector('#wpadminbar', { timeout: 30000 })
}

async function clickUpdate(page) {
  const selectors = [
    '.order_actions button.button-primary',
    'button.save-action',
    '#post button.button-primary',
    'button:has-text("Update")',
    'input#publish',
    '#publish',
  ]
  for (const sel of selectors) {
    const btn = page.locator(sel).first()
    if (await btn.count()) {
      await btn.click()
      return sel
    }
  }
  throw new Error('Update button not found')
}

const ids = await loadIds()
console.log(`Will update ${ids.length} WooCommerce orders in wp-admin…`)

const browser = await chromium.launch({ headless: false, slowMo: 50 })
const page = await browser.newPage()
await login(page)

const ok = []
const failed = []

for (let i = 0; i < ids.length; i++) {
  const id = ids[i]
  const url = `${WOO_BASE}/wp-admin/admin.php?page=wc-orders&action=edit&id=${id}`
  process.stdout.write(`\r  ${i + 1}/${ids.length} WC #${id}…`)
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(800)
    const used = await clickUpdate(page)
    await page.waitForTimeout(DELAY_MS)
    ok.push({ id, selector: used })
  } catch (e) {
    failed.push({ id, error: e.message })
  }
}

console.log(`\n✔ ${ok.length} updated, ${failed.length} failed`)
if (failed.length) console.table(failed)

await browser.close()
await pool.end().catch(() => {})
