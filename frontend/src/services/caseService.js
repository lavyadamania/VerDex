import api from './api'

const caseService = {
    async createCase(payload) {
        const res = await api.post('/cases', payload)
        return res.data?.data
    },

    async listCases(params = {}) {
        const res = await api.get('/cases', { params })
        return res.data?.data
    },

    async getCaseStats() {
        const res = await api.get('/cases/stats')
        return res.data?.data
    },

    async getCaseById(caseId) {
        const res = await api.get(`/cases/${caseId}`)
        return res.data?.data
    },

    async getCaseEvents(caseId) {
        const res = await api.get(`/cases/${caseId}/events`)
        return res.data?.data
    },

    async getDelaySummary() {
        const res = await api.get('/delays/summary')
        return res.data?.data
    },

    async getDelayedCases(params = {}) {
        const res = await api.get('/delays/cases', { params })
        return res.data?.data
    },

    async getCaseDocuments(caseId) {
        const res = await api.get(`/documents/${caseId}`)
        return res.data?.data
    },

    async updateCase(caseId, payload) {
        const res = await api.put(`/cases/${caseId}`, payload)
        return res.data?.data
    },

    async updateCaseStatus(caseId, payload) {
        const res = await api.patch(`/cases/${caseId}/status`, payload)
        return res.data?.data
    },

    async deleteCase(caseId) {
        const res = await api.delete(`/cases/${caseId}`)
        return res.data?.data
    },

    async addCaseEvent(caseId, payload) {
        const res = await api.post(`/cases/${caseId}/events`, payload)
        return res.data?.data
    },

    async getTimelineAudit(caseId) {
        const res = await api.get(`/cases/${caseId}/timeline-audit`)
        return res.data?.data
    },
}

export default caseService
