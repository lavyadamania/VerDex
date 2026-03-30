import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, FileText } from 'lucide-react'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Loader from '../components/ui/Loader'
import EmptyState from '../components/ui/EmptyState'
import Skeleton from '../components/ui/Skeleton'
import Timeline from '../components/ui/Timeline'
import caseService from '../services/caseService'
import { formatDate, toSentence } from '../utils/formatters'
import { riskLevelFromScore } from '../utils/risk'

function VictimDashboardPage() {
    const [cases, setCases] = useState([])
    const [selectedCase, setSelectedCase] = useState(null)
    const [timeline, setTimeline] = useState([])
    const [documents, setDocuments] = useState([])
    const [loading, setLoading] = useState(true)
    const [detailLoading, setDetailLoading] = useState(false)
    const [error, setError] = useState('')

    useEffect(() => {
        let mounted = true

        async function loadCases() {
            try {
                setLoading(true)
                const response = await caseService.listCases({ page: 1, limit: 20 })
                const loadedCases = response?.cases || []
                if (!mounted) return
                setCases(loadedCases)
                setSelectedCase(loadedCases[0] || null)
            } catch (err) {
                if (mounted) setError(err?.response?.data?.error || 'Unable to load case data.')
            } finally {
                if (mounted) setLoading(false)
            }
        }

        loadCases()
        return () => {
            mounted = false
        }
    }, [])

    useEffect(() => {
        let mounted = true

        async function loadCaseDetails() {
            if (!selectedCase?._id) return
            try {
                setDetailLoading(true)
                const [eventsRes, docsRes] = await Promise.all([
                    caseService.getCaseEvents(selectedCase._id),
                    caseService.getCaseDocuments(selectedCase._id),
                ])

                if (!mounted) return
                setTimeline(eventsRes?.events || [])
                setDocuments(docsRes?.documents || [])
            } catch {
                if (mounted) {
                    setTimeline([])
                    setDocuments([])
                }
            } finally {
                if (mounted) setDetailLoading(false)
            }
        }

        loadCaseDetails()
        return () => {
            mounted = false
        }
    }, [selectedCase?._id])

    const derivedAlerts = useMemo(() => {
        if (!selectedCase) return []
        const alerts = []
        if (selectedCase.next_hearing_date) {
            alerts.push({
                id: 'hearing',
                title: 'Next hearing scheduled',
                text: `Upcoming hearing on ${formatDate(selectedCase.next_hearing_date)}.`,
                tone: 'info',
            })
        }
        if (Number(selectedCase.delay_risk_score || 0) >= 6) {
            alerts.push({
                id: 'risk',
                title: 'Delay risk elevated',
                text: `Current delay risk score is ${selectedCase.delay_risk_score}/10.`,
                tone: riskLevelFromScore(selectedCase.delay_risk_score),
            })
        }
        return alerts
    }, [selectedCase])

    if (loading) {
        return (
            <div className="grid gap-4 lg:grid-cols-3">
                <Skeleton className="h-40" />
                <Skeleton className="h-40" />
                <Skeleton className="h-40" />
            </div>
        )
    }

    if (error) {
        return <EmptyState title="Dashboard unavailable" message={error} />
    }

    if (!cases.length) {
        return (
            <EmptyState
                title="No cases assigned"
                message="Your case dashboard will display timeline, hearing schedules, and document updates once records are available."
            />
        )
    }

    return (
        <div className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-3">
                <Card title="Case Overview" subtitle="Active monitored case">
                    <p className="text-sm text-slate-500 dark:text-slate-400">{selectedCase?.cnr_number || selectedCase?.masked_id}</p>
                    <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">{selectedCase?.case_title || 'Untitled case'}</p>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{toSentence(selectedCase?.current_status || 'filed')}</p>
                </Card>

                <Card title="Next Hearing" subtitle="Court schedule status">
                    <div className="flex items-center gap-3">
                        <CalendarClock className="h-5 w-5 text-brand-700 dark:text-brand-100" />
                        <p className="text-lg font-semibold">{formatDate(selectedCase?.next_hearing_date)}</p>
                    </div>
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Stay prepared with required documents before your listed date.</p>
                </Card>

                <Card title="Delay Risk" subtitle="AI-assisted risk score">
                    <div className="flex items-center gap-2">
                        <Badge tone={riskLevelFromScore(selectedCase?.delay_risk_score)}>{riskLevelFromScore(selectedCase?.delay_risk_score)}</Badge>
                        <p className="text-sm text-slate-600 dark:text-slate-300">Score {selectedCase?.delay_risk_score || 0}/10</p>
                    </div>
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Risk is recalculated based on adjournments and case inactivity patterns.</p>
                </Card>
            </div>

            <div className="grid gap-6 xl:grid-cols-3">
                <Card title="Case Timeline" subtitle="Chronological event history" className="xl:col-span-2">
                    {detailLoading ? <Loader label="Loading timeline..." /> : <Timeline items={timeline} />}
                </Card>

                <Card title="Your Cases" subtitle="Select active record">
                    <div className="space-y-2">
                        {cases.map((caseItem) => (
                            <button
                                key={caseItem._id}
                                type="button"
                                onClick={() => setSelectedCase(caseItem)}
                                className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${selectedCase?._id === caseItem._id
                                        ? 'border-brand-700 bg-brand-50 text-brand-900 dark:border-brand-100 dark:bg-slate-800 dark:text-slate-100'
                                        : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800'
                                    }`}
                            >
                                <p className="font-semibold">{caseItem.case_title || caseItem.cnr_number}</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400">{toSentence(caseItem.current_status)}</p>
                            </button>
                        ))}
                    </div>
                </Card>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
                <Card title="Documents" subtitle="Uploaded case documents">
                    {!documents.length ? (
                        <EmptyState title="No documents" message="Uploaded documents for this case will appear here." />
                    ) : (
                        <ul className="space-y-2">
                            {documents.map((doc) => (
                                <li key={doc._id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
                                    <div className="flex items-center gap-2">
                                        <FileText className="h-4 w-4 text-slate-500" />
                                        <div>
                                            <p className="text-sm font-medium">{doc.file_name}</p>
                                            <p className="text-xs text-slate-500 dark:text-slate-400">{toSentence(doc.doc_type)}</p>
                                        </div>
                                    </div>
                                    <Badge tone="info">{doc.verified_status}</Badge>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>

                <Card title="Alerts" subtitle="Actionable notices">
                    {!derivedAlerts.length ? (
                        <EmptyState title="No active alerts" message="Critical updates will appear here when risk or schedule changes occur." />
                    ) : (
                        <ul className="space-y-3">
                            {derivedAlerts.map((alert) => (
                                <li key={alert.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                                    <div className="flex items-center gap-2">
                                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                                        <p className="text-sm font-semibold">{alert.title}</p>
                                    </div>
                                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{alert.text}</p>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
            </div>
        </div>
    )
}

export default VictimDashboardPage
