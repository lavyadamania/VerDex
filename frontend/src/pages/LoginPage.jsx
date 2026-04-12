import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import useAuth from '../hooks/useAuth'

function LoginPage() {
    const [form, setForm] = useState({ email: '', password: '' })
    const [error, setError] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const { login } = useAuth()
    const navigate = useNavigate()
    const location = useLocation()

    async function handleSubmit(event) {
        event.preventDefault()
        setError('')
        setSubmitting(true)

        try {
            const user = await login(form)
            const from = location.state?.from
            if (from) {
                navigate(from)
                return
            }
            if (['admin', 'court_staff'].includes(user?.role)) navigate('/dashboard/admin')
            else if (user?.role === 'advocate') navigate('/dashboard/advocate')
            else if (user?.role === 'visitor') navigate('/dashboard/public')
            else navigate('/dashboard/victim')
        } catch (err) {
            setError(err?.response?.data?.error || 'Login failed. Please check your credentials.')
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 dark:bg-slate-950">
            <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-panel dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-brand-700 dark:text-brand-100">Secure Access</p>
                <h1 className="mt-2 text-2xl font-bold">Sign in to your account</h1>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Use your registered credentials to continue.</p>

                <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
                    <div>
                        <label className="mb-1 block text-sm font-medium">Email</label>
                        <input
                            type="email"
                            required
                            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-700 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                            value={form.email}
                            onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-sm font-medium">Password</label>
                        <input
                            type="password"
                            required
                            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-700 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                            value={form.password}
                            onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                        />
                    </div>

                    {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>}

                    <button
                        type="submit"
                        disabled={submitting}
                        className="w-full rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-900 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {submitting ? 'Signing in...' : 'Sign in'}
                    </button>
                </form>

                <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
                    New user?{' '}
                    <Link to="/register" className="font-semibold text-brand-700 dark:text-brand-100">
                        Create account
                    </Link>
                </p>
            </div>
        </div>
    )
}

export default LoginPage
