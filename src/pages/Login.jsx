import { useState } from 'react'
import { Mail, Lock } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import ChangePasswordModal from '../components/ChangePasswordModal'
import { Spinner } from '../components/Layout'
import {
  AuthShell, AuthField, UsernameField, AuthError, AuthSubmit,
} from '../components/AuthShell'

export default function Login() {
  const { step, signIn, completePasswordChange, error, setError } = useAuth()
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
