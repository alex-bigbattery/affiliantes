import { useState } from 'react'
import { Mail, Lock } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import ChangePasswordModal from '../components/ChangePasswordModal'
import { Spinner } from '../components/Layout'
import {
  getRememberMe,
  getRememberedUsername,
} from '../lib/authPreferences.js'
import {
  AuthShell, AuthField, UsernameField, AuthError, AuthSubmit,
} from '../components/AuthShell'

export default function Login() {
  const { step, signIn, completePasswordChange, error, setError } = useAuth()
  const [username, setUsername] = useState(() => getRememberedUsername())
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMeChecked] = useState(() => getRememberMe())
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

  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await signIn(username, password, rememberMe)
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
          autoComplete={rememberMe ? 'current-password' : 'password'}
          placeholder="••••••••"
          required
        />
        <label className="flex items-start gap-2.5 cursor-pointer select-none text-sm text-gray-600">
          <input
            type="checkbox"
            className="mt-0.5 rounded border-gray-300 text-navy-700 focus:ring-navy-700/30"
            checked={rememberMe}
            onChange={e => setRememberMeChecked(e.target.checked)}
          />
          <span>
            Remember me
            <span className="text-gray-400"> — keep me signed in on this device</span>
          </span>
        </label>
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
