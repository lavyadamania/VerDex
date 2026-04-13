import { useEffect, useMemo, useState } from 'react'
import { FileText, Scale, Users } from 'lucide-react'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Loader from '../components/ui/Loader'
import EmptyState from '../components/ui/EmptyState'
import Timeline from '../components/ui/Timeline'
import caseService from '../services/caseService'
import documentService from '../services/documentService'
import aiService from '../services/aiService'
import verificationService from '../services/verificationService'
import disclosureService from '../services/disclosureService'
import { formatDate, formatNumber, toSentence } from '../utils/formatters'
import { riskLevelFromScore } from '../utils/risk'

function AdvocateDashboardPage() {
    const [cases, setCases] = useState([])
    const [selectedCase, setSelectedCase] = useState(null)
    const [timeline, setTimeline] = useState([])
    const [documents, setDocuments] = useState([])
    const [verificationStatus, setVerificationStatus] = useState(null)
    const [advocatePayload, setAdvocatePayload] = useState({ advocate_name: '', bar_council_id: '', advocate_phone: '', advocate_email: '' })
    const [disclosureFields, setDisclosureFields] = useState([])
    const [selectedDisclosureFields, setSelectedDisclosureFields] = useState([])
    const [disclosureJustification, setDisclosureJustification] = useState('')
    const [flowMessage, setFlowMessage] = useState('')
    const [aiRunningDocId, setAiRunningDocId] = useState('')
    const [loading, setLoading] = useState(true)
    const [detailLoading, setDetailLoading] = useState(false)
    const [error, setError] = useState('')

    useEffect(() => {
        let mounted = true

        async function loadCases() {
            try {
                setLoading(true)
                const response = await caseService.listCases({ page: 1, limit: 50 })
                const loadedCases = response?.cases || []
                if (!mounted) return
                setCases(loadedCases)
                setSelectedCase(loadedCases[0] || null)
            } catch (err) {
                if (mounted) setError(err?.response?.data?.error || 'Unable to load advocate case data.')
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

    useEffect(() => {
        let mounted = true

        async function loadVerificationAndDisclosure() {
            try {
                const [statusRes, fieldsRes] = await Promise.all([
                    verificationService.getStatus(),
                    disclosureService.listFields(),
                ])
                if (!mounted) return
                setVerificationStatus(statusRes)
                setDisclosureFields(fieldsRes?.disclosable_fields || [])
            } catch {
                if (mounted) {
                    setVerificationStatus(null)
                    setDisclosureFields([])
                }
            }
        }

        loadVerificationAndDisclosure()
        return () => {
            mounted = false
        }
    }, [])

    async function handleDownloadDocument(doc) {
        try {
            const { blob } = await documentService.download(doc._id)
            const url = window.URL.createObjectURL(blob)
            const a = window.document.createElement('a')
            a.href = url
            a.download = doc.file_name || 'document'
            a.click()
            window.URL.revokeObjectURL(url)
        } catch {
            setFlowMessage('Unable to download document.')
        }
    }

    async function handleAiAction(docId, action) {
        try {
            setAiRunningDocId(docId)
            if (action === 'analyze') await aiService.analyzeDocument(docId)
            if (action === 'extract') await aiService.extractText(docId)
            if (action === 'summarize') await aiService.summarize(docId)
            if (action === 'classify') await aiService.classify(docId)
            setFlowMessage(`AI ${action} completed.`)
        } catch (err) {
            setFlowMessage(err?.response?.data?.error || `AI ${action} failed.`)
        } finally {
            setAiRunningDocId('')
        }
    }

    async function handleSubmitAdvocate(event) {
        event.preventDefault()
        try {
            await verificationService.submitAdvocate(advocatePayload)
            const statusRes = await verificationService.getStatus()
            setVerificationStatus(statusRes)
            setFlowMessage('Advocate verification details submitted successfully.')
        } catch (err) {
            setFlowMessage(err?.response?.data?.error || 'Failed to submit advocate details.')
        }
    }

    async function handleDisclosureRequest(event) {
        event.preventDefault()
        if (!selectedCase?._id || !selectedDisclosureFields.length) return
        try {
            await disclosureService.submitRequest({
                case_id: selectedCase._id,
                requested_fields: selectedDisclosureFields,
                justification: disclosureJustification,
            })
            setSelectedDisclosureFields([])
            setDisclosureJustification('')
            setFlowMessage('Disclosure request submitted.')
        } catch (err) {
            setFlowMessage(err?.response?.data?.error || 'Unable to submit disclosure request for selected case.')
        }
    }

    function toggleDisclosureField(field) {
        setSelectedDisclosureFields((current) => (
            current.includes(field) ? current.filter((f) => f !== field) : [...current, field]
        ))
    }

    const overview = useMemo(() => {
        const active = cases.filter((c) => !['judgment', 'disposed'].includes(c.current_status)).length
        const upcomingHearings = cases.filter((c) => c.next_hearing_date && new Date(c.next_hearing_date) >= new Date()).length
        const highRisk = cases.filter((c) => Number(c.delay_risk_score || 0) >= 6).length

        return {
            total: cases.length,
            active,
            upcomingHearings,
            highRisk,
        }
    }, [cases])

    if (loading) {
        return <Loader label="Loading advocate workspace..." />
    }

    if (error) {
        return <EmptyState title="Advocate dashboard unavailable" message={error} />
    }

    return (
        <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-4">
                <Card title="Assigned Cases">
                    <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{formatNumber(overview.total)}</p>
                </Card>
                <Card title="Active Matters">
                    <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{formatNumber(overview.active)}</p>
                </Card>
                <Card title="Upcoming Hearings">
                    <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{formatNumber(overview.upcomingHearings)}</p>
                </Card>
                <Card title="High Risk">
                    <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{formatNumber(overview.highRisk)}</p>
                </Card>
            </div>

            {!cases.length ? (
                <EmptyState
                    title="No assigned cases"
                    message="Assigned client matters will appear here once case records are linked to your advocate profile."
                />
            ) : (
                <>
                    <div className="grid gap-6 xl:grid-cols-3">
                        <Card title="Case List" subtitle="Select a case to inspect" className="xl:col-span-1">
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
                                        <p className="font-semibold">{caseItem.case_title || caseItem.cnr_number || caseItem.masked_id}</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">{toSentence(caseItem.current_status)}</p>
                                    </button>
                                ))}
                            </div>
                        </Card>

                        <Card title="Case Snapshot" subtitle="Current selected matter" className="xl:col-span-2">
                            {!selectedCase ? (
                                <EmptyState title="Select a case" message="Choose a case from the list to see details." />
                            ) : (
                                <div className="grid gap-4 md:grid-cols-2">
                                    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                                        <div className="flex items-center gap-2">
                                            <Scale className="h-4 w-4 text-brand-700 dark:text-brand-100" />
                                            <p className="text-sm font-semibold">Case Profile</p>
                                        </div>
                                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{selectedCase.case_title || 'Untitled case'}</p>
                                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{selectedCase.cnr_number || selectedCase.masked_id}</p>
                                        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Next hearing: {formatDate(selectedCase.next_hearing_date)}</p>
                                    </div>
                                    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                                        <div className="flex items-center gap-2">
                                            <Users className="h-4 w-4 text-brand-700 dark:text-brand-100" />
                                            <p className="text-sm font-semibold">Risk Status</p>
                                        </div>
                                        <div className="mt-2">
                                            <Badge tone={riskLevelFromScore(selectedCase.delay_risk_score)}>
                                                {riskLevelFromScore(selectedCase.delay_risk_score)} ({selectedCase.delay_risk_score || 0}/10)
                                            </Badge>
                                        </div>
                                        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Monitor adjournment trends and inactivity windows for proactive filing.</p>
                                    </div>
                                </div>
                            )}
                        </Card>
                    </div>

                    <div className="grid gap-6 xl:grid-cols-2">
                        <Card title="Timeline" subtitle="Case events and procedural updates">
                            {detailLoading ? <Loader label="Loading timeline..." /> : <Timeline items={timeline} />}
                        </Card>

                        <Card title="Documents" subtitle="Uploaded records for selected case">
                            {detailLoading ? (
                                <Loader label="Loading documents..." />
                            ) : !documents.length ? (
                                <EmptyState title="No documents" message="Uploaded files for the selected case will appear here." />
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
                                            <div className="flex items-center gap-2">
                                                <Badge tone="info">{doc.verified_status}</Badge>
                                                <button type="button" onClick={() => handleDownloadDocument(doc)} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold dark:border-slate-700">
                                                    Download
                                                </button>
                                                <button type="button" disabled={aiRunningDocId === doc._id} onClick={() => handleAiAction(doc._id, 'analyze')} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold disabled:opacity-50 dark:border-slate-700">
                                                    Analyze
                                                </button>
                                                <button type="button" disabled={aiRunningDocId === doc._id} onClick={() => handleAiAction(doc._id, 'extract')} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold disabled:opacity-50 dark:border-slate-700">
                                                    Extract
                                                </button>
                                                <button type="button" disabled={aiRunningDocId === doc._id} onClick={() => handleAiAction(doc._id, 'summarize')} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold disabled:opacity-50 dark:border-slate-700">
                                                    Summarize
                                                </button>
                                                <button type="button" disabled={aiRunningDocId === doc._id} onClick={() => handleAiAction(doc._id, 'classify')} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold disabled:opacity-50 dark:border-slate-700">
                                                    Classify
                                                </button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </Card>
                    </div>

                    <div className="grid gap-6 xl:grid-cols-2">
                        <Card title="Verification Flow" subtitle="Layer 3 advocate confirmation">
                            <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">Current verification status: <span className="font-semibold">{verificationStatus?.current_status || 'unknown'}</span></p>
                            <form onSubmit={handleSubmitAdvocate} className="grid gap-2 md:grid-cols-2">
                                <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" placeholder="Advocate Name" value={advocatePayload.advocate_name} onChange={(e) => setAdvocatePayload((p) => ({ ...p, advocate_name: e.target.value }))} required />
                                <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" placeholder="Bar Council ID" value={advocatePayload.bar_council_id} onChange={(e) => setAdvocatePayload((p) => ({ ...p, bar_council_id: e.target.value }))} />
                                <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" placeholder="Phone" value={advocatePayload.advocate_phone} onChange={(e) => setAdvocatePayload((p) => ({ ...p, advocate_phone: e.target.value }))} />
                                <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" placeholder="Email" value={advocatePayload.advocate_email} onChange={(e) => setAdvocatePayload((p) => ({ ...p, advocate_email: e.target.value }))} />
                                <button type="submit" className="md:col-span-2 rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold text-white">Submit Advocate Details</button>
                            </form>
                        </Card>

                        <Card title="Disclosure Flow" subtitle="Request selective disclosure for selected case">
                            <form onSubmit={handleDisclosureRequest} className="space-y-3">
                                <div className="grid gap-2 md:grid-cols-2">
                                    {disclosureFields.map((field) => (
                                        <label key={field} className="flex items-center gap-2 text-sm">
                                            <input type="checkbox" checked={selectedDisclosureFields.includes(field)} onChange={() => toggleDisclosureField(field)} />
                                            {field}
                                        </label>
                                    ))}
                                </div>
                                <textarea className="min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" placeholder="Justification" value={disclosureJustification} onChange={(e) => setDisclosureJustification(e.target.value)} />
                                <button type="submit" disabled={!selectedCase?._id || !selectedDisclosureFields.length} className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">Submit Disclosure Request</button>
                            </form>
                        </Card>
                    </div>

                    {flowMessage ? (
                        <p className="text-sm text-slate-600 dark:text-slate-300">{flowMessage}</p>
                    ) : null}
                </>
            )}
        </div>
    )
}

export default AdvocateDashboardPage
