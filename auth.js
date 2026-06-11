import ws from 'ws'
import { createClient } from '@supabase/supabase-js'
import { isAllowedEmail } from './authConfig.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY

/** Node 20 on Render has no native WebSocket — pass ws as realtime transport */
const supabaseServerOptions = {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: ws },
}

const supabaseAuth = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, supabaseServerOptions)
  : null

const supabaseAdmin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, supabaseServerOptions)
  : null

export function authConfigured() {
  return !!supabaseAuth
}

/** Verify Supabase JWT and allowlisted email. */
export function requireAuth() {
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

    req.authUser = user
    req.accessToken = token
    next()
  }
}

export function registerAuthRoutes(app) {
  app.post('/api/auth/password-setup-complete', requireAuth(), async (req, res) => {
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
