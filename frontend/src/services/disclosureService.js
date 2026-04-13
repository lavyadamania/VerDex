import api from './api'

const disclosureService = {
    async listFields() {
        const res = await api.get('/disclosure/fields')
        return res.data?.data
    },

    async submitRequest(payload) {
        const res = await api.post('/disclosure/request', payload)
        return res.data?.data
    },

    async getMyRequests() {
        const res = await api.get('/disclosure/my-requests')
        return res.data?.data
    },

    async getCaseHistory(caseId) {
        const res = await api.get(`/disclosure/case/${caseId}`)
        return res.data?.data
    },

    async revokeRequest(id) {
        const res = await api.post(`/disclosure/${id}/revoke`)
        return res.data?.data
    },

    async listPending(params = {}) {
        const res = await api.get('/disclosure/admin/pending', { params })
        return res.data?.data
    },

    async reviewRequest(id, payload) {
        const res = await api.patch(`/disclosure/${id}/review`, payload)
        return res.data?.data
    },
}

export default disclosureService
