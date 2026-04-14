import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, FilePlus2, FileText, MapPin, ShieldCheck } from 'lucide-react'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Loader from '../components/ui/Loader'
import EmptyState from '../components/ui/EmptyState'
import Skeleton from '../components/ui/Skeleton'
import Timeline from '../components/ui/Timeline'
import caseService from '../services/caseService'
import documentService from '../services/documentService'
import aiService from '../services/aiService'
import verificationService from '../services/verificationService'
import disclosureService from '../services/disclosureService'
import alertService from '../services/alertService'
import courtService from '../services/courtService'
import useAuth from '../hooks/useAuth'
import useLiveEvents from '../hooks/useLiveEvents'
import { formatDate, toSentence } from '../utils/formatters'
import { riskLevelFromScore } from '../utils/risk'

const initialCaseForm = (user) => ({
    cnr_number: '',
    case_type: 'fraud',
    case_title: '',
    court_id: '',
    filing_date: '',
    accused_name: '',
    victim_statement: '',
    // Backend optional fields (auto-filled or stub):
    case_number: '',
    victim_id: user?._id || '',
    accused_id: '',
    judge_id: '',
    judge_name: '',
    advocate_name: '',
    advocate_contact: '',
})

function VictimDashboardPage() {
    const { user } = useAuth()
    const [cases, setCases] = useState([])
    const [selectedCase, setSelectedCase] = useState(null)
    const [timeline, setTimeline] = useState([])
    const [documents, setDocuments] = useState([])
    const [courts, setCourts] = useState([])
    const [showCaseForm, setShowCaseForm] = useState(false)
    const [formData, setFormData] = useState(() => initialCaseForm(user))
    const [submittingCase, setSubmittingCase] = useState(false)
    const [uploadingDocument, setUploadingDocument] = useState(false)
    const [aiRunningDocId, setAiRunningDocId] = useState('')
    const [formError, setFormError] = useState('')
    const [formSuccess, setFormSuccess] = useState('')
    const [verificationStatus, setVerificationStatus] = useState(null)
    const [verificationError, setVerificationError] = useState('')
    const [idProofFile, setIdProofFile] = useState(null)
    const [docFile, setDocFile] = useState(null)
    const [docType, setDocType] = useState('other')
    const [disclosureFields, setDisclosureFields] = useState([])
    const [selectedDisclosureFields, setSelectedDisclosureFields] = useState([])
    const [disclosureJustification, setDisclosureJustification] = useState('')
    const [disclosureRequests, setDisclosureRequests] = useState([])
    const [disclosureError, setDisclosureError] = useState('')
    const [apiAlerts, setApiAlerts] = useState([])
    const [unreadAlertCount, setUnreadAlertCount] = useState(0)
    const [disclosureHistory, setDisclosureHistory] = useState([])
    const [loading, setLoading] = useState(true)
    const [detailLoading, setDetailLoading] = useState(false)
    const [error, setError] = useState('')
    const [updateFlash, setUpdateFlash] = useState(false)
    const { events, status, pulseAt } = useLiveEvents()
    const isLive = status === 'live'

    useEffect(() => {
        let mounted = true

        async function loadData() {
            try {
                setLoading(true)
                const [casesRes, courtsRes, verificationRes, fieldsRes, myRequestsRes, alertsRes, unreadRes] = await Promise.all([
                    caseService.listCases({ page: 1, limit: 20 }),
                    courtService.listCourts(),
                    verificationService.getStatus(),
                    disclosureService.listFields(),
                    disclosureService.getMyRequests(),
                    alertService.list({ page: 1, limit: 10, filter: 'all' }),
                    alertService.getUnreadCount(),
                ])

                const loadedCases = casesRes?.cases || []
                if (!mounted) return
                setCases(loadedCases)
                setSelectedCase(loadedCases[0] || null)
                setCourts(courtsRes?.courts || [])
                setVerificationStatus(verificationRes || null)
                setDisclosureFields(fieldsRes?.disclosable_fields || [])
                setDisclosureRequests(myRequestsRes?.requests || [])
                setApiAlerts(alertsRes?.alerts || [])
                setUnreadAlertCount(unreadRes?.unread_count || 0)
            } catch (err) {
                if (mounted) setError(err?.response?.data?.error || 'Unable to load case data.')
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
        setFormData((current) => ({
            ...current,
            victim_id: user?._id || current.victim_id,
        }))
    }, [user?._id])

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
        const latest = events[0]
        if (!latest) return

        const shouldRefresh = ['CASE_UPDATE', 'DELAY_ALERT', 'DISCLOSURE_UPDATE', 'LEADERBOARD_UPDATE'].includes(latest.type)
        if (!shouldRefresh) return

        async function refreshVictimView() {
            try {
                const [casesRes, alertsRes, unreadRes, myRequestsRes] = await Promise.all([
                    caseService.listCases({ page: 1, limit: 20 }),
                    alertService.list({ page: 1, limit: 10, filter: 'all' }),
                    alertService.getUnreadCount(),
                    disclosureService.getMyRequests(),
                ])

                const loadedCases = casesRes?.cases || []
                setCases(loadedCases)
                setApiAlerts(alertsRes?.alerts || [])
                setUnreadAlertCount(unreadRes?.unread_count || 0)
                setDisclosureRequests(myRequestsRes?.requests || [])

                const nextSelected = loadedCases.find((c) => c._id === selectedCase?._id) || loadedCases[0] || null
                setSelectedCase(nextSelected)

                if (nextSelected?._id) {
                    const [eventsRes, docsRes, historyRes] = await Promise.all([
                        caseService.getCaseEvents(nextSelected._id),
                        caseService.getCaseDocuments(nextSelected._id),
                        disclosureService.getCaseHistory(nextSelected._id),
                    ])
                    setTimeline(eventsRes?.events || [])
                    setDocuments(docsRes?.documents || [])
                    setDisclosureHistory(historyRes?.history || [])
                }

                setUpdateFlash(true)
                setTimeout(() => setUpdateFlash(false), 1200)
            } catch {
                // no-op for live update pull failures
            }
        }

        refreshVictimView()
    }, [pulseAt])

    useEffect(() => {
        let mounted = true

        async function loadDisclosureHistory() {
            if (!selectedCase?._id) return
            try {
                const historyRes = await disclosureService.getCaseHistory(selectedCase._id)
                if (mounted) setDisclosureHistory(historyRes?.history || [])
            } catch {
                if (mounted) setDisclosureHistory([])
            }
        }

        loadDisclosureHistory()
        return () => {
            mounted = false
        }
    }, [selectedCase?._id])

    const selectedCourt = useMemo(
        () => courts.find((court) => court._id === formData.court_id),
        [courts, formData.court_id],
    )

    async function handleCaseSubmit(event) {
        event.preventDefault()
        setFormError('')
        setFormSuccess('')

        try {
            setSubmittingCase(true)
            const generatedCnr = `CNR-AUTO-${Date.now()}`
            const cnrNumber = (formData.cnr_number || '').trim() || generatedCnr

            // Validate only when user explicitly entered a CNR.
            if ((formData.cnr_number || '').trim()) {
                const cnrValidation = await verificationService.validateCnr(cnrNumber)
                if (!cnrValidation?.valid) {
                    setFormError('CNR format is invalid. Please correct before submit.')
                    return
                }
            }

            const payload = {
                ...formData,
                cnr_number: cnrNumber,
                victim_id: user?._id || formData.victim_id,
                filing_date: formData.filing_date,
            }

            const response = await caseService.createCase(payload)
            const createdCase = response?.case || null

            const refreshedCases = await caseService.listCases({ page: 1, limit: 20 })
            const loadedCases = refreshedCases?.cases || []
            setCases(loadedCases)
            if (createdCase?._id) {
                setSelectedCase(createdCase)
            } else if (loadedCases.length > 0) {
                setSelectedCase(loadedCases[0])
            }
            setFormSuccess('Case created successfully and added to your dashboard.')
            setFormData(initialCaseForm(user))
            setShowCaseForm(false)
        } catch (err) {
            setFormError(err?.response?.data?.error || 'Unable to create case right now.')
        } finally {
            setSubmittingCase(false)
        }
    }

    async function refreshAlerts() {
        try {
            const [alertsRes, unreadRes] = await Promise.all([
                alertService.list({ page: 1, limit: 10, filter: 'all' }),
                alertService.getUnreadCount(),
            ])
            setApiAlerts(alertsRes?.alerts || [])
            setUnreadAlertCount(unreadRes?.unread_count || 0)
        } catch {
            setApiAlerts([])
            setUnreadAlertCount(0)
        }
    }

    async function handleMarkAllAlertsRead() {
        try {
            await alertService.markAllRead()
            await refreshAlerts()
        } catch {
            // no-op
        }
    }

    async function handleDocumentUpload(event) {
        event.preventDefault()
        if (!selectedCase?._id || !docFile) return
        try {
            setUploadingDocument(true)
            await documentService.upload(selectedCase._id, docFile, docType)
            const docsRes = await caseService.getCaseDocuments(selectedCase._id)
            setDocuments(docsRes?.documents || [])
            setDocFile(null)
            setFormSuccess('Document uploaded successfully.')
        } catch (err) {
            setFormError(err?.response?.data?.error || 'Failed to upload document.')
        } finally {
            setUploadingDocument(false)
        }
    }

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
            setFormError('Failed to download document.')
        }
    }

    async function handleAiAction(docId, action) {
        try {
            setAiRunningDocId(docId)
            if (action === 'analyze') await aiService.analyzeDocument(docId)
            if (action === 'extract') await aiService.extractText(docId)
            if (action === 'summarize') await aiService.summarize(docId)
            if (action === 'classify') await aiService.classify(docId)
            setFormSuccess(`AI ${action} completed.`)
        } catch (err) {
            setFormError(err?.response?.data?.error || `AI ${action} failed.`)
        } finally {
            setAiRunningDocId('')
        }
    }

    async function handleUploadIdProof(event) {
        event.preventDefault()
        if (!selectedCase?._id || !idProofFile) return
        try {
            setUploadingDocument(true)
            await verificationService.uploadIdProof(selectedCase._id, idProofFile)
            setIdProofFile(null)
            const statusRes = await verificationService.getStatus()
            setVerificationStatus(statusRes)
            setFormSuccess('ID proof uploaded. Awaiting admin verification.')
        } catch (err) {
            setVerificationError(err?.response?.data?.error || 'Unable to upload ID proof.')
        } finally {
            setUploadingDocument(false)
        }
    }

    async function handleRequestUpgrade() {
        try {
            const result = await verificationService.requestUpgrade()
            const statusRes = await verificationService.getStatus()
            setVerificationStatus(statusRes)
            setFormSuccess(result?.message || 'Upgrade request processed.')
        } catch (err) {
            setVerificationError(err?.response?.data?.error || 'Unable to process verification upgrade.')
        }
    }

    async function handleDisclosureSubmit(event) {
        event.preventDefault()
        if (!selectedCase?._id || selectedDisclosureFields.length === 0) return
        try {
            setDisclosureError('')
            await disclosureService.submitRequest({
                case_id: selectedCase._id,
                requested_fields: selectedDisclosureFields,
                justification: disclosureJustification,
            })
            const myRequestsRes = await disclosureService.getMyRequests()
            setDisclosureRequests(myRequestsRes?.requests || [])
            setSelectedDisclosureFields([])
            setDisclosureJustification('')
            setFormSuccess('Disclosure request submitted for review.')
        } catch (err) {
            setDisclosureError(err?.response?.data?.error || 'Unable to submit disclosure request.')
        }
    }

    function toggleDisclosureField(field) {
        setSelectedDisclosureFields((current) => (
            current.includes(field)
                ? current.filter((item) => item !== field)
                : [...current, field]
        ))
    }

    async function handleAlertAction(action, id) {
        try {
            if (action === 'read') {
                await alertService.markRead(id)
            } else {
                await alertService.dismiss(id)
            }
            await refreshAlerts()
        } catch {
            // no-op
        }
    }

    async function handleRevokeDisclosure(requestId) {
        try {
            await disclosureService.revokeRequest(requestId)
            const myRequestsRes = await disclosureService.getMyRequests()
            setDisclosureRequests(myRequestsRes?.requests || [])
            if (selectedCase?._id) {
                const historyRes = await disclosureService.getCaseHistory(selectedCase._id)
                setDisclosureHistory(historyRes?.history || [])
            }
        } catch (err) {
            setDisclosureError(err?.response?.data?.error || 'Unable to revoke disclosure request.')
        }
    }

    function updateFormField(field, value) {
        setFormData((current) => ({ ...current, [field]: value }))
    }

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
            <div className="space-y-6">
                <Card
                    title="Add a New Case"
                    subtitle="Victim-only case registration"
                    action={
                        <button
                            type="button"
                            onClick={() => setShowCaseForm((value) => !value)}
                            className="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-800"
                        >
                            <FilePlus2 className="h-4 w-4" />
                            {showCaseForm ? 'Close Form' : 'Add Case'}
                        </button>
                    }
                >
                    <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
                        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                            <ShieldCheck className="h-4 w-4" />
                            Verified victim access
                        </span>
                        <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                            <FilePlus2 className="h-4 w-4" />
                            Simple form — just the essentials
                        </span>
                    </div>

                    {showCaseForm ? (
                        <form onSubmit={handleCaseSubmit} className="mt-6 space-y-4 max-w-2xl">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Case Type *</label>
                                <select className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" value={formData.case_type} onChange={(e) => updateFormField('case_type', e.target.value)} required>
                                    <option value="fraud">Fraud</option>
                                    <option value="domestic_violence">Domestic Violence</option>
                                    <option value="cybercrime">Cybercrime</option>
                                    <option value="sexual_assault">Sexual Assault</option>
                                    <option value="theft">Theft</option>
                                    <option value="kidnapping">Kidnapping</option>
                                    <option value="murder">Murder</option>
                                    <option value="dowry">Dowry</option>
                                    <option value="other">Other</option>
                                </select>
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Select the primary type of your case</p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Case Title / Brief Description *</label>
                                <input className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" placeholder="e.g., Property Fraud Case, Harassment Matter" value={formData.case_title} onChange={(e) => updateFormField('case_title', e.target.value)} required />
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Give your case a clear, short title</p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Court *</label>
                                <select className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" value={formData.court_id} onChange={(e) => updateFormField('court_id', e.target.value)} required>
                                    <option value="">Select your court</option>
                                    {courts.map((court) => (
                                        <option key={court._id} value={court._id}>
                                            {court.court_name} • {court.district}
                                        </option>
                                    ))}
                                </select>
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Choose the court where your case is filed</p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Filing Date *</label>
                                <input type="date" className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" value={formData.filing_date} onChange={(e) => updateFormField('filing_date', e.target.value)} required />
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">When was the case filed in court?</p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Accused Name (if known)</label>
                                <input className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" placeholder="Name of the accused party" value={formData.accused_name} onChange={(e) => updateFormField('accused_name', e.target.value)} />
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Optional — can add this later</p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Your Statement</label>
                                <textarea className="w-full min-h-32 rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" placeholder="Brief description of the case and what happened" value={formData.victim_statement} onChange={(e) => updateFormField('victim_statement', e.target.value)} />
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Share the key details of your case</p>
                            </div>

                            {selectedCourt ? (
                                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
                                    ✓ Case will be filed in: <span className="font-semibold">{selectedCourt.court_name}</span> ({selectedCourt.district}, {selectedCourt.state})
                                </div>
                            ) : null}

                            {formError ? <p className="text-sm text-rose-600 font-medium">{formError}</p> : null}
                            {formSuccess ? <p className="text-sm text-emerald-600 font-medium">{formSuccess}</p> : null}

                            <div className="flex justify-end gap-3 pt-2">
                                <button type="button" onClick={() => setShowCaseForm(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-900">
                                    Cancel
                                </button>
                                <button type="submit" disabled={submittingCase} className="rounded-lg bg-brand-700 px-6 py-2 text-sm font-semibold text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60">
                                    {submittingCase ? 'Submitting...' : 'Submit Case'}
                                </button>
                            </div>
                        </form>
                    ) : (
                        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
                            Add your case details and monitor its progress on your dashboard.
                        </p>
                    )}
                </Card>

                <EmptyState
                    title="No cases assigned"
                    message="Your case dashboard will display timeline, hearing schedules, and document updates once records are available."
                />
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-end gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className={`rounded-full px-2 py-0.5 font-semibold ${isLive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'}`}>
                    {isLive ? '🟢 Live' : '🔴 Reconnecting...'}
                </span>
                {updateFlash ? <span className="animate-pulse font-semibold text-amber-600 dark:text-amber-300">Updating</span> : null}
            </div>

            <Card
                title="Add a New Case"
                subtitle="Victim-only case registration"
                action={
                    <button
                        type="button"
                        onClick={() => setShowCaseForm((value) => !value)}
                        className="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-800"
                    >
                        <FilePlus2 className="h-4 w-4" />
                        {showCaseForm ? 'Close Form' : 'Add Case'}
                    </button>
                }
            >
                <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
                    <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        <ShieldCheck className="h-4 w-4" />
                        Verified victim access
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                        <FilePlus2 className="h-4 w-4" />
                        Simple form — just the essentials
                    </span>
                </div>

                {showCaseForm ? (
                    <form onSubmit={handleCaseSubmit} className="mt-6 space-y-4 max-w-2xl">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Case Type *</label>
                            <select className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" value={formData.case_type} onChange={(e) => updateFormField('case_type', e.target.value)} required>
                                <option value="fraud">Fraud</option>
                                <option value="domestic_violence">Domestic Violence</option>
                                <option value="cybercrime">Cybercrime</option>
                                <option value="sexual_assault">Sexual Assault</option>
                                <option value="theft">Theft</option>
                                <option value="kidnapping">Kidnapping</option>
                                <option value="murder">Murder</option>
                                <option value="dowry">Dowry</option>
                                <option value="other">Other</option>
                            </select>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Select the primary type of your case</p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Case Title / Brief Description *</label>
                            <input className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" placeholder="e.g., Property Fraud Case, Harassment Matter" value={formData.case_title} onChange={(e) => updateFormField('case_title', e.target.value)} required />
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Give your case a clear, short title</p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Court *</label>
                            <select className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" value={formData.court_id} onChange={(e) => updateFormField('court_id', e.target.value)} required>
                                <option value="">Select your court</option>
                                {courts.map((court) => (
                                    <option key={court._id} value={court._id}>
                                        {court.court_name} • {court.district}
                                    </option>
                                ))}
                            </select>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Choose the court where your case is filed</p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Filing Date *</label>
                            <input type="date" className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" value={formData.filing_date} onChange={(e) => updateFormField('filing_date', e.target.value)} required />
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">When was the case filed in court?</p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Accused Name (if known)</label>
                            <input className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" placeholder="Name of the accused party" value={formData.accused_name} onChange={(e) => updateFormField('accused_name', e.target.value)} />
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Optional — can add this later</p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Your Statement</label>
                            <textarea className="w-full min-h-32 rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" placeholder="Brief description of the case and what happened" value={formData.victim_statement} onChange={(e) => updateFormField('victim_statement', e.target.value)} />
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Share the key details of your case</p>
                        </div>

                        {selectedCourt ? (
                            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
                                ✓ Case will be filed in: <span className="font-semibold">{selectedCourt.court_name}</span> ({selectedCourt.district}, {selectedCourt.state})
                            </div>
                        ) : null}

                        {formError ? <p className="text-sm text-rose-600 font-medium">{formError}</p> : null}
                        {formSuccess ? <p className="text-sm text-emerald-600 font-medium">{formSuccess}</p> : null}

                        <div className="flex justify-end gap-3 pt-2">
                            <button type="button" onClick={() => setShowCaseForm(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-900">
                                Cancel
                            </button>
                            <button type="submit" disabled={submittingCase} className="rounded-lg bg-brand-700 px-6 py-2 text-sm font-semibold text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60">
                                {submittingCase ? 'Submitting...' : 'Submit Case'}
                            </button>
                        </div>
                    </form>
                ) : (
                    <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
                        Add your case details and monitor its progress on your dashboard.
                    </p>
                )}
            </Card>

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
                    <form onSubmit={handleDocumentUpload} className="mb-4 grid gap-2 md:grid-cols-4">
                        <input type="file" className="md:col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" onChange={(e) => setDocFile(e.target.files?.[0] || null)} />
                        <select className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" value={docType} onChange={(e) => setDocType(e.target.value)}>
                            <option value="other">Other</option>
                            <option value="evidence">Evidence</option>
                            <option value="notice">Notice</option>
                            <option value="court_order">Court Order</option>
                            <option value="judgment">Judgment</option>
                            <option value="id_proof">ID Proof</option>
                        </select>
                        <button type="submit" disabled={uploadingDocument || !docFile} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
                            {uploadingDocument ? 'Uploading...' : 'Upload'}
                        </button>
                    </form>
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

                <Card title="Alerts" subtitle="Actionable notices from alert API">
                    <div className="mb-3 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                        <span>Unread alerts: {unreadAlertCount}</span>
                        <button type="button" onClick={handleMarkAllAlertsRead} className="rounded border border-slate-300 px-2 py-1 font-semibold dark:border-slate-700">
                            Mark All Read
                        </button>
                    </div>
                    {!apiAlerts.length ? (
                        <EmptyState title="No active alerts" message="Critical updates will appear here when risk or schedule changes occur." />
                    ) : (
                        <ul className="space-y-3">
                            {apiAlerts.map((alert) => (
                                <li key={alert._id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                                    <div className="flex items-center gap-2">
                                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                                        <p className="text-sm font-semibold">{alert.title || alert.alert_type || 'Alert'}</p>
                                    </div>
                                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{alert.message || alert.text || 'No details available.'}</p>
                                    <div className="mt-2 flex gap-2">
                                        {!alert.read && (
                                            <button type="button" onClick={() => handleAlertAction('read', alert._id)} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold dark:border-slate-700">
                                                Mark Read
                                            </button>
                                        )}
                                        <button type="button" onClick={() => handleAlertAction('dismiss', alert._id)} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold dark:border-slate-700">
                                            Dismiss
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
                <Card title="Verification Center" subtitle="ID proof and verification upgrade">
                    <div className="space-y-3 text-sm">
                        <p className="text-slate-600 dark:text-slate-300">Current status: <span className="font-semibold">{verificationStatus?.current_status || user?.verification_status || 'unknown'}</span></p>
                        <form onSubmit={handleUploadIdProof} className="grid gap-2 md:grid-cols-3">
                            <input type="file" className="md:col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950" onChange={(e) => setIdProofFile(e.target.files?.[0] || null)} />
                            <button type="submit" disabled={uploadingDocument || !idProofFile || !selectedCase?._id} className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">Upload ID Proof</button>
                        </form>
                        <button type="button" onClick={handleRequestUpgrade} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-700">Request Upgrade</button>
                        {verificationError ? <p className="text-sm text-rose-600">{verificationError}</p> : null}
                    </div>
                </Card>

                <Card title="Disclosure Controls" subtitle="Choose fields to disclose publicly">
                    <form onSubmit={handleDisclosureSubmit} className="space-y-3">
                        <div className="grid gap-2 md:grid-cols-2">
                            {disclosureFields.map((field) => (
                                <label key={field} className="flex items-center gap-2 text-sm">
                                    <input
                                        type="checkbox"
                                        checked={selectedDisclosureFields.includes(field)}
                                        onChange={() => toggleDisclosureField(field)}
                                    />
                                    {field}
                                </label>
                            ))}
                        </div>
                        <textarea
                            className="min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                            placeholder="Justification (optional)"
                            value={disclosureJustification}
                            onChange={(e) => setDisclosureJustification(e.target.value)}
                        />
                        <button type="submit" disabled={!selectedDisclosureFields.length || !selectedCase?._id} className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">Submit Disclosure Request</button>
                        {disclosureError ? <p className="text-sm text-rose-600">{disclosureError}</p> : null}
                    </form>

                    <div className="mt-4 space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">My Requests</p>
                        {!disclosureRequests.length ? (
                            <p className="text-sm text-slate-500 dark:text-slate-400">No disclosure requests submitted yet.</p>
                        ) : (
                            disclosureRequests.slice(0, 5).map((request) => (
                                <div key={request._id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
                                    <span>{request.case?.cnr_number || 'Case'}</span>
                                    <div className="flex items-center gap-2">
                                        <Badge tone={request.status === 'approved' ? 'success' : request.status === 'rejected' ? 'danger' : 'warning'}>
                                            {request.status}
                                        </Badge>
                                        {request.status === 'approved' ? (
                                            <button type="button" onClick={() => handleRevokeDisclosure(request._id)} className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold dark:border-slate-700">
                                                Revoke
                                            </button>
                                        ) : null}
                                    </div>
                                </div>
                            ))
                        )}
                        {disclosureHistory.length ? (
                            <p className="text-xs text-slate-500 dark:text-slate-400">Case disclosure history entries: {disclosureHistory.length}</p>
                        ) : null}
                    </div>
                </Card>
            </div>
        </div>
    )
}

export default VictimDashboardPage
