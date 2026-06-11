// Allowed dashboard sign-ins (lowercase). Enforced on API and at user provisioning.
export const ALLOWED_DASHBOARD_EMAILS = [
  'alex.g@bigbattery.com',
  'honey.g@bigbattery.com',
  'receivables@bigbattery.com',
  'jennifer.z@bigbattery.com',
  'santiago.o@bigbattery.com',
  'marshall@bigbattery.com',
  'kunal.d@bigbattery.com',
]

export const DASHBOARD_EMAIL_DOMAIN = '@bigbattery.com'

export const ALLOWED_EMAIL_SET = new Set(ALLOWED_DASHBOARD_EMAILS.map(e => e.toLowerCase()))

/** "alex.g" or "alex.g@bigbattery.com" → alex.g@bigbattery.com */
export function toDashboardEmail(input) {
  const raw = String(input || '').trim().toLowerCase()
  if (!raw) return ''
  if (raw.includes('@')) return raw
  return `${raw}${DASHBOARD_EMAIL_DOMAIN}`
}

export function isAllowedEmail(email) {
  return ALLOWED_EMAIL_SET.has(String(email || '').toLowerCase())
}
