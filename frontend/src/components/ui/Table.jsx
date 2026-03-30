import EmptyState from './EmptyState'

function Table({ columns, rows, emptyTitle, emptyMessage }) {
    if (!rows?.length) {
        return <EmptyState title={emptyTitle} message={emptyMessage} />
    }

    return (
        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                    <thead className="bg-slate-50 dark:bg-slate-900">
                        <tr>
                            {columns.map((col) => (
                                <th
                                    key={col.key}
                                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-300"
                                >
                                    {col.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-950">
                        {rows.map((row, idx) => (
                            <tr key={row.id || idx} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                                {columns.map((col) => (
                                    <td key={col.key} className="whitespace-nowrap px-4 py-3 text-sm text-slate-700 dark:text-slate-200">
                                        {col.render ? col.render(row[col.key], row) : row[col.key]}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

export default Table
