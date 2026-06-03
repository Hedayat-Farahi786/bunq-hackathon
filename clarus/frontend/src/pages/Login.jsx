import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Aperture } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'

export default function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to="/" replace />

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      await login(email, password)
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.detail || 'Invalid email or password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your Clarus workspace">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email" type="email" value={email} onChange={setEmail} />
        <Field label="Password" type="password" value={password} onChange={setPassword} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={busy}
          className="btn w-full rounded-xl bg-[var(--color-ink)] py-2.5 font-medium text-white hover:bg-black disabled:opacity-50">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-[var(--color-ink-soft)]">
        No account? <Link to="/register" className="font-medium text-[var(--color-accent)] hover:underline">Create one</Link>
      </p>
    </AuthShell>
  )
}

export function AuthShell({ title, subtitle, children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-canvas)] px-4">
      <div className="w-full max-w-md animate-fade-up">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Aperture className="h-7 w-7 text-[var(--color-accent)]" strokeWidth={2.2} /> Clarus
          </div>
          <h1 className="mt-7 text-2xl font-semibold">{title}</h1>
          <p className="mt-1 text-[var(--color-ink-soft)]">{subtitle}</p>
        </div>
        <div className="card p-8">{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, type = 'text', value, onChange }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-[var(--color-ink-soft)]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        className="mt-1.5 w-full rounded-xl border border-[var(--color-line)] bg-white px-3 py-2.5 outline-none transition focus:border-[var(--color-accent)] focus:ring-4 focus:ring-[var(--color-accent-soft)]"
      />
    </label>
  )
}
