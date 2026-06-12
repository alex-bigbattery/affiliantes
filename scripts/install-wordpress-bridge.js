/**
 * Install BB Affiliate Dashboard Bridge on bigbattery.com via wp-admin.
 * Requires in .env: WP_ADMIN_USER, WP_ADMIN_PASSWORD, AFFWP_PUBLIC_KEY, AFFWP_TOKEN
 *
 * Usage: npm run install:wp-bridge
 */
import { config } from 'dotenv'
import { execSync } from 'child_process'
import { readFileSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
config({ path: join(root, '.env') })

const WP_USER = process.env.WP_ADMIN_USER
const WP_PASS = process.env.WP_ADMIN_PASSWORD
const PUB = process.env.AFFWP_PUBLIC_KEY
const TOK = process.env.AFFWP_TOKEN || process.env.AFFWP_SECRET_KEY
const STORE = (process.env.WOO_STORE_URL || 'https://bigbattery.com').replace(/\/+$/, '')

if (!WP_USER || !WP_PASS) {
  console.error('Falta acceso a WordPress. Agrega a .env:')
  console.error('  WP_ADMIN_USER=tu_usuario_wp')
  console.error('  WP_ADMIN_PASSWORD=tu_contraseña_wp')
  process.exit(1)
}
if (!PUB || !TOK) {
  console.error('Falta AFFWP_PUBLIC_KEY y AFFWP_TOKEN en .env')
  process.exit(1)
}

let chromium
try {
  ({ chromium } = await import('playwright'))
} catch {
  console.error('Run: npx playwright install chromium')
  process.exit(1)
}

function buildPluginPhp() {
  const template = readFileSync(join(root, 'wordpress', 'bb-affiliate-dashboard-bridge.php'), 'utf8')
  const inject = `
if (!defined('BB_AFFWP_INSTALL_PUBLIC_KEY')) {
    define('BB_AFFWP_INSTALL_PUBLIC_KEY', ${JSON.stringify(PUB)});
    define('BB_AFFWP_INSTALL_TOKEN', ${JSON.stringify(TOK)});
}
`
  return template.replace("if (!defined('ABSPATH')) {", `${inject}\nif (!defined('ABSPATH')) {`)
}

function buildZip(outPath) {
  const pluginDir = join(root, '.tmp', 'bb-affiliate-dashboard-bridge')
  rmSync(join(root, '.tmp'), { recursive: true, force: true })
  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(join(pluginDir, 'bb-affiliate-dashboard-bridge.php'), buildPluginPhp())
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${pluginDir}' -DestinationPath '${outPath}' -Force"`,
    { stdio: 'inherit' },
  )
}

async function login(page) {
  await page.goto(`${STORE}/wp-login.php`, { waitUntil: 'domcontentloaded' })
  if (await page.locator('#wpadminbar').count()) return
  await page.fill('#user_login', WP_USER)
  await page.fill('#user_pass', WP_PASS)
  await page.click('#wp-submit')
  await page.waitForSelector('#wpadminbar', { timeout: 60000 })
  console.log('✔ Login wp-admin OK')
}

async function main() {
  const zipPath = join(root, '.tmp', 'bb-affiliate-dashboard-bridge.zip')
  console.log('Building plugin zip with API keys…')
  buildZip(zipPath)

  const browser = await chromium.launch({ headless: process.env.WC_ADMIN_HEADLESS !== 'false' })
  const page = await browser.newPage()
  try {
    await login(page)

    await page.goto(`${STORE}/wp-admin/plugins.php`, { waitUntil: 'domcontentloaded' })
    const row = page.locator('tr[data-plugin*="bb-affiliate-dashboard-bridge"]')
    if (await row.count()) {
      if (await row.locator('.activate a').count()) {
        await row.locator('.activate a').click()
        await page.waitForTimeout(2000)
      }
      console.log('✔ Plugin ya instalado')
    } else {
      await page.goto(`${STORE}/wp-admin/plugin-install.php?tab=upload`, { waitUntil: 'domcontentloaded' })
      await page.setInputFiles('#pluginzip', zipPath)
      await page.click('#install-plugin-submit')
      await page.waitForSelector('.wrap .button-primary', { timeout: 120000 })
      const activate = page.locator('.wrap a.button-primary').filter({ hasText: /Activate/i })
      if (await activate.count()) await activate.first().click()
      console.log('✔ Plugin instalado y activado')
    }

    const { probeAffwpWriteSupport } = await import('../affwpClient.js')
    await page.waitForTimeout(3000)
    const support = await probeAffwpWriteSupport(11482)
    console.log('Write support:', support)
    if (support.bridge_plugin) {
      console.log('\n✔ Listo. Prueba: npm run probe:affwp-pay -- 11482 paid')
    } else {
      console.warn('\nBridge aún no responde — reintenta en 30s: npm run probe:affwp-pay -- 11482 paid')
    }
  } finally {
    await browser.close()
    rmSync(join(root, '.tmp'), { recursive: true, force: true })
  }
}

main().catch(e => { console.error(e.message || e); process.exit(1) })
