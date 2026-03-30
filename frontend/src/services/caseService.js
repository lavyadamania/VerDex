import api from './api'

const caseService = {
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
}

export default caseService
