/**
 * Push AFFWP_* keys to Render (no WOO_* required).
 * Usage: node scripts/configure-render-affwp-env.js
 */
import { config } from 'dotenv'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '..', '.env') })

const API_KEY = process.env.RENDER_API_KEY
const SERVICE_NAME = process.env.RENDER_SERVICE_NAME || 'affiliate-dashboard-api'
const API = 'https://api.render.com/v1'

const pub = process.env.AFFWP_PUBLIC_KEY
const tok = process.env.AFFWP_TOKEN || process.env.AFFWP_SECRET_KEY

if (!API_KEY) {
  console.error('Set RENDER_API_KEY in .env')
  process.exit(1)
}
if (!pub || !tok) {
  console.error('Set AFFWP_PUBLIC_KEY and AFFWP_TOKEN in .env')
  process.exit(1)
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
  for (const [key, value] of [
    ['AFFWP_PUBLIC_KEY', pub],
    ['AFFWP_TOKEN', tok],
    ['AFFWP_SECRET_KEY', tok],
  ]) {
    merged.set(key, { key, value })
  }

  await api('PUT', `/services/${serviceId}/env-vars`, [...merged.values()])
  console.log('✔ AFFWP keys pushed to Render')

  await api('POST', `/services/${serviceId}/deploys`, { clearCache: 'do_not_clear' })
  console.log('✔ Deploy triggered (~1–3 min)')
}

main().catch(e => { console.error(e.message); process.exit(1) })
