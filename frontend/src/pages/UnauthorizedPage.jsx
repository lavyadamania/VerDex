import { Link } from 'react-router-dom'

function UnauthorizedPage() {
    return (
        <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 dark:bg-slate-950">
            <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-8 text-center shadow-panel dark:border-slate-800 dark:bg-slate-900">
                <p className="text-sm font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-100">Access Restricted</p>
                <h1 className="mt-3 text-2xl font-bold">You do not have permission to access this section.</h1>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Please use an account with the required authorization scope.</p>
                <div className="mt-6 flex justify-center gap-3">
                    <Link to="/" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                        Go Home
                    </Link>
                    <Link to="/login" className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-900">
                        Sign In
                    </Link>
                </div>
            </div>
        </div>
    )
}

export default UnauthorizedPage
