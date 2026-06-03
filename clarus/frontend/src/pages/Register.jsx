import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { AuthShell, Field } from './Login.jsx'

export default function Register() {
  const { user, register } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ full_name: '', email: '', password: '', organization_name: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to="/" replace />

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      await register(form)
      navigate('/integrations')
    } catch (err) {
      const data = err.response?.data
      setError(data?.email?.[0] || data?.password?.[0] || data?.detail || 'Could not create account.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Create your workspace" subtitle="Start mapping your organization">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Full name" value={form.full_name} onChange={set('full_name')} />
        <Field label="Work email" type="email" value={form.email} onChange={set('email')} />
        <Field label="Password" type="password" value={form.password} onChange={set('password')} />
        <Field label="Organization name" value={form.organization_name} onChange={set('organization_name')} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={busy}
          className="btn w-full rounded-xl bg-[var(--color-ink)] py-2.5 font-medium text-white hover:bg-black disabled:opacity-50">
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-[var(--color-ink-soft)]">
        Already have an account? <Link to="/login" className="font-medium text-[var(--color-accent)] hover:underline">Sign in</Link>
      </p>
    </AuthShell>
  )
}
