const toneMap = {
    low: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
    critical: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    info: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
}

function Badge({ tone = 'info', children }) {
    return (
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${toneMap[tone] || toneMap.info}`}>
            {children}
        </span>
    )
}

export default Badge
