import { useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { api, setApiAccessToken } from '../api'
import { isAllowedEmail, toDashboardEmail } from '../../authConfig.js'
import { AuthContext } from './authReactContext.js'
import Login from '../pages/Login'
import { Spinner } from '../components/Layout'

export function mustChangePassword(user) {
  if (user?.user_metadata?.password_changed === true) return false
  return user?.app_metadata?.must_change_password === true
}

async function resolveAuthStep(session) {
  if (!session?.user) return 'signed_out'

  const email = session.user.email?.toLowerCase()
  if (!isAllowedEmail(email)) {
    await supabase.auth.signOut()
    throw new Error('This account is not authorized for the dashboard.')
  }

  if (mustChangePassword(session.user)) return 'password_change'

  const { data: aal, error: aalErr } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aalErr) throw aalErr

  const { data: factors, error: fErr } = await supabase.auth.mfa.listFactors()
  if (fErr) throw fErr

  const verifiedTotp = (factors?.totp || []).filter(f => f.status === 'verified')
  if (!verifiedTotp.length) return 'mfa_enroll'

  if (aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') return 'mfa_verify'

  return 'ready'
}

function mapSignInError(err) {
  if (!err?.message) return 'Sign in failed'
  if (err.message === 'Invalid login credentials') {
    return 'Incorrect username or password. If this is your first login, run npm run seed:dashboard-users (needs SUPABASE_SERVICE_ROLE_KEY in .env).'
  }
  return err.message
}

export function AuthProvider({ children }) {
  const [step, setStep] = useState('loading')
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [error, setError] = useState(null)

  const syncSession = useCallback(async (sess) => {
    setError(null)
    if (!supabase) {
      setError('Auth is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).')
      setStep('signed_out')
      return
    }

    setSession(sess)
    setUser(sess?.user ?? null)
    setApiAccessToken(sess?.access_token ?? null)

    if (!sess) {
      setStep('signed_out')
      return
    }

    try {
      const next = await resolveAuthStep(sess)
      setStep(next)
    } catch (e) {
      setError(e.message)
      setStep('signed_out')
      setApiAccessToken(null)
    }
  }, [])

  useEffect(() => {
    if (!supabase) {
      setError('Auth is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).')
      setStep('signed_out')
      return
    }

    supabase.auth.getSession().then(({ data: { session: s } }) => syncSession(s))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      syncSession(s)
    })

    return () => subscription.unsubscribe()
  }, [syncSession])

  const signIn = useCallback(async (usernameOrEmail, password) => {
    setError(null)
    if (!supabase) {
      throw new Error('Auth is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).')
    }

    const email = toDashboardEmail(usernameOrEmail)
    if (!isAllowedEmail(email)) {
      throw new Error('This account is not authorized for the dashboard.')
    }

    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) throw new Error(mapSignInError(err))
    await syncSession(data.session)
  }, [syncSession])

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut()
    setApiAccessToken(null)
    setStep('signed_out')
  }, [])

  const completePasswordChange = useCallback(async (newPassword) => {
    const { error: updErr } = await supabase.auth.updateUser({
      password: newPassword,
      data: { password_changed: true },
    })
    if (updErr) throw updErr

    // Clears app_metadata on server when deployed; user_metadata flag works without it.
    try {
      await api.completePasswordSetup()
    } catch {
      /* API route may be missing on Render until auth is deployed */
    }

    await supabase.auth.refreshSession()
    const { data: { session: refreshed } } = await supabase.auth.getSession()
    await syncSession(refreshed)
  }, [syncSession])

  const refreshStep = useCallback(async () => {
    const { data: { session: s } } = await supabase.auth.getSession()
    await syncSession(s)
  }, [syncSession])

  const value = useMemo(() => ({
    step, session, user, error, setError,
    signIn, signOut, completePasswordChange, refreshStep,
    supabase,
  }), [step, session, user, error, signIn, signOut, completePasswordChange, refreshStep])

  let content = children
  if (step === 'loading') {
    content = (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Spinner />
      </div>
    )
  } else if (step !== 'ready') {
    content = <Login />
  }

  return (
    <AuthContext.Provider value={value}>
      {content}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
