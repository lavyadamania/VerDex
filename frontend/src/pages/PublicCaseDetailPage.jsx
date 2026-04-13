import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Loader from '../components/ui/Loader'
import EmptyState from '../components/ui/EmptyState'
import publicService from '../services/publicService'
import { formatDate, toSentence } from '../utils/formatters'
import { riskLevelFromScore } from '../utils/risk'

function PublicCaseDetailPage() {
    const { maskedId } = useParams()
    const [caseDetail, setCaseDetail] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    useEffect(() => {
        let mounted = true

        async function loadCase() {
            try {
                setLoading(true)
                const data = await publicService.getCaseByMaskedId(maskedId)
                if (!mounted) return
                setCaseDetail(data?.case || null)
            } catch (err) {
                if (mounted) setError(err?.response?.data?.error || 'Unable to load public case detail.')
            } finally {
                if (mounted) setLoading(false)
            }
        }

        loadCase()
        return () => {
            mounted = false
        }
    }, [maskedId])

    if (loading) return <Loader label="Loading public case detail..." />
    if (error) return <EmptyState title="Case detail unavailable" message={error} />
    if (!caseDetail) return <EmptyState title="Case not found" message="No anonymized case was found for this identifier." />

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Public Record</p>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{caseDetail.masked_id}</h1>
                </div>
                <Link to="/dashboard/public" className="text-sm font-semibold text-brand-700 hover:underline dark:text-brand-100">
                    Back to dashboard
                </Link>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <Card title="Status">
                    <Badge tone="info">{toSentence(caseDetail.current_status || 'unknown')}</Badge>
                </Card>
                <Card title="Delay Risk">
                    <Badge tone={riskLevelFromScore(caseDetail.delay_risk_score)}>
                        {riskLevelFromScore(caseDetail.delay_risk_score)} ({caseDetail.delay_risk_score || 0}/10)
                    </Badge>
                </Card>
                <Card title="Total Events">
                    <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{caseDetail.total_events || 0}</p>
                </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <Card title="Case Metadata">
                    <dl className="space-y-2 text-sm">
                        <div className="flex justify-between gap-3"><dt className="text-slate-500">Case Type</dt><dd>{toSentence(caseDetail.case_type || '-')}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-slate-500">Filed On</dt><dd>{formatDate(caseDetail.filing_date)}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-slate-500">Last Update</dt><dd>{formatDate(caseDetail.last_update)}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-slate-500">Adjournments</dt><dd>{caseDetail.adjournment_count || 0}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-slate-500">Days Pending</dt><dd>{caseDetail.days_pending || 0}</dd></div>
                    </dl>
                </Card>

                <Card title="Court">
                    <dl className="space-y-2 text-sm">
                        <div className="flex justify-between gap-3"><dt className="text-slate-500">Name</dt><dd>{caseDetail.court_name || '-'}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-slate-500">District</dt><dd>{caseDetail.district || '-'}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-slate-500">State</dt><dd>{caseDetail.state || '-'}</dd></div>
                        <div className="flex justify-between gap-3"><dt className="text-slate-500">Level</dt><dd>{toSentence(caseDetail.court_type || '-')}</dd></div>
                    </dl>
                </Card>
            </div>
        </div>
    )
}

export default PublicCaseDetailPage
