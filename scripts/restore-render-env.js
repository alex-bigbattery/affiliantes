/**
 * Restore Render env vars for affiliate-dashboard-api (merge-safe PUT).
 * Copies DATABASE_URL from commission-backend; reads Supabase keys from .env.
 *
 * Usage: node scripts/restore-render-env.js
 */
import { config } from 'dotenv'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '..', '.env') })

const API_KEY = process.env.RENDER_API_KEY
const SERVICE_ID = process.env.RENDER_SERVICE_ID || 'srv-d8kms7v7f7vs73e187q0'
const COMMISSION_SERVICE_ID = 'srv-d8fl3fbtqb8s73f2spjg'
const API = 'https://api.render.com/v1'

if (!API_KEY) {
  console.error('Set RENDER_API_KEY in .env')
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
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  return data
}

async function getEnvVar(serviceId, key) {
  const row = await api('GET', `/services/${serviceId}/env-vars/${key}`)
  return row.value
}

async function listEnvVars(serviceId) {
  const rows = await api('GET', `/services/${serviceId}/env-vars?limit=100`)
  return rows.map(row => {
    const ev = row.envVar || row
    return { key: ev.key, value: ev.value }
  })
}

async function main() {
  console.log(`Restoring env for ${SERVICE_ID}…`)

  const existing = await listEnvVars(SERVICE_ID)
  const merged = new Map(existing.map(v => [v.key, v]))

  let databaseUrl
  try {
    databaseUrl = await getEnvVar(COMMISSION_SERVICE_ID, 'DATABASE_URL')
    console.log('✔ DATABASE_URL copied from commission-backend')
  } catch (e) {
    console.error('Could not read DATABASE_URL from commission-backend:', e.message)
    process.exit(1)
  }

  const required = {
    DATABASE_URL: databaseUrl,
    SUPABASE_URL: process.env.SUPABASE_URL || 'https://evgmeszyxjzrrbrzznhv.supabase.co',
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    WOO_STORE_URL: process.env.WOO_STORE_URL || 'https://bigbattery.com',
    WOO_CONSUMER_KEY: process.env.WOO_CONSUMER_KEY,
    WOO_CONSUMER_SECRET: process.env.WOO_CONSUMER_SECRET,
    AFFWP_PUBLIC_KEY: process.env.AFFWP_PUBLIC_KEY,
    AFFWP_TOKEN: process.env.AFFWP_TOKEN,
    AFFWP_SECRET_KEY: process.env.AFFWP_SECRET_KEY,
    SYNC_INTERVAL_MINUTES: '30',
    NODE_VERSION: '20',
    PG_POOL_MAX: '3',
    ALLOWED_ORIGINS: 'https://affiliantes.vercel.app,https://affiliates.vercel.app',
  }

  for (const [key, value] of Object.entries(required)) {
    if (value) merged.set(key, { key, value })
    else if (!merged.has(key)) console.warn(`⚠ Missing ${key} — add to .env or Render dashboard`)
  }

  await api('PUT', `/services/${SERVICE_ID}/env-vars`, [...merged.values()])
  console.log('✔ Env vars merged:', [...merged.keys()].sort().join(', '))

  await api('POST', `/services/${SERVICE_ID}/deploys`, { clearCache: 'do_not_clear' })
  console.log('✔ Deploy triggered')
}

main().catch(e => { console.error(e.message); process.exit(1) })
