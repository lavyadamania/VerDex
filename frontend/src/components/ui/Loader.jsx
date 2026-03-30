function Loader({ label = 'Loading...' }) {
    return (
        <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-500 dark:border-slate-700 dark:border-t-brand-500" />
            {label}
        </div>
    )
}

export default Loader
