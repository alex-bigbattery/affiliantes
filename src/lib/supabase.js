import { createClient } from '@supabase/supabase-js'
import { getRememberMe, setRememberMe } from './authPreferences.js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const AUTH_STORAGE_KEY = 'affiliate-dashboard-auth'

export const authEnabled = Boolean(url && key)

if (!authEnabled) {
  console.warn('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — auth disabled')
}

let _client = null

function authStorage() {
  if (typeof window === 'undefined') return undefined
  return getRememberMe() ? window.localStorage : window.sessionStorage
}

function buildClient() {
  return createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: authStorage(),
      storageKey: AUTH_STORAGE_KEY,
    },
  })
}

export function getSupabase() {
  if (!authEnabled) return null
  if (!_client) {
    _client = buildClient()
  }
  return _client
}

export function reconfigureSupabase(rememberMe) {
  setRememberMe(rememberMe)
  _client = buildClient()
  return _client
}

/** @deprecated Prefer getSupabase() */
export const supabase = authEnabled
  ? new Proxy(
      {},
      {
        get(_target, prop) {
          const client = getSupabase()
          if (!client) return undefined
          const value = client[prop]
          return typeof value === 'function' ? value.bind(client) : value
        },
      },
    )
  : null
