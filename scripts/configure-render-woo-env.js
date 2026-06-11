/**
 * Push WooCommerce env vars to the Render backend service.
 * Usage (PowerShell):
 *   $env:RENDER_API_KEY = "rnd_..."
 *   node scripts/configure-render-woo-env.js
 *
 * Reads WOO_* from .env in project root. Does not print secret values.
 */
import { config } from 'dotenv'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
config({ path: join(root, '.env') })

const API_KEY = process.env.RENDER_API_KEY
const SERVICE_NAME = process.env.RENDER_SERVICE_NAME || 'affiliate-dashboard-api'
const API = 'https://api.render.com/v1'

if (!API_KEY) {
  console.error('Set RENDER_API_KEY (from https://dashboard.render.com/u/settings#api-keys)')
  process.exit(1)
}

const envVars = [
  { key: 'WOO_STORE_URL', value: process.env.WOO_STORE_URL || 'https://bigbattery.com' },
  { key: 'WOO_CONSUMER_KEY', value: process.env.WOO_CONSUMER_KEY },
  { key: 'WOO_CONSUMER_SECRET', value: process.env.WOO_CONSUMER_SECRET },
  { key: 'AFFWP_PUBLIC_KEY', value: process.env.AFFWP_PUBLIC_KEY },
  { key: 'AFFWP_TOKEN', value: process.env.AFFWP_TOKEN || process.env.AFFWP_SECRET_KEY },
  { key: 'AFFWP_SECRET_KEY', value: process.env.AFFWP_SECRET_KEY || process.env.AFFWP_TOKEN },
]

const requiredWoo = envVars.slice(0, 3)
for (const v of requiredWoo) {
  if (!v.value) {
    console.error(`Missing ${v.key} in .env`)
    process.exit(1)
  }
}

const affwpPresent = envVars.slice(3).some(v => v.value)
if (!affwpPresent) {
  console.warn('⚠ No AFFWP_* keys in .env — Pay/Mark paid will fail until you add them.')
}

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  }
  return data
}

async function findServiceId() {
  let cursor = null
  do {
    const q = new URLSearchParams({ limit: '100' })
    if (cursor) q.set('cursor', cursor)
    const page = await api('GET', `/services?${q}`)
    for (const row of page) {
      const s = row.service || row
      if (s.name === SERVICE_NAME) return s.id
    }
    cursor = page.length ? page[page.length - 1]?.cursor : null
  } while (cursor)
  throw new Error(`Service not found: ${SERVICE_NAME}`)
}

async function main() {
  const serviceId = await findServiceId()
  console.log(`Found service "${SERVICE_NAME}" (${serviceId})`)

  const existing = await api('GET', `/services/${serviceId}/env-vars`)
  const merged = new Map(existing.map(row => {
    const ev = row.envVar || row
    return [ev.key, { key: ev.key, value: ev.value }]
  }))
  for (const v of envVars) {
    if (v.value) merged.set(v.key, v)
  }

  await api('PUT', `/services/${serviceId}/env-vars`, [...merged.values()])
  console.log('✔ Env vars updated:', envVars.filter(v => v.value).map(v => v.key).join(', '))

  await api('POST', `/services/${serviceId}/deploys`, { clearCache: 'do_not_clear' })
  console.log('✔ Deploy triggered — wait ~1–3 min, then check /api/sync/status')
}

main().catch(e => { console.error(e.message); process.exit(1) })
