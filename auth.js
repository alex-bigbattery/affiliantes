import { createClient } from '@supabase/supabase-js'
import { isAllowedEmail } from './authConfig.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY

const supabaseAuth = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null

const supabaseAdmin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null

function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1]
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    return JSON.parse(json)
  } catch {
    return {}
  }
}

export function authConfigured() {
  return !!supabaseAuth
}

/** Verify Supabase JWT, allowlist email, and (by default) require MFA (aal2). */
export function requireAuth({ allowAal1 = false } = {}) {
  return async (req, res, next) => {
    if (!supabaseAuth) {
      return res.status(503).json({ error: 'Auth not configured on server (SUPABASE_URL / SUPABASE_ANON_KEY)' })
    }

    const header = req.headers.authorization || ''
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    const token = header.slice(7)
    const { data: { user }, error } = await supabaseAuth.auth.getUser(token)
    if (error || !user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    if (!isAllowedEmail(user.email)) {
      return res.status(403).json({ error: 'Access denied' })
    }

    const claims = decodeJwtPayload(token)
    const aal = claims.aal || 'aal1'
    if (!allowAal1 && aal !== 'aal2') {
      return res.status(401).json({ error: 'MFA verification required' })
    }

    req.authUser = user
    req.accessToken = token
    next()
  }
}

export function registerAuthRoutes(app) {
  app.post('/api/auth/password-setup-complete', requireAuth({ allowAal1: true }), async (req, res) => {
    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Server admin client not configured (SUPABASE_SERVICE_ROLE_KEY)' })
    }

    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(req.authUser.id, {
      app_metadata: {
        ...req.authUser.app_metadata,
        must_change_password: false,
        password_changed: true,
      },
    })

    if (error) {
      console.error('[auth] password-setup-complete', error)
      return res.status(500).json({ error: error.message })
    }

    res.json({ ok: true, user: { id: data.user.id, email: data.user.email } })
  })
}
