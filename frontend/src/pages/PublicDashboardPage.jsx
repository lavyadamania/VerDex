import { useEffect, useMemo, useState } from 'react'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Loader from '../components/ui/Loader'
import Table from '../components/ui/Table'
import EmptyState from '../components/ui/EmptyState'
import StatusBarChart from '../components/charts/StatusBarChart'
import DelayDistributionChart from '../components/charts/DelayDistributionChart'
import publicService from '../services/publicService'
import { formatNumber, toSentence } from '../utils/formatters'
import { riskLevelFromScore } from '../utils/risk'

function PublicDashboardPage() {
    const [cases, setCases] = useState([])
    const [stats, setStats] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    useEffect(() => {
        let mounted = true

        async function loadData() {
            try {
                setLoading(true)
                const [casesRes, statsRes] = await Promise.all([
                    publicService.listCases({ page: 1, limit: 50 }),
                    publicService.getStats(),
                ])

                if (!mounted) return
                setCases(casesRes?.cases || [])
                setStats(statsRes)
            } catch (err) {
                if (mounted) setError(err?.response?.data?.error || 'Unable to load transparency dashboard.')
            } finally {
                if (mounted) setLoading(false)
            }
        }

        loadData()
        return () => {
            mounted = false
        }
    }, [])

    const statusChartData = useMemo(() => {
        const source = stats?.by_status || {}
        return Object.entries(source).map(([name, value]) => ({ name: toSentence(name), value }))
    }, [stats])

    const delayDistData = useMemo(() => {
        const counters = { low: 0, medium: 0, high: 0, critical: 0 }
        for (const c of cases) {
            counters[riskLevelFromScore(c.delay_risk_score)] += 1
        }
        return [
            { name: 'Low', value: counters.low },
            { name: 'Medium', value: counters.medium },
            { name: 'High', value: counters.high },
            { name: 'Critical', value: counters.critical },
        ]
    }, [cases])

    const columns = [
        { key: 'masked_id', label: 'Case ID' },
        { key: 'court_name', label: 'Court' },
        { key: 'days_pending', label: 'Days Pending' },
        { key: 'adjournment_count', label: 'Adjournments' },
        {
            key: 'delay_risk_score',
            label: 'Delay Risk',
            render: (value) => <Badge tone={riskLevelFromScore(value)}>{riskLevelFromScore(value)} ({value || 0})</Badge>,
        },
    ]

    if (loading) {
        return <Loader label="Loading public records..." />
    }

    if (error) {
        return <EmptyState title="Public dashboard unavailable" message={error} />
    }

    return (
        <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
                <Card title="Total Cases">
                    <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{formatNumber(stats?.overview?.total_cases)}</p>
                </Card>
                <Card title="High Risk Cases">
                    <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{formatNumber((delayDistData.find((x) => x.name === 'High')?.value || 0) + (delayDistData.find((x) => x.name === 'Critical')?.value || 0))}</p>
                </Card>
                <Card title="Stagnant Cases">
                    <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{formatNumber(stats?.delay_metrics?.stagnant_cases)}</p>
                </Card>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
                <Card title="Cases by Status" subtitle="Current case lifecycle distribution">
                    <StatusBarChart data={statusChartData} />
                </Card>
                <Card title="Delay Distribution" subtitle="Risk-level spread across tracked cases">
                    <DelayDistributionChart data={delayDistData} />
                </Card>
            </div>

            <Card title="Anonymized Case Registry" subtitle="Public transparency view with masked identifiers">
                <Table
                    columns={columns}
                    rows={cases}
                    emptyTitle="No public cases available"
                    emptyMessage="Anonymized case records will appear once data is published."
                />
            </Card>
        </div>
    )
}

export default PublicDashboardPage
