import { ArrowRight, Building2, ClockAlert, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'

function LandingPage() {
    return (
        <div className="min-h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
            <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 lg:px-8">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-700 dark:text-brand-100">Justice Analytics</p>
                    <h1 className="mt-1 text-lg font-bold">Real-Time Court Transparency Platform</h1>
                </div>
                <div className="flex items-center gap-3">
                    <Link to="/login" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-white dark:border-slate-700 dark:hover:bg-slate-900">
                        Sign In
                    </Link>
                    <Link to="/dashboard/public" className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-900">
                        Public Dashboard
                    </Link>
                </div>
            </header>

            <main className="mx-auto max-w-7xl px-6 pb-16 pt-10 lg:px-8 lg:pt-14">
                <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-panel dark:border-slate-800 dark:bg-slate-900 lg:p-12">
                    <p className="text-sm font-semibold uppercase tracking-[0.15em] text-brand-700 dark:text-brand-100">Court Transparency and Accountability</p>
                    <h2 className="mt-4 max-w-4xl text-3xl font-bold leading-tight lg:text-5xl">
                        Trusted, data-driven visibility into case progress, delay risks, and court performance.
                    </h2>
                    <p className="mt-5 max-w-3xl text-base text-slate-600 dark:text-slate-300">
                        A professional platform for victims, the public, and court administrators to monitor justice delivery through verified records and real-time operational metrics.
                    </p>
                    <div className="mt-8 flex flex-wrap items-center gap-3">
                        <Link to="/register" className="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-900">
                            Track Your Case
                            <ArrowRight className="h-4 w-4" />
                        </Link>
                        <Link to="/dashboard/public" className="rounded-lg border border-slate-300 px-5 py-3 text-sm font-semibold hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                            Explore Public Transparency View
                        </Link>
                    </div>
                </section>

                <section className="mt-8 grid gap-4 md:grid-cols-3">
                    <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-panel dark:border-slate-800 dark:bg-slate-900">
                        <ShieldCheck className="h-5 w-5 text-brand-700 dark:text-brand-100" />
                        <h3 className="mt-3 text-lg font-semibold">Victim-Centered Privacy</h3>
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Role-based access and controlled disclosure ensure sensitive data remains protected.</p>
                    </article>
                    <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-panel dark:border-slate-800 dark:bg-slate-900">
                        <ClockAlert className="h-5 w-5 text-brand-700 dark:text-brand-100" />
                        <h3 className="mt-3 text-lg font-semibold">Delay Intelligence</h3>
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Automated risk scoring highlights stalled cases and helps prioritize timely intervention.</p>
                    </article>
                    <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-panel dark:border-slate-800 dark:bg-slate-900">
                        <Building2 className="h-5 w-5 text-brand-700 dark:text-brand-100" />
                        <h3 className="mt-3 text-lg font-semibold">Institutional Accountability</h3>
                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Court-level metrics and trend dashboards support governance and policy review.</p>
                    </article>
                </section>
            </main>
        </div>
    )
}

export default LandingPage
