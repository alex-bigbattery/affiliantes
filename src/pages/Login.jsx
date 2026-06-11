import { useEffect, useState } from 'react'
import { Mail, Lock, KeyRound, Copy, Check } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import ChangePasswordModal from '../components/ChangePasswordModal'
import { Spinner } from '../components/Layout'
import {
  AuthShell, AuthField, UsernameField, AuthError, OtpInput, AuthSubmit,
} from '../components/AuthShell'

function totpQrSrc(qrCode) {
  if (!qrCode) return ''
  // Supabase returns a ready-to-use data URL; only wrap raw SVG strings.
  if (qrCode.startsWith('data:')) return qrCode
  if (qrCode.trimStart().startsWith('<')) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrCode)}`
  }
  return qrCode
}

function MfaEnroll({ onDone }) {
  const { supabase } = useAuth()
  const [factorId, setFactorId] = useState('')
  const [qr, setQr] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [initLoading, setInitLoading] = useState(true)
  const [resuming, setResuming] = useState(false)
  const [copied, setCopied] = useState(false)

  const startNewEnrollment = async () => {
    setError('')
    setInitLoading(true)
    setResuming(false)
    setQr('')
    setSecret('')
    setFactorId('')
    setCode('')

    const { data: factors } = await supabase.auth.mfa.listFactors()
    for (const f of (factors?.totp || []).filter(x => x.status === 'unverified')) {
      await supabase.auth.mfa.unenroll({ factorId: f.id })
    }

    const { data, error: err } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Authenticator app',
    })
    setInitLoading(false)
    if (err) { setError(err.message); return }
    setFactorId(data.id)
    setQr(totpQrSrc(data.totp.qr_code))
    setSecret(data.totp.secret)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setError('')
      setInitLoading(true)

      const { data: factors, error: fErr } = await supabase.auth.mfa.listFactors()
      if (cancelled) return
      if (fErr) { setError(fErr.message); setInitLoading(false); return }

      const unverified = (factors?.totp || []).filter(f => f.status === 'unverified')
      if (unverified.length) {
        // Prior enrollment not finished — verify instead of creating a duplicate factor.
        setFactorId(unverified[0].id)
        setResuming(true)
        setInitLoading(false)
        return
      }

      const { data, error: err } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Authenticator app',
      })
      if (cancelled) return
      setInitLoading(false)
      if (err) { setError(err.message); return }
      setFactorId(data.id)
      setQr(totpQrSrc(data.totp.qr_code))
      setSecret(data.totp.secret)
    })()
    return () => { cancelled = true }
  }, [supabase])

  const copySecret = async () => {
    if (!secret) return
    await navigator.clipboard.writeText(secret)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const verify = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId })
      if (challenge.error) throw challenge.error
      const verifyRes = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.data.id,
        code: code.trim(),
      })
      if (verifyRes.error) throw verifyRes.error
      await supabase.auth.refreshSession()
      onDone()
    } catch (err) {
      setError(err.message || 'Invalid code')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      wide
      badge="Step 2 of 2"
      title="Set up two-factor authentication"
      subtitle={resuming
        ? 'You already started setup. Enter the 6-digit code from your authenticator app to finish.'
        : 'Scan the QR code with Google Authenticator, Authy, or 1Password. Then enter the 6-digit code to finish.'}
    >
      <div className={`grid gap-6 items-start ${resuming ? '' : 'sm:grid-cols-2'}`}>
        {!resuming && (
          <div className="flex flex-col items-center">
            {initLoading ? (
              <div className="w-52 h-52 rounded-2xl bg-gray-100 animate-pulse" />
            ) : qr ? (
              <div className="p-4 bg-white rounded-2xl border border-gray-200 shadow-sm ring-4 ring-navy-50">
                <img src={qr} alt="Authenticator QR code" className="w-44 h-44" />
              </div>
            ) : (
              <div className="w-52 h-52 rounded-2xl bg-gray-100 flex items-center justify-center text-xs text-gray-400 text-center px-4">
                QR unavailable — use Start over below
              </div>
            )}
            {secret && (
              <div className="mt-3 w-full max-w-[13rem] text-center">
                <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Manual setup key</p>
                <p className="font-mono text-xs text-gray-700 break-all select-all bg-gray-50 rounded-lg px-2 py-1.5 border border-gray-200">
                  {secret}
                </p>
                <button
                  type="button"
                  onClick={copySecret}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-navy-700 transition-colors"
                >
                  {copied ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
                  {copied ? 'Copied' : 'Copy setup key'}
                </button>
              </div>
            )}
          </div>
        )}

        <form onSubmit={verify} className="space-y-4">
          {resuming && (
            <div className="flex justify-center mb-2">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-navy-50 ring-1 ring-navy-100">
                <KeyRound className="text-navy-700" size={26} />
              </div>
            </div>
          )}
          <div>
            <label className="label">Verification code</label>
            <OtpInput value={code} onChange={setCode} disabled={loading || initLoading || !factorId} />
          </div>
          <AuthError>{error}</AuthError>
          <AuthSubmit loading={loading} loadingText="Enabling…" disabled={code.length < 6 || !factorId || initLoading}>
            Enable 2FA &amp; continue
          </AuthSubmit>
          {(resuming || error) && (
            <button
              type="button"
              onClick={startNewEnrollment}
              disabled={initLoading || loading}
              className="w-full text-center text-xs text-gray-500 hover:text-navy-700 disabled:opacity-50"
            >
              Start over with a new QR code
            </button>
          )}
        </form>
      </div>
    </AuthShell>
  )
}

function MfaVerify({ onDone }) {
  const { supabase } = useAuth()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data: factors, error: fErr } = await supabase.auth.mfa.listFactors()
      if (fErr) throw fErr
      const totp = factors.totp.find(f => f.status === 'verified')
      if (!totp) throw new Error('No authenticator enrolled.')

      const challenge = await supabase.auth.mfa.challenge({ factorId: totp.id })
      if (challenge.error) throw challenge.error

      const verifyRes = await supabase.auth.mfa.verify({
        factorId: totp.id,
        challengeId: challenge.data.id,
        code: code.trim(),
      })
      if (verifyRes.error) throw verifyRes.error

      await supabase.auth.refreshSession()
      onDone()
    } catch (err) {
      setError(err.message || 'Invalid code')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      badge="Two-factor authentication"
      title="Enter your code"
      subtitle="Open your authenticator app and enter the 6-digit code for BigBattery."
    >
      <form onSubmit={submit} className="space-y-5">
        <div className="flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-navy-50 ring-1 ring-navy-100">
            <KeyRound className="text-navy-700" size={26} />
          </div>
        </div>
        <div>
          <label className="label text-center block">Authenticator code</label>
          <OtpInput value={code} onChange={setCode} disabled={loading} />
        </div>
        <AuthError>{error}</AuthError>
        <AuthSubmit loading={loading} loadingText="Verifying…" disabled={code.length < 6}>
          Continue to dashboard
        </AuthSubmit>
      </form>
    </AuthShell>
  )
}

export default function Login() {
  const { step, signIn, completePasswordChange, refreshStep, error, setError } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  if (step === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-navy-900">
        <Spinner />
      </div>
    )
  }

  if (step === 'password_change') {
    return <ChangePasswordModal onComplete={completePasswordChange} />
  }

  if (step === 'mfa_enroll') {
    return <MfaEnroll onDone={refreshStep} />
  }

  if (step === 'mfa_verify') {
    return <MfaVerify onDone={refreshStep} />
  }

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await signIn(username, password)
    } catch (err) {
      setError(err.message || 'Sign in failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Enter your username and password — @bigbattery.com is added automatically."
    >
      <form onSubmit={submit} className="space-y-4">
        <UsernameField
          label="Username"
          icon={Mail}
          value={username}
          onChange={e => {
            let v = e.target.value.trim().toLowerCase()
            if (v.includes('@')) v = v.split('@')[0]
            setUsername(v)
          }}
          placeholder="alex.g"
          required
        />
        <AuthField
          label="Password"
          icon={Lock}
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="current-password"
          placeholder="••••••••"
          required
        />
        <AuthError>{error}</AuthError>
        <AuthSubmit loading={loading} loadingText="Signing in…">
          Sign in
        </AuthSubmit>
      </form>
      <p className="mt-6 text-center text-xs text-gray-400">
        Authorized BigBattery accounts only
      </p>
    </AuthShell>
  )
}
