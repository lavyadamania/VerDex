import { LogOut, Menu, Moon, Sun } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import useAuth from '../hooks/useAuth'
import useTheme from '../hooks/useTheme'

function TopNavbar({ title, onMenuClick }) {
    const { user, isAuthenticated, logout } = useAuth()
    const { theme, toggleTheme } = useTheme()
    const navigate = useNavigate()

    function handleLogout() {
        logout()
        navigate('/login')
    }

    return (
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 lg:px-8">
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    className="rounded-md border border-slate-300 p-2 text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 lg:hidden"
                    onClick={onMenuClick}
                >
                    <Menu className="h-4 w-4" />
                </button>
                <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Real-Time Court Transparency Platform</p>
                    <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
                </div>
            </div>

            <div className="flex items-center gap-3">
                <button
                    type="button"
                    className="rounded-md border border-slate-300 p-2 text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    onClick={toggleTheme}
                >
                    {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                </button>

                {!isAuthenticated && (
                    <Link
                        to="/login"
                        className="rounded-md bg-brand-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-900"
                    >
                        Sign in
                    </Link>
                )}

                {isAuthenticated && (
                    <>
                        <div className="text-right">
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{user?.full_name || user?.email}</p>
                            <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{user?.role}</p>
                        </div>
                        <button
                            type="button"
                            className="rounded-md border border-slate-300 p-2 text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                            onClick={handleLogout}
                        >
                            <LogOut className="h-4 w-4" />
                        </button>
                    </>
                )}
            </div>
        </header>
    )
}

export default TopNavbar
