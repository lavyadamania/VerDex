function Card({ title, subtitle, action, children, className = '' }) {
    return (
        <section className={`rounded-xl border border-slate-200 bg-white p-6 shadow-panel dark:border-slate-800 dark:bg-slate-900 ${className}`}>
            {(title || subtitle || action) && (
                <header className="mb-4 flex items-start justify-between gap-3">
                    <div>
                        {title && <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h3>}
                        {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
                    </div>
                    {action}
                </header>
            )}
            {children}
        </section>
    )
}

export default Card
