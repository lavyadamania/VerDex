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
import { formatDate, formatNumber } from '../utils/formatters'
import { riskLevelFromScore } from '../utils/risk'

function AdminDashboardPage() {
    const [summary, setSummary] = useState(null)
    const [leaderboard, setLeaderboard] = useState([])
    const [delayedCases, setDelayedCases] = useState([])
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

                if (!mounted) return
                setSummary(summaryRes)
                setLeaderboard(leaderboardRes?.leaderboard || [])
                setDelayedCases(delayedRes?.cases || [])
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

    const delayedColumns = [
        { key: 'cnr_number', label: 'Case Number' },
        { key: 'court', label: 'Court', render: (_value, row) => row?.court?.court_name || '-' },
        { key: 'days_since_update', label: 'Days Since Update' },
        {
            key: 'delay_risk_score',
            label: 'Risk',
            render: (value) => <Badge tone={riskLevelFromScore(value)}>{riskLevelFromScore(value)} ({value})</Badge>,
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
            </Card>

            <Card title="Recent Activity Feed" subtitle="System-generated risk and monitoring events">
                {!delayedCases.length ? (
                    <EmptyState title="No recent activities" message="Activity feed updates after new scans and delay detections." />
                ) : (
                    <ul className="space-y-3">
                        {delayedCases.slice(0, 6).map((item) => (
                            <li key={item._id} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                                <span className="mt-1">
                                    {item.delay_risk_score >= 9 ? (
                                        <AlertTriangle className="h-4 w-4 text-rose-500" />
                                    ) : item.delay_risk_score >= 6 ? (
                                        <Activity className="h-4 w-4 text-orange-500" />
                                    ) : (
                                        <Trophy className="h-4 w-4 text-amber-500" />
                                    )}
                                </span>
                                <div>
                                    <p className="text-sm font-medium">{item.cnr_number} marked {riskLevelFromScore(item.delay_risk_score)} risk</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400">
                                        Last update: {formatDate(item.last_update)} | Court: {item?.court?.court_name || '-'}
                                    </p>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>
        </div>
    )
}

export default AdminDashboardPage
