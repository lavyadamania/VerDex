import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import useAuth from '../hooks/useAuth'

function RegisterPage() {
    const [form, setForm] = useState({
        full_name: '',
        email: '',
        phone: '',
        password: '',
        role: 'user',
    })
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const { register } = useAuth()
    const navigate = useNavigate()

    async function handleSubmit(event) {
        event.preventDefault()
        setError('')
        setSuccess('')
        setSubmitting(true)

        try {
            await register(form)
            setSuccess('Registration successful. Please sign in to continue.')
            setTimeout(() => navigate('/login'), 1000)
        } catch (err) {
            setError(err?.response?.data?.error || 'Registration failed. Please verify your input.')
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 dark:bg-slate-950">
            <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-8 shadow-panel dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-brand-700 dark:text-brand-100">Enrollment</p>
                <h1 className="mt-2 text-2xl font-bold">Create secure account</h1>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Register to access case tracking and timeline records.</p>

                <form className="mt-6 grid gap-4" onSubmit={handleSubmit}>
                    <div>
                        <label className="mb-1 block text-sm font-medium">Full Name</label>
                        <input
                            type="text"
                            required
                            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-700 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                            value={form.full_name}
                            onChange={(e) => setForm((prev) => ({ ...prev, full_name: e.target.value }))}
                        />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
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
                            <label className="mb-1 block text-sm font-medium">Phone</label>
                            <input
                                type="text"
                                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-700 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                                value={form.phone}
                                onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                            />
                        </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                            <label className="mb-1 block text-sm font-medium">Password</label>
                            <input
                                type="password"
                                required
                                minLength={6}
                                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-700 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                                value={form.password}
                                onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-sm font-medium">Role</label>
                            <select
                                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-700 focus:outline-none dark:border-slate-700 dark:bg-slate-950"
                                value={form.role}
                                onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value }))}
                            >
                                <option value="user">User</option>
                                <option value="advocate">Advocate</option>
                                <option value="court_staff">Court Staff</option>
                                <option value="admin">Admin</option>
                                <option value="visitor">Visitor</option>
                            </select>
                        </div>
                    </div>

                    {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{error}</p>}
                    {success && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{success}</p>}

                    <button
                        type="submit"
                        disabled={submitting}
                        className="rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-900 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {submitting ? 'Creating account...' : 'Create account'}
                    </button>
                </form>

                <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
                    Already registered?{' '}
                    <Link to="/login" className="font-semibold text-brand-700 dark:text-brand-100">
                        Sign in
                    </Link>
                </p>
            </div>
        </div>
    )
}

export default RegisterPage
