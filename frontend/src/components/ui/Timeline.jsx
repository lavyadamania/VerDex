import Badge from './Badge'

function Timeline({ items = [] }) {
    if (!items.length) {
        return <p className="text-sm text-slate-500 dark:text-slate-400">No timeline events available.</p>
    }

    return (
        <ol className="relative border-s border-slate-200 ps-6 dark:border-slate-700">
            {items.map((event) => (
                <li key={event.id || `${event.event_type}-${event.event_date}`} className="mb-8 ms-2">
                    <span className="absolute -start-[9px] mt-1.5 h-4 w-4 rounded-full border-2 border-white bg-brand-500 dark:border-slate-950" />
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{event.event_type?.replaceAll('_', ' ')}</p>
                        {event.is_public && <Badge tone="info">Public</Badge>}
                    </div>
                    <time className="text-xs text-slate-500 dark:text-slate-400">{new Date(event.event_date).toLocaleDateString()}</time>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{event.event_description || 'No description provided.'}</p>
                </li>
            ))}
        </ol>
    )
}

export default Timeline
