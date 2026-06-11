/**
 * Create or reset allowed dashboard users in Supabase Auth.
 * Usage (PowerShell):
 *   $env:SUPABASE_SERVICE_ROLE_KEY = "eyJ..."
 *   node scripts/seed-dashboard-users.js
 *
 * Optional: $env:DASHBOARD_DEFAULT_PASSWORD = "BB400Maple"
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
const password = process.env.DASHBOARD_DEFAULT_PASSWORD || 'BB400Maple'

if (!url || !serviceKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

async function upsertUser(email) {
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listErr) throw listErr

  const existing = list.users.find(u => u.email?.toLowerCase() === email.toLowerCase())

  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      app_metadata: {
        ...existing.app_metadata,
        must_change_password: true,
        password_changed: false,
        dashboard_allowed: true,
      },
    })
    if (error) throw error
    console.log(`  ↻ reset  ${email}`)
    return
  }

  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: {
      must_change_password: true,
      password_changed: false,
      dashboard_allowed: true,
    },
  })
  if (error) throw error
  console.log(`  ✔ created ${email}`)
}

console.log(`Provisioning ${ALLOWED_DASHBOARD_EMAILS.length} dashboard users…`)
for (const email of ALLOWED_DASHBOARD_EMAILS) {
  await upsertUser(email)
}
console.log('Done. Users must change password on first sign-in, then enroll 2FA.')
