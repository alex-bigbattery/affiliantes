/**
 * Plan B — browser automation: wp-admin → order edit → click Update.
 * Triggers AffiliateWP referral creation (REST API re-save does NOT).
 *
 * Env (.env): WP_ADMIN_USER, WP_ADMIN_PASSWORD
 * Usage:
 *   node scripts/wc-admin-bulk-update.js 215823        (one order — test)
 *   node scripts/wc-admin-bulk-update.js               (all affiliate-coupon orders)
 */
import { config } from 'dotenv'
import { pool } from '../db.js'

config()

const WP_USER = process.env.WP_ADMIN_USER
const WP_PASS = process.env.WP_ADMIN_PASSWORD
const WOO_BASE = (process.env.WOO_STORE_URL || 'https://bigbattery.com').replace(/\/+$/, '')
const DELAY_MS = parseInt(process.env.WC_ADMIN_DELAY_MS || '3000', 10)
const PRE_UPDATE_DELAY_MS = parseInt(process.env.WC_ADMIN_PRE_UPDATE_DELAY_MS || '10000', 10)
const HEADLESS = process.env.WC_ADMIN_HEADLESS === 'true'

if (!WP_USER || !WP_PASS) {
  console.error('Add to .env:\n  WP_ADMIN_USER=your_wp_username\n  WP_ADMIN_PASSWORD=your_wp_password')
  process.exit(1)
}

let chromium
try {
  ({ chromium } = await import('playwright'))
} catch {
  console.error('Run: npm install playwright && npx playwright install chromium')
  process.exit(1)
}

async function loadIds() {
  const cliIds = process.argv.slice(2).map(Number).filter(Boolean)
  if (cliIds.length) return cliIds

  const COUPON = `LOWER(TRIM(s.raw_json::jsonb->'custom_field_hash'->>'cf_coupon_s'))`
  const VALID = `NULLIF(${COUPON}, '') IS NOT NULL AND ${COUPON} NOT IN ('.','-','n/a','na','none')`
  const { rows } = await pool.query(`
    SELECT DISTINCT wo.order_id AS wc_order_id, s.salesorder_number
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
  await page.goto(`${WOO_BASE}/wp-login.php`, { waitUntil: 'domcontentloaded' })
  if (await page.locator('#wpadminbar').count()) return

  await page.fill('#user_login', WP_USER)
  await page.fill('#user_pass', WP_PASS)
  await page.click('#wp-submit')
  await page.waitForSelector('#wpadminbar', { timeout: 45000 })
  console.log('  ✔ Logged in to wp-admin')
}

async function readAffiliateBox(page) {
  const selectors = [
    '#affiliatewp-order-referral',
    '#affwp-order-referral',
    '.affwp-order-referral',
    '[id*="affwp"]',
    'text=/AffiliateWP/i',
  ]
  for (const sel of selectors) {
    const el = page.locator(sel).first()
    if (await el.count()) {
      return (await el.innerText().catch(() => '')).trim()
    }
  }
  return ''
}

/** Kunal: affiliate name must load before Update — 10s total is enough. */
async function waitForAffiliateName(page) {
  const waitMs = parseInt(process.env.WC_ADMIN_AFFILIATE_WAIT_MS || String(PRE_UPDATE_DELAY_MS), 10)
  const start = Date.now()
  console.log(`   waiting ${waitMs / 1000}s before Update…`)

  while (Date.now() - start < waitMs) {
    const text = await readAffiliateBox(page)
    const hasName = text.length > 10
      && !/loading|select an affiliate|no affiliate/i.test(text)
      && (/affiliate/i.test(text) || /\(\d+\)/.test(text) || /@/.test(text))
    if (hasName) {
      const remaining = waitMs - (Date.now() - start)
      if (remaining > 0) await page.waitForTimeout(remaining)
      console.log(`   ✔ ${text.split('\n').find(l => l.trim().length > 3)?.trim().slice(0, 80) || text.slice(0, 80)}`)
      return text
    }
    await page.waitForTimeout(500)
  }
  return null
}

async function readReferralHint(page) {
  const text = await readAffiliateBox(page)
  return text ? text.slice(0, 200) : null
}

async function clickUpdate(page) {
  await waitForAffiliateName(page)

  const candidates = [
    () => page.getByRole('button', { name: /^Update$/i }).first(),
    () => page.locator('.order_actions button.button-primary').first(),
    () => page.locator('button.save-action').first(),
    () => page.locator('#woocommerce-order-actions button.button-primary').first(),
    () => page.locator('button:has-text("Update")').first(),
  ]

  for (const getBtn of candidates) {
    const btn = getBtn()
    if (await btn.count() && await btn.isVisible().catch(() => false)) {
      await btn.scrollIntoViewIfNeeded()
      await btn.click()
      return 'Update button'
    }
  }
  throw new Error('Update button not found on order page')
}

async function updateOrder(page, id) {
  const url = `${WOO_BASE}/wp-admin/admin.php?page=wc-orders&action=edit&id=${id}`
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForSelector('body.wp-admin', { timeout: 30000 })

  const title = await page.locator('h1, .woocommerce-layout__header-heading').first().innerText().catch(() => '')
  const before = await readReferralHint(page)

  await clickUpdate(page)
  await page.waitForTimeout(DELAY_MS)

  const after = await readReferralHint(page)
  return { id, title: title.trim(), referralBefore: before, referralAfter: after }
}

const ids = await loadIds()
console.log(`Plan B: ${ids.length} order(s) — wp-admin Update (AffiliateWP referral)`)
console.log(`Wait before Update: ${PRE_UPDATE_DELAY_MS / 1000}s per order\n`)

const browser = await chromium.launch({ headless: HEADLESS, slowMo: 80 })
const context = await browser.newContext()
const page = await context.newPage()
await login(page)

const ok = []
const failed = []

for (let i = 0; i < ids.length; i++) {
  const id = ids[i]
  process.stdout.write(`\n[${i + 1}/${ids.length}] WC #${id} `)
  try {
    const result = await updateOrder(page, id)
    ok.push(result)
    console.log(`✔ ${result.title || 'saved'}`)
    if (result.referralAfter) console.log(`   Referral: ${result.referralAfter.slice(0, 120)}`)
    else if (!result.referralBefore) console.log('   ⚠ No referral text visible yet — check AffiliateWP box manually')
  } catch (e) {
    failed.push({ id, error: e.message })
    console.log(`✗ ${e.message}`)
  }
}

console.log(`\n── Summary: ${ok.length} ok, ${failed.length} failed`)
if (failed.length) console.table(failed)

await browser.close()
await pool.end().catch(() => {})
