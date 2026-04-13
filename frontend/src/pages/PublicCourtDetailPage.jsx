import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Loader from '../components/ui/Loader'
import EmptyState from '../components/ui/EmptyState'
import publicService from '../services/publicService'
import mapService from '../services/mapService'
import courtService from '../services/courtService'
import { formatNumber, toSentence } from '../utils/formatters'

function PublicCourtDetailPage() {
    const { courtId } = useParams()
    const [courtData, setCourtData] = useState(null)
    const [mapData, setMapData] = useState(null)
    const [rawCourtData, setRawCourtData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    useEffect(() => {
        let mounted = true

        async function loadCourt() {
            try {
                setLoading(true)
                const [detail, mapDetail, rawCourt] = await Promise.all([
                    publicService.getCourtById(courtId),
                    mapService.getCourtDetail(courtId),
                    courtService.getCourtById(courtId),
                ])
                if (!mounted) return
                setCourtData(detail)
                setMapData(mapDetail)
                setRawCourtData(rawCourt?.court || null)
            } catch (err) {
                if (mounted) setError(err?.response?.data?.error || 'Unable to load court details.')
            } finally {
                if (mounted) setLoading(false)
            }
        }

        loadCourt()
        return () => {
            mounted = false
        }
    }, [courtId])

    if (loading) return <Loader label="Loading public court detail..." />
    if (error) return <EmptyState title="Court detail unavailable" message={error} />
    if (!courtData?.court) return <EmptyState title="Court not found" message="No public court detail found for this court." />

    const court = courtData.court
    const performance = courtData.performance || {}
    const byStatus = courtData?.breakdowns?.by_status || {}

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Public Court Profile</p>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{court.name}</h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400">{court.district}, {court.state}</p>
                </div>
                <Link to="/dashboard/public" className="text-sm font-semibold text-brand-700 hover:underline dark:text-brand-100">
                    Back to dashboard
                </Link>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
                <Card title="Court Type">
                    <Badge tone="info">{toSentence(court.type || '-')}</Badge>
                </Card>
                <Card title="Filed">
                    <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{formatNumber(performance.total_cases_filed)}</p>
                </Card>
                <Card title="Resolved">
                    <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{formatNumber(performance.total_cases_resolved)}</p>
                </Card>
                <Card title="Resolution Rate">
                    <Badge tone="success">{Number(performance.resolution_rate || 0).toFixed(1)}%</Badge>
                </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <Card title="Case Breakdown (Status)">
                    <ul className="space-y-2 text-sm">
                        {Object.keys(byStatus).length === 0 ? (
                            <li className="text-slate-500 dark:text-slate-400">No status breakdown available.</li>
                        ) : (
                            Object.entries(byStatus).map(([status, count]) => (
                                <li key={status} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
                                    <span>{toSentence(status)}</span>
                                    <strong>{formatNumber(count)}</strong>
                                </li>
                            ))
                        )}
                    </ul>
                </Card>

                <Card title="Map and Delay Snapshot">
                    <dl className="space-y-2 text-sm">
                        <div className="flex justify-between gap-3"><dt className="text-slate-500">Latitude</dt><dd>{mapData?.lat ?? '-'}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-slate-500">Longitude</dt><dd>{mapData?.lng ?? '-'}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-slate-500">Map JSI Score</dt><dd>{mapData?.jsi_score ?? '-'}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-slate-500">Map Delay Risk</dt><dd>{mapData?.delay_risk || '-'}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-slate-500">Pending (Map)</dt><dd>{mapData?.pending_cases ?? '-'}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-slate-500">Backend Court ID</dt><dd>{rawCourtData?.court_id || '-'}</dd></div>
                    </dl>
                </Card>
            </div>
        </div>
    )
}

export default PublicCourtDetailPage
