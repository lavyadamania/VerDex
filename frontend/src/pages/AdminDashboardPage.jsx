import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, Trophy } from 'lucide-react'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Loader from '../components/ui/Loader'
import Table from '../components/ui/Table'
import EmptyState from '../components/ui/EmptyState'
import StatusBarChart from '../components/charts/StatusBarChart'
import caseService from '../services/caseService'
import courtService from '../services/courtService'
import adminService from '../services/adminService'
import alertService from '../services/alertService'
import disclosureService from '../services/disclosureService'
import verificationService from '../services/verificationService'
import aiService from '../services/aiService'
import errorService from '../services/errorService'
import delayService from '../services/delayService'
import leaderboardService from '../services/leaderboardService'
import sseService from '../services/sseService'
import documentService from '../services/documentService'
import eventService from '../services/eventService'
import useAuth from '../hooks/useAuth'
import { formatNumber } from '../utils/formatters'
import { riskLevelFromScore } from '../utils/risk'

function AdminDashboardPage() {
    const { user } = useAuth()
    const [summary, setSummary] = useState(null)
    const [leaderboard, setLeaderboard] = useState([])
    const [delayedCases, setDelayedCases] = useState([])
    const [adminStats, setAdminStats] = useState(null)
    const [courtAnalytics, setCourtAnalytics] = useState([])
    const [adminAlerts, setAdminAlerts] = useState([])
    const [pendingDisclosures, setPendingDisclosures] = useState([])
    const [verificationUsers, setVerificationUsers] = useState(null)
    const [errorSummary, setErrorSummary] = useState(null)
    const [errorCases, setErrorCases] = useState([])
    const [aiStatus, setAiStatus] = useState(null)
    const [aiQueue, setAiQueue] = useState(null)
    const [delayRedisSets, setDelayRedisSets] = useState(null)
    const [delayHistory, setDelayHistory] = useState(null)
    const [leaderboardStats, setLeaderboardStats] = useState(null)
    const [selectedCourtAnalytics, setSelectedCourtAnalytics] = useState(null)
    const [sseStatus, setSseStatus] = useState(null)
    const [adminCases, setAdminCases] = useState([])
    const [stuckCases, setStuckCases] = useState([])
    const [auditLogs, setAuditLogs] = useState([])
    const [adminUsers, setAdminUsers] = useState([])
    const [caseStats, setCaseStats] = useState(null)
    const [selectedCaseDetail, setSelectedCaseDetail] = useState(null)
    const [selectedCaseTimelineAudit, setSelectedCaseTimelineAudit] = useState(null)
    const [eventStats, setEventStats] = useState(null)
    const [selectedCaseEvents, setSelectedCaseEvents] = useState([])
    const [documentActionId, setDocumentActionId] = useState('')
    const [adminOverrideUserId, setAdminOverrideUserId] = useState('')
    const [adminOverrideStatus, setAdminOverrideStatus] = useState('otp_verified')
    const [actionMessage, setActionMessage] = useState('')
    const [aiDocumentId, setAiDocumentId] = useState('')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    useEffect(() => {
        let mounted = true

        async function loadAdminData() {
            try {
                setLoading(true)
                const [summaryRes, leaderboardRes, delayedRes] = await Promise.all([
                    caseService.getDelaySummary(),
                    courtService.getLeaderboard(),
                    caseService.getDelayedCases({ level: 'all', page: 1, limit: 8 }),
                ])

                const fullAdminData = user?.role === 'admin'
                    ? await Promise.all([
                        adminService.getStats(),
                        adminService.getCourtAnalytics(),
                        alertService.listAll({ page: 1, limit: 8 }),
                        disclosureService.listPending({ page: 1, limit: 8 }),
                        verificationService.listUsers({ page: 1, limit: 20 }),
                        errorService.getSummary(),
                        errorService.listCases({ page: 1, limit: 5 }),
                        aiService.getStatus(),
                        aiService.getQueue(),
                        delayService.getRedisSets(),
                        leaderboardService.getStats(),
                        sseService.getStatus(),
                        adminService.listCases({ page: 1, limit: 5 }),
                        adminService.getStuckCases({ page: 1, limit: 5 }),
                        adminService.getAuditLogs({ page: 1, limit: 5 }),
                        adminService.listUsers({ page: 1, limit: 5 }),
                        caseService.getCaseStats(),
                        eventService.getEventStats(),
                    ])
                    : null

                if (!mounted) return
                setSummary(summaryRes)
                setLeaderboard(leaderboardRes?.leaderboard || [])
                setDelayedCases(delayedRes?.cases || [])

                if (fullAdminData) {
                    const [statsRes, courtRes, alertsRes, pendingDisclosureRes, verificationUsersRes, errorSummaryRes, errorCasesRes, aiStatusRes, aiQueueRes, delayRedisRes, leaderboardStatsRes, sseStatusRes, adminCasesRes, stuckCasesRes, auditLogsRes, adminUsersRes, caseStatsRes, eventStatsRes] = fullAdminData
                    setAdminStats(statsRes)
                    setCourtAnalytics(courtRes?.courts || [])
                    setAdminAlerts(alertsRes?.alerts || [])
                    setPendingDisclosures(pendingDisclosureRes?.requests || [])
                    setVerificationUsers(verificationUsersRes?.summary || null)
                    setErrorSummary(errorSummaryRes || null)
                    setErrorCases(errorCasesRes?.cases_with_errors || [])
                    setAiStatus(aiStatusRes || null)
                    setAiQueue(aiQueueRes || null)
                    setDelayRedisSets(delayRedisRes || null)
                    setLeaderboardStats(leaderboardStatsRes || null)
                    setSseStatus(sseStatusRes || null)
                    setAdminCases(adminCasesRes?.cases || [])
                    setStuckCases(stuckCasesRes?.cases || [])
                    setAuditLogs(auditLogsRes?.logs || [])
                    setAdminUsers(adminUsersRes?.users || [])
                    setCaseStats(caseStatsRes || null)
                    setEventStats(eventStatsRes || null)
                }
            } catch (err) {
                if (mounted) setError(err?.response?.data?.error || 'Unable to load admin analytics.')
            } finally {
                if (mounted) setLoading(false)
            }
        }

        loadAdminData()
        return () => {
            mounted = false
        }
    }, [])

    const chartData = useMemo(() => {
        if (!summary) return []
        return [
            { name: 'Warning', value: summary?.delay_counts?.warning || 0 },
            { name: 'High', value: summary?.delay_counts?.high_risk || 0 },
            { name: 'Critical', value: summary?.delay_counts?.critical || 0 },
        ]
    }, [summary])

    async function refreshDiagnostics() {
        if (user?.role !== 'admin') return
        try {
            const [errorSummaryRes, errorCasesRes, aiStatusRes, aiQueueRes, delayRedisRes, leaderboardStatsRes, sseStatusRes, caseStatsRes, eventStatsRes] = await Promise.all([
                errorService.getSummary(),
                errorService.listCases({ page: 1, limit: 5 }),
                aiService.getStatus(),
                aiService.getQueue(),
                delayService.getRedisSets(),
                leaderboardService.getStats(),
                sseService.getStatus(),
                caseService.getCaseStats(),
                eventService.getEventStats(),
            ])
            setErrorSummary(errorSummaryRes || null)
            setErrorCases(errorCasesRes?.cases_with_errors || [])
            setAiStatus(aiStatusRes || null)
            setAiQueue(aiQueueRes || null)
            setDelayRedisSets(delayRedisRes || null)
            setLeaderboardStats(leaderboardStatsRes || null)
            setSseStatus(sseStatusRes || null)
            setCaseStats(caseStatsRes || null)
            setEventStats(eventStatsRes || null)
        } catch {
            setActionMessage('Unable to refresh diagnostics right now.')
        }
    }

    async function loadCaseDetailAndAudit(caseId) {
        try {
            const [detailRes, auditRes, eventsRes] = await Promise.all([
                caseService.getCaseById(caseId),
                caseService.getTimelineAudit(caseId),
                eventService.getCaseEvents(caseId),
            ])
            setSelectedCaseDetail(detailRes?.case || detailRes || null)
            setSelectedCaseTimelineAudit(auditRes || null)
            setSelectedCaseEvents(eventsRes?.events || [])
        } catch {
            setSelectedCaseDetail(null)
            setSelectedCaseTimelineAudit(null)
            setSelectedCaseEvents([])
        }
    }

    async function runAiAction(action) {
        if (!aiDocumentId) {
            setActionMessage('Enter a document ID first.')
            return
        }
        try {
            if (action === 'analyze') await aiService.analyzeDocument(aiDocumentId)
            if (action === 'analyze-sync') await aiService.analyzeDocumentSync(aiDocumentId)
            if (action === 'extract') await aiService.extractText(aiDocumentId)
            if (action === 'summarize') await aiService.summarize(aiDocumentId)
            if (action === 'classify') await aiService.classify(aiDocumentId)
            setActionMessage(`AI ${action} completed for document ${aiDocumentId}.`)
            await refreshDiagnostics()
        } catch (err) {
            setActionMessage(err?.response?.data?.error || `AI ${action} failed.`)
        }
    }

    async function runDelayScan() {
        try {
            const result = await delayService.scanAll()
            setActionMessage(`Delay scan complete: ${result?.scan_results?.totalScanned || 0} scanned.`)
            await refreshDiagnostics()
        } catch (err) {
            setActionMessage(err?.response?.data?.error || 'Delay scan failed.')
        }
    }

    async function loadDelayHistory(caseId) {
        try {
            const result = await delayService.getHistory(caseId)
            setDelayHistory(result || null)
        } catch {
            setDelayHistory(null)
        }
    }

    async function refreshLeaderboard() {
        try {
            const refreshed = await leaderboardService.refresh()
            setActionMessage(`Leaderboard refreshed for ${refreshed?.courts_ranked || 0} courts.`)
            await refreshDiagnostics()
        } catch (err) {
            setActionMessage(err?.response?.data?.error || 'Leaderboard refresh failed.')
        }
    }

    async function loadCourtLeaderboardAnalytics(courtId) {
        try {
            const result = await leaderboardService.getCourtDetail(courtId)
            setSelectedCourtAnalytics(result || null)
        } catch {
            setSelectedCourtAnalytics(null)
        }
    }

    async function runGlobalErrorScan() {
        try {
            const result = await errorService.scanAll(true)
            setActionMessage(`Global scan complete: ${result?.totalErrors || 0} errors found.`)
            await refreshDiagnostics()
        } catch (err) {
            setActionMessage(err?.response?.data?.error || 'Global error scan failed.')
        }
    }

    async function runCaseScan(caseId) {
        try {
            const result = await errorService.scanCase(caseId, true)
            setActionMessage(`Case scan complete: ${result?.errors?.length || 0} errors found.`)
            await refreshDiagnostics()
        } catch (err) {
            setActionMessage(err?.response?.data?.error || 'Case error scan failed.')
        }
    }

    async function setCaseStatus(caseId, status) {
        try {
            await caseService.updateCaseStatus(caseId, { status })
            const delayedRes = await caseService.getDelayedCases({ level: 'all', page: 1, limit: 8 })
            setDelayedCases(delayedRes?.cases || [])
            setActionMessage(`Case moved to ${status}.`)
        } catch (err) {
            setActionMessage(err?.response?.data?.error || 'Unable to update case status.')
        }
    }

    async function quickUpdateCaseTitle(caseId) {
        try {
            await caseService.updateCase(caseId, { case_title: `Updated at ${new Date().toLocaleTimeString()}` })
            setActionMessage('Case title updated.')
        } catch (err) {
            setActionMessage(err?.response?.data?.error || 'Unable to update case.')
        }
    }

    async function quickDeleteCase(caseId) {
        try {
            await caseService.deleteCase(caseId)
            setActionMessage('Case soft-deleted successfully.')
            const delayedRes = await caseService.getDelayedCases({ level: 'all', page: 1, limit: 8 })
            setDelayedCases(delayedRes?.cases || [])
        } catch (err) {
            setActionMessage(err?.response?.data?.error || 'Unable to delete case.')
        }
    }

    async function verifyDocument() {
        try {
            await documentService.verify(documentActionId, { status: 'verified', notes: 'Verified from admin dashboard' })
            setActionMessage('Document verified.')
        } catch (err) {
            setActionMessage(err?.response?.data?.error || 'Document verify failed.')
        }
    }

    async function deleteDocument() {
        try {
            await documentService.remove(documentActionId)
            setActionMessage('Document deleted.')
        } catch (err) {
            setActionMessage(err?.response?.data?.error || 'Document delete failed.')
        }
    }

    async function approveDisclosure(requestId) {
        try {
            await disclosureService.reviewRequest(requestId, { decision: 'approved', notes: 'Approved from dashboard' })
            const pendingDisclosureRes = await disclosureService.listPending({ page: 1, limit: 8 })
            setPendingDisclosures(pendingDisclosureRes?.requests || [])
            setActionMessage('Disclosure request approved.')
        } catch (err) {
            setActionMessage(err?.response?.data?.error || 'Unable to review disclosure.')
        }
    }

    async function applyVerificationOverride() {
        try {
            await verificationService.adminOverride(adminOverrideUserId, { verification_status: adminOverrideStatus, reason: 'Admin dashboard override' })
            setActionMessage('Verification status overridden.')
        } catch (err) {
            setActionMessage(err?.response?.data?.error || 'Verification override failed.')
        }
    }

    async function addFollowupEvent(caseId) {
        try {
            await caseService.addCaseEvent(caseId, {
                event_type: 'other',
                event_date: new Date().toISOString(),
                event_description: 'Administrative follow-up event added from dashboard',
                is_public: false,
            })
            setActionMessage('Follow-up timeline event added.')
        } catch (err) {
            setActionMessage(err?.response?.data?.error || 'Unable to add follow-up event.')
        }
    }

    const delayedColumns = [
        { key: 'cnr_number', label: 'Case Number' },
        { key: 'court', label: 'Court', render: (_value, row) => row?.court?.court_name || '-' },
        { key: 'days_since_update', label: 'Days Since Update' },
        {
            key: 'delay_risk_score',
            label: 'Risk',
            render: (value) => <Badge tone={riskLevelFromScore(value)}>{riskLevelFromScore(value)} ({value})</Badge>,
        },
        {
            key: 'actions',
            label: 'Actions',
            render: (_value, row) => (
                <div className="flex gap-2">
                    <button type="button" onClick={() => setCaseStatus(row._id, 'hearing')} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold dark:border-slate-700">Set Hearing</button>
                    <button type="button" onClick={() => setCaseStatus(row._id, 'disposed')} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold dark:border-slate-700">Dispose</button>
                    <button type="button" onClick={() => addFollowupEvent(row._id)} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold dark:border-slate-700">Add Event</button>
                    <button type="button" onClick={() => runCaseScan(row._id)} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold dark:border-slate-700">Scan</button>
                            <button type="button" onClick={() => loadCaseDetailAndAudit(row._id)} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold dark:border-slate-700">Detail</button>
                            <button type="button" onClick={() => quickUpdateCaseTitle(row._id)} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold dark:border-slate-700">Update</button>
                            <button type="button" onClick={() => quickDeleteCase(row._id)} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold dark:border-slate-700">Delete</button>
                </div>
            ),
        },
    ]

    if (loading) {
        return <Loader label="Loading governance analytics..." />
    }

    if (error) {
        return <EmptyState title="Admin dashboard unavailable" message={error} />
    }

    return (
        <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
                <Card title="Total Active Cases" subtitle="Currently under process">
                    <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{formatNumber(summary?.overview?.total_active_cases)}</p>
                </Card>
                <Card title="Pending Delay Alerts" subtitle="Warning, high risk, critical">
                    <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{formatNumber(summary?.overview?.total_delayed)}</p>
                </Card>
                <Card title="Stagnant Cases" subtitle="Immediate intervention candidates">
                    <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{formatNumber(summary?.overview?.total_stagnant)}</p>
                </Card>
            </div>

            {user?.role === 'admin' ? (
                <div className="grid gap-4 md:grid-cols-4">
                    <Card title="Registered Users">
                        <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{formatNumber(adminStats?.overview?.total_users)}</p>
                    </Card>
                    <Card title="Avg Delay Risk">
                        <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{Number(adminStats?.overview?.avg_delay_risk || 0).toFixed(2)}</p>
                    </Card>
                    <Card title="Pending Disclosure Reviews">
                        <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{formatNumber(pendingDisclosures.length)}</p>
                    </Card>
                    <Card title="Fully Verified Users">
                        <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{formatNumber(verificationUsers?.fully_verified)}</p>
                    </Card>
                </div>
            ) : null}

            <div className="grid gap-6 xl:grid-cols-3">
                <Card title="Delay Heat Distribution" subtitle="Case volume by severity" className="xl:col-span-2">
                    <StatusBarChart data={chartData} />
                </Card>

                <Card title="Top Performing Courts" subtitle="Resolution-rate leaderboard">
                    {!leaderboard.length ? (
                        <EmptyState title="No leaderboard data" message="Court ranking appears after case data sync." />
                    ) : (
                        <ol className="space-y-3">
                            {leaderboard.slice(0, 5).map((court) => (
                                <li key={court.court_id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                                    <div>
                                        <p className="text-sm font-semibold">#{court.rank} {court.court_name}</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">{court.district}, {court.state}</p>
                                    </div>
                                    <Badge tone="low">{court.resolution_rate}%</Badge>
                                </li>
                            ))}
                        </ol>
                    )}
                </Card>
            </div>

            <Card title="High-Risk Case Queue" subtitle="Operational monitoring for delayed proceedings">
                <Table
                    columns={delayedColumns}
                    rows={delayedCases}
                    emptyTitle="No delayed cases"
                    emptyMessage="All monitored cases are currently within acceptable timeline thresholds."
                />
                <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={runDelayScan} className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold text-white">Run Delay Scan</button>
                    <button type="button" onClick={() => delayedCases[0]?._id && loadDelayHistory(delayedCases[0]._id)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-700">Load Top Case Delay History</button>
                </div>
                {delayHistory ? (
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        Delay history loaded for {delayHistory?.case?.cnr_number || 'case'}: {delayHistory?.total_delay_alerts || 0} alerts.
                    </p>
                ) : null}
            </Card>

            <Card title="Recent Activity Feed" subtitle="System-generated risk and monitoring events">
                {!adminAlerts.length ? (
                    <EmptyState title="No recent activities" message="Activity feed updates after new scans and delay detections." />
                ) : (
                    <ul className="space-y-3">
                        {adminAlerts.slice(0, 6).map((item) => (
                            <li key={item._id} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                                <span className="mt-1">
                                    {(item.severity || '').toLowerCase() === 'critical' ? (
                                        <AlertTriangle className="h-4 w-4 text-rose-500" />
                                    ) : (item.severity || '').toLowerCase() === 'high' ? (
                                        <Activity className="h-4 w-4 text-orange-500" />
                                    ) : (
                                        <Trophy className="h-4 w-4 text-amber-500" />
                                    )}
                                </span>
                                <div>
                                    <p className="text-sm font-medium">{item.title || item.alert_type || 'Alert'}</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        {item.message || 'No details available'}
                                    </p>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>

            {user?.role === 'admin' ? (
                <Card title="Court Analytics Snapshot" subtitle="From /api/admin/court-analytics">
                    {!courtAnalytics.length ? (
                        <EmptyState title="No court analytics" message="Analytics will appear when courts have active case data." />
                    ) : (
                        <div className="space-y-2">
                            {courtAnalytics.slice(0, 6).map((court) => (
                                <div key={`${court.court_name}-${court.district}`} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
                                    <span>{court.court_name} ({court.district})</span>
                                    <div className="flex items-center gap-2">
                                        <Badge tone="info">{Number(court.resolution_rate || 0).toFixed(1)}%</Badge>
                                        {(court._id || court.court_id) ? (
                                            <button type="button" onClick={() => loadCourtLeaderboardAnalytics(court._id || court.court_id)} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold dark:border-slate-700">Detail</button>
                                        ) : null}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            ) : null}

            {user?.role === 'admin' ? (
                <Card title="Pending Disclosure Reviews" subtitle="Approve from dashboard">
                    {!pendingDisclosures.length ? (
                        <EmptyState title="No pending disclosures" message="All disclosure requests are reviewed." />
                    ) : (
                        <div className="space-y-2">
                            {pendingDisclosures.slice(0, 5).map((request) => (
                                <div key={request._id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
                                    <span>{request.case?.cnr_number || 'Case'} by {request.requested_by?.full_name || 'User'}</span>
                                    <button type="button" onClick={() => approveDisclosure(request._id)} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold dark:border-slate-700">Approve</button>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            ) : null}

            {user?.role === 'admin' ? (
                <div className="grid gap-6 xl:grid-cols-2">
                    <Card title="AI Operations" subtitle="/api/ai/status and /api/ai/queue">
                        <div className="space-y-2 text-sm">
                            <p>Provider availability: <strong>{aiStatus?.ai?.available ? 'Available' : 'Unavailable'}</strong></p>
                            <p>Configured provider: <strong>{aiStatus?.ai?.provider || '-'}</strong></p>
                            <p>Queue waiting: <strong>{aiQueue?.waiting ?? '-'}</strong></p>
                            <p>Queue active: <strong>{aiQueue?.active ?? '-'}</strong></p>
                            <p>SSE active connections: <strong>{sseStatus?.total_connections ?? '-'}</strong></p>
                            <input
                                value={aiDocumentId}
                                onChange={(e) => setAiDocumentId(e.target.value)}
                                placeholder="Document ID"
                                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                            />
                            <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => runAiAction('analyze')} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold dark:border-slate-700">Analyze</button>
                                <button type="button" onClick={() => runAiAction('analyze-sync')} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold dark:border-slate-700">Analyze Sync</button>
                                <button type="button" onClick={() => runAiAction('extract')} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold dark:border-slate-700">Extract</button>
                                <button type="button" onClick={() => runAiAction('summarize')} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold dark:border-slate-700">Summarize</button>
                                <button type="button" onClick={() => runAiAction('classify')} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold dark:border-slate-700">Classify</button>
                            </div>
                            <button type="button" onClick={refreshDiagnostics} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-700">Refresh Diagnostics</button>
                        </div>
                    </Card>

                    <Card title="Error Detection" subtitle="/api/errors endpoints">
                        <div className="space-y-2 text-sm">
                            <p>Total error alerts: <strong>{formatNumber(errorSummary?.total_error_alerts)}</strong></p>
                            <p>Critical errors: <strong>{formatNumber(errorSummary?.severity_breakdown?.critical)}</strong></p>
                            <button type="button" onClick={runGlobalErrorScan} className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold text-white">Run Scan All</button>
                            {!errorCases.length ? (
                                <p className="text-slate-500 dark:text-slate-400">No recent cases with errors.</p>
                            ) : (
                                <ul className="space-y-2">
                                    {errorCases.map((entry) => (
                                        <li key={entry.case?._id || Math.random()} className="rounded border border-slate-200 px-3 py-2 dark:border-slate-800">
                                            <p className="font-medium">{entry.case?.cnr_number || 'Unknown case'}</p>
                                            <p className="text-xs text-slate-500 dark:text-slate-400">{entry.errors?.length || 0} active error alerts</p>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </Card>
                </div>
            ) : null}

            {user?.role === 'admin' ? (
                <div className="grid gap-6 xl:grid-cols-2">
                    <Card title="Delay Redis Sets" subtitle="/api/delays/redis-sets">
                        <div className="space-y-2 text-sm">
                            <p>Warning set: <strong>{delayRedisSets?.delay_warning?.count ?? '-'}</strong></p>
                            <p>High risk set: <strong>{delayRedisSets?.delay_high_risk?.count ?? '-'}</strong></p>
                            <p>Critical set: <strong>{delayRedisSets?.delay_critical?.count ?? '-'}</strong></p>
                        </div>
                    </Card>

                    <Card title="Leaderboard Admin Ops" subtitle="/api/leaderboard/stats and refresh">
                        <div className="space-y-2 text-sm">
                            <p>Last refreshed: <strong>{leaderboardStats?.last_refreshed || '-'}</strong></p>
                            <p>Total cases in stats: <strong>{leaderboardStats?.statistics?.total_cases || '-'}</strong></p>
                            <button type="button" onClick={refreshLeaderboard} className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold text-white">Refresh Leaderboard</button>
                            {selectedCourtAnalytics ? (
                                <p className="text-xs text-slate-500 dark:text-slate-400">Loaded court analytics for {selectedCourtAnalytics?.court?.name}.</p>
                            ) : null}
                        </div>
                    </Card>
                </div>
            ) : null}

            {user?.role === 'admin' ? (
                <div className="grid gap-6 xl:grid-cols-2">
                    <Card title="Document Admin Actions" subtitle="Verify or delete by document ID">
                        <div className="space-y-2">
                            <input value={documentActionId} onChange={(e) => setDocumentActionId(e.target.value)} placeholder="Document ID" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
                            <div className="flex gap-2">
                                <button type="button" onClick={verifyDocument} className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-700">Verify</button>
                                <button type="button" onClick={deleteDocument} className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-700">Delete</button>
                            </div>
                        </div>
                    </Card>

                    <Card title="Verification Override" subtitle="Admin override user verification level">
                        <div className="space-y-2">
                            <input value={adminOverrideUserId} onChange={(e) => setAdminOverrideUserId(e.target.value)} placeholder="User ID" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" />
                            <select value={adminOverrideStatus} onChange={(e) => setAdminOverrideStatus(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950">
                                <option value="unverified">unverified</option>
                                <option value="otp_verified">otp_verified</option>
                                <option value="document_verified">document_verified</option>
                                <option value="fully_verified">fully_verified</option>
                            </select>
                            <button type="button" onClick={applyVerificationOverride} className="rounded border border-slate-300 px-3 py-2 text-xs font-semibold dark:border-slate-700">Apply Override</button>
                        </div>
                    </Card>
                </div>
            ) : null}

            {user?.role === 'admin' ? (
                <div className="grid gap-6 xl:grid-cols-2">
                    <Card title="Admin Data Endpoints" subtitle="Cases, stuck cases, logs, users">
                        <div className="space-y-1 text-sm">
                            <p>Admin cases loaded: <strong>{adminCases.length}</strong></p>
                            <p>Stuck cases loaded: <strong>{stuckCases.length}</strong></p>
                            <p>Audit logs loaded: <strong>{auditLogs.length}</strong></p>
                            <p>Users loaded: <strong>{adminUsers.length}</strong></p>
                            <p>Case stats total: <strong>{caseStats?.total_cases || caseStats?.total || 0}</strong></p>
                            <p>Event stats total events: <strong>{eventStats?.total_events || eventStats?.overview?.total_events || 0}</strong></p>
                        </div>
                    </Card>

                    <Card title="Selected Case Diagnostics" subtitle="Case detail and timeline audit endpoints">
                        <div className="space-y-1 text-sm">
                            <p>Case loaded: <strong>{selectedCaseDetail?.cnr_number || '-'}</strong></p>
                            <p>Timeline consistent: <strong>{selectedCaseTimelineAudit?.timeline_consistent ? 'yes' : selectedCaseTimelineAudit ? 'no' : '-'}</strong></p>
                            <p>Event preview count: <strong>{selectedCaseEvents.length}</strong></p>
                        </div>
                    </Card>
                </div>
            ) : null}

            {actionMessage ? (
                <p className="text-sm text-slate-600 dark:text-slate-300">{actionMessage}</p>
            ) : null}
        </div>
    )
}

export default AdminDashboardPage
