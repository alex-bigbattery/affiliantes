import { useState } from 'react'
import { Lock, KeyRound } from 'lucide-react'
import { AuthShell, AuthField, AuthError, AuthSubmit } from './AuthShell'

export default function ChangePasswordModal({ onComplete }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      await onComplete(password)
    } catch (err) {
      setError(err.message || 'Could not update password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      badge="First-time setup"
      title="Create your password"
      subtitle="Choose a personal password before continuing. You will only be asked once."
    >
      <div className="flex justify-center mb-2">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-orange/10 ring-1 ring-brand-orange/20">
          <KeyRound className="text-brand-orange" size={26} />
        </div>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <AuthField
          label="New password"
          icon={Lock}
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="new-password"
          placeholder="At least 8 characters"
          required
          minLength={8}
        />
        <AuthField
          label="Repeat password"
          icon={Lock}
          type="password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          autoComplete="new-password"
          placeholder="Same as above"
          required
          minLength={8}
        />
        <AuthError>{error}</AuthError>
        <AuthSubmit loading={loading} loadingText="Saving…">
          Save &amp; continue
        </AuthSubmit>
      </form>
    </AuthShell>
  )
}
