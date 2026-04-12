import { Link, useLocation } from 'react-router-dom'
import { Activity, Building2, FileText, Globe2, LayoutDashboard, ShieldCheck } from 'lucide-react'
import useAuth from '../hooks/useAuth'
import LiveMonitoringCard from '../components/live/LiveMonitoringCard'

const navByRole = {
    victim: [
        { label: 'Victim Dashboard', to: '/dashboard/victim', icon: LayoutDashboard },
        { label: 'Public Dashboard', to: '/dashboard/public', icon: Globe2 },
    ],
    advocate: [
        { label: 'Advocate Dashboard', to: '/dashboard/advocate', icon: LayoutDashboard },
        { label: 'Public Dashboard', to: '/dashboard/public', icon: Globe2 },
    ],
    admin: [
        { label: 'Admin Dashboard', to: '/dashboard/admin', icon: ShieldCheck },
        { label: 'Public Dashboard', to: '/dashboard/public', icon: Globe2 },
    ],
    court_staff: [
        { label: 'Admin Dashboard', to: '/dashboard/admin', icon: ShieldCheck },
        { label: 'Public Dashboard', to: '/dashboard/public', icon: Globe2 },
    ],
    public: [{ label: 'Public Dashboard', to: '/dashboard/public', icon: Globe2 }],
}

function Sidebar({ open, onClose }) {
    const { user } = useAuth()
    const location = useLocation()
    const role = user?.role || 'public'
    const items = navByRole[role] || navByRole.public

    return (
        <>
            <aside
                className={`fixed inset-y-0 left-0 z-40 w-72 border-r border-slate-200 bg-white px-6 py-6 shadow-panel transition-transform duration-200 dark:border-slate-800 dark:bg-slate-950 lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'
                    }`}
            >
                <div className="mb-8 border-b border-slate-200 pb-5 dark:border-slate-800">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-700 dark:text-brand-100">Court Intelligence</p>
                    <h1 className="mt-2 text-base font-bold text-slate-900 dark:text-slate-100">Justice Accountability Platform</h1>
                </div>

                <nav className="space-y-2">
                    {items.map((item) => {
                        const Icon = item.icon
                        const active = location.pathname === item.to
                        return (
                            <Link
                                key={item.to}
                                to={item.to}
                                onClick={onClose}
                                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${active
                                    ? 'bg-brand-50 text-brand-900 dark:bg-slate-800 dark:text-slate-100'
                                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-slate-100'
                                    }`}
                            >
                                <Icon className="h-4 w-4" />
                                {item.label}
                            </Link>
                        )
                    })}
                </nav>

                <div className="mt-8 space-y-3">
                    <LiveMonitoringCard />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-500 dark:text-slate-400">
                    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                        <Building2 className="mb-1 h-4 w-4" />
                        Court Metrics
                    </div>
                    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                        <FileText className="mb-1 h-4 w-4" />
                        Case Records
                    </div>
                </div>
            </aside>
            {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={onClose} />}
        </>
    )
}

export default Sidebar
