/**
 * Remove all TOTP/MFA factors for allowed dashboard users (Supabase Auth admin).
 * Usage: npm run remove:mfa-factors
 */
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { ALLOWED_DASHBOARD_EMAILS } from '../authConfig.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '..', '.env') })

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY

if (!url || !serviceKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

async function listFactors(userId) {
  const res = await fetch(`${url}/auth/v1/admin/users/${userId}/factors`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`list factors ${userId}: ${res.status} ${body}`)
  }
  const data = await res.json()
  return data?.factors ?? data ?? []
}

async function deleteFactor(userId, factorId) {
  const res = await fetch(`${url}/auth/v1/admin/users/${userId}/factors/${factorId}`, {
    method: 'DELETE',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`delete factor ${factorId}: ${res.status} ${body}`)
  }
}

async function main() {
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listErr) throw listErr

  const allowed = new Set(ALLOWED_DASHBOARD_EMAILS.map(e => e.toLowerCase()))
  let removed = 0

  for (const user of list.users) {
    const email = user.email?.toLowerCase()
    if (!email || !allowed.has(email)) continue

    let factors
    try {
      factors = await listFactors(user.id)
    } catch (e) {
      console.warn(`[skip] ${email}: ${e.message}`)
      continue
    }

    const totp = Array.isArray(factors) ? factors : []
    if (!totp.length) {
      console.log(`[ok] ${email} — no MFA factors`)
      continue
    }

    for (const f of totp) {
      await deleteFactor(user.id, f.id)
      console.log(`[removed] ${email} — factor ${f.id} (${f.factor_type || f.type || 'totp'})`)
      removed++
    }
  }

  console.log(`Done. Removed ${removed} factor(s).`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
