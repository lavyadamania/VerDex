import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Loader from '../components/ui/Loader'
import Table from '../components/ui/Table'
import EmptyState from '../components/ui/EmptyState'
import StatusBarChart from '../components/charts/StatusBarChart'
import DelayDistributionChart from '../components/charts/DelayDistributionChart'
import publicService from '../services/publicService'
import mapService from '../services/mapService'
import { Clock3, Trophy } from 'lucide-react'
import { formatDate, formatNumber, toSentence } from '../utils/formatters'
import { riskLevelFromScore } from '../utils/risk'
import useLiveEvents from '../hooks/useLiveEvents'

function PublicDashboardPage() {
    const [cases, setCases] = useState([])
    const [stats, setStats] = useState(null)
    const [leaderboard, setLeaderboard] = useState([])
    const [mapStats, setMapStats] = useState(null)
    const [lastUpdated, setLastUpdated] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [updateFlash, setUpdateFlash] = useState(false)
    const [caseSearchInput, setCaseSearchInput] = useState('')
    const [searchLoading, setSearchLoading] = useState(false)
    const [searchError, setSearchError] = useState('')
    const [searchedCase, setSearchedCase] = useState(null)
    const { events, status, pulseAt } = useLiveEvents()

    const isLive = status === 'live'

    async function refreshCasesAndStats() {
        const [casesRes, statsRes] = await Promise.all([
            publicService.listCases({ page: 1, limit: 50 }),
            publicService.getStats(),
        ])
        setCases(casesRes?.cases || [])
        setStats(statsRes)
    }

    async function refreshLeaderboardAndMap() {
        const [courtsRes, mapStatsRes] = await Promise.all([
            publicService.getLeaderboard(),
            mapService.getStats(),
        ])
        setLeaderboard(courtsRes?.leaderboard || [])
        setMapStats(mapStatsRes || null)
    }

    useEffect(() => {
        let mounted = true

        async function loadData() {
            try {
                setLoading(true)
                const [casesRes, statsRes, courtsRes, mapStatsRes] = await Promise.allSettled([
                    publicService.listCases({ page: 1, limit: 50 }),
                    publicService.getStats(),
                    publicService.getLeaderboard(),
                    mapService.getStats(),
                ])

                if (!mounted) return
                setCases(casesRes.status === 'fulfilled' ? (casesRes.value?.cases || []) : [])
                setStats(statsRes.status === 'fulfilled' ? statsRes.value : null)
                setLeaderboard(courtsRes.status === 'fulfilled' ? (courtsRes.value?.leaderboard || []) : [])
                setMapStats(mapStatsRes.status === 'fulfilled' ? (mapStatsRes.value || null) : null)
                setLastUpdated(new Date())
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

    useEffect(() => {
        const latest = events[0]
        if (!latest) return

        if (latest.type === 'CASE_UPDATE' || latest.type === 'DELAY_ALERT' || latest.type === 'DISCLOSURE_UPDATE') {
            refreshCasesAndStats().catch(() => { })
            setLastUpdated(new Date())
            setUpdateFlash(true)
            setTimeout(() => setUpdateFlash(false), 1200)
            return
        }

        if (latest.type === 'LEADERBOARD_UPDATE') {
            refreshLeaderboardAndMap().catch(() => { })
            setLastUpdated(new Date())
            setUpdateFlash(true)
            setTimeout(() => setUpdateFlash(false), 1200)
        }
    }, [pulseAt, events])

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

    const leaderboardRows = useMemo(() => {
        return leaderboard.map((court, index) => ({
            rank: index + 1,
            court_name: court.court_name,
            district: court.district,
            court_type: toSentence(court.court_type),
            total_cases_filed: court.total_cases_filed,
            total_cases_resolved: court.cases_resolved,
            total_pending: court.cases_pending,
            resolution_rate: court.resolution_rate,
            lifecycle_completion_score: court.lifecycle_completion_score,
            justice_speed_index: court.justice_speed_index,
            court_id: court.court_id,
        }))
    }, [leaderboard])

    const columns = [
        {
            key: 'masked_id',
            label: 'Case ID',
            render: (value) => <Link to={`/dashboard/public/case/${value}`} className="font-semibold text-brand-700 hover:underline dark:text-brand-100">{value}</Link>,
        },
        { key: 'court_name', label: 'Court' },
        { key: 'days_pending', label: 'Days Pending' },
        { key: 'adjournment_count', label: 'Adjournments' },
        {
            key: 'delay_risk_score',
            label: 'Delay Risk',
            render: (value) => <Badge tone={riskLevelFromScore(value)}>{riskLevelFromScore(value)} ({value || 0})</Badge>,
        },
    ]

    const leaderboardColumns = [
        { key: 'rank', label: '#' },
        {
            key: 'court_name',
            label: 'Court Name',
            render: (value, row) => (
                row.court_id
                    ? <Link to={`/dashboard/public/court/${row.court_id}`} className="font-semibold text-brand-700 hover:underline dark:text-brand-100">{value}</Link>
                    : value
            ),
        },
        { key: 'district', label: 'City' },
        { key: 'court_type', label: 'Level' },
        { key: 'total_cases_filed', label: 'Filed' },
        { key: 'total_cases_resolved', label: 'Resolved' },
        { key: 'total_pending', label: 'Pending' },
        {
            key: 'lifecycle_completion_score',
            label: 'Lifecycle Score',
            render: (value) => <Badge tone="warning">{Number(value || 0).toFixed(1)}</Badge>,
        },
        {
            key: 'resolution_rate',
            label: 'Resolution Rate',
            render: (value) => <Badge tone="info">{Number(value || 0).toFixed(1)}%</Badge>,
        },
        {
            key: 'justice_speed_index',
            label: 'Overall Score',
            render: (value) => <Badge tone="success">{Number(value || 0).toFixed(1)}/100</Badge>,
        },
    ]

    async function handleCaseSearch(event) {
        event.preventDefault()

        const cnr = caseSearchInput.trim()
        if (!cnr) {
            setSearchError('Please enter a case number (CNR).')
            setSearchedCase(null)
            return
        }

        try {
            setSearchLoading(true)
            setSearchError('')
            const response = await publicService.searchCaseByCnr(cnr)
            setSearchedCase(response?.case || null)
        } catch (err) {
            setSearchedCase(null)
            setSearchError(err?.response?.data?.error || 'No case found for this case number.')
        } finally {
            setSearchLoading(false)
        }
    }

    if (loading) {
        return <Loader label="Loading public records..." />
    }

    if (error) {
        return <EmptyState title="Public dashboard unavailable" message={error} />
    }

    return (
        <div className="space-y-6">
            <Card title="Search Case by Case Number (CNR)" subtitle="Enter the full case number to view available public details.">
                <form onSubmit={handleCaseSearch} className="space-y-3">
                    <div className="flex flex-col gap-3 sm:flex-row">
                        <input
                            type="text"
                            value={caseSearchInput}
                            onChange={(e) => setCaseSearchInput(e.target.value)}
                            placeholder="Example: CNR-AUTO-1776505032093"
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                            aria-label="Search by case number"
                        />
                        <button
                            type="submit"
                            disabled={searchLoading}
                            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {searchLoading ? 'Searching...' : 'Search'}
                        </button>
                    </div>

                    {searchError ? (
                        <p className="text-sm font-medium text-rose-600 dark:text-rose-400">{searchError}</p>
                    ) : null}
                </form>

                {searchedCase ? (
                    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/50">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                            <span className="text-sm text-slate-600 dark:text-slate-300">Case Number:</span>
                            <span className="font-semibold text-slate-900 dark:text-slate-100">{searchedCase.cnr_number}</span>
                            <Badge tone={riskLevelFromScore(searchedCase.delay_risk_score)}>
                                {riskLevelFromScore(searchedCase.delay_risk_score)} ({searchedCase.delay_risk_score || 0})
                            </Badge>
                            <Badge tone="info">{toSentence(searchedCase.current_status || '')}</Badge>
                        </div>

                        <div className="grid gap-3 text-sm text-slate-700 dark:text-slate-300 sm:grid-cols-2 lg:grid-cols-3">
                            <p><span className="font-semibold">Masked ID:</span> <Link to={`/dashboard/public/case/${searchedCase.masked_id}`} className="text-brand-700 hover:underline dark:text-brand-100">{searchedCase.masked_id}</Link></p>
                            <p><span className="font-semibold">Case Type:</span> {toSentence(searchedCase.case_type || '')}</p>
                            <p><span className="font-semibold">Court:</span> {searchedCase.court_name || '-'}</p>
                            <p><span className="font-semibold">Location:</span> {searchedCase.district || '-'}{searchedCase.state ? `, ${searchedCase.state}` : ''}</p>
                            <p><span className="font-semibold">Filing Date:</span> {formatDate(searchedCase.filing_date)}</p>
                            <p><span className="font-semibold">Next Hearing:</span> {formatDate(searchedCase.next_hearing_date)}</p>
                            <p><span className="font-semibold">Days Pending:</span> {formatNumber(searchedCase.days_pending)}</p>
                            <p><span className="font-semibold">Adjournments:</span> {formatNumber(searchedCase.adjournment_count)}</p>
                        </div>
                    </div>
                ) : null}
            </Card>

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

            <div className="grid gap-4 md:grid-cols-3">
                <Card title="Map Courts Covered">
                    <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{formatNumber(mapStats?.total_courts)}</p>
                </Card>
                <Card title="Map High and Critical">
                    <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{formatNumber((mapStats?.risk_breakdown?.HIGH || 0) + (mapStats?.risk_breakdown?.CRITICAL || 0))}</p>
                </Card>
                <Card title="Map Avg JSI">
                    <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{Number(mapStats?.avg_jsi || 0).toFixed(1)}</p>
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

            <Card
                title="Live Court Leaderboard"
                subtitle="Ranked by end-to-end lifecycle and overall court score"
                action={
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className={`rounded-full px-2 py-0.5 font-semibold ${isLive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'}`}>
                            {isLive ? '🟢 Live' : '🔴 Reconnecting...'}
                        </span>
                        {updateFlash ? <span className="animate-pulse font-semibold text-amber-600 dark:text-amber-300">Updating</span> : null}
                        <Trophy className="h-4 w-4 text-amber-500" />
                        <Clock3 className="h-4 w-4" />
                        <span>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Live'}</span>
                    </div>
                }
            >
                <Table
                    columns={leaderboardColumns}
                    rows={leaderboardRows}
                    emptyTitle="No court ranking available"
                    emptyMessage="Court leaderboard data will appear once public court metrics are available."
                />
            </Card>

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
