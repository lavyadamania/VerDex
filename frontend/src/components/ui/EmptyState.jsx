import { FileX2 } from 'lucide-react'

function EmptyState({ title = 'No records found', message = 'Data will appear here when available.' }) {
    return (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center dark:border-slate-700 dark:bg-slate-900/40">
            <FileX2 className="h-8 w-8 text-slate-400" />
            <h4 className="mt-3 text-base font-semibold text-slate-800 dark:text-slate-200">{title}</h4>
            <p className="mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">{message}</p>
        </div>
    )
}

export default EmptyState
