import api from './api'

const verificationService = {
    async validateCnr(cnr_number) {
        const res = await api.post('/verification/validate-cnr', { cnr_number })
        return res.data?.data
    },

    async getStatus() {
        const res = await api.get('/verification/status')
        return res.data?.data
    },

    async submitAdvocate(payload) {
        const res = await api.post('/verification/advocate', payload)
        return res.data?.data
    },

    async uploadIdProof(caseId, file) {
        const formData = new FormData()
        formData.append('id_proof', file)
        const res = await api.post(`/verification/upload-id/${caseId}`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        })
        return res.data?.data
    },

    async requestUpgrade() {
        const res = await api.post('/verification/request-upgrade')
        return res.data?.data
    },

    async listUsers(params = {}) {
        const res = await api.get('/verification/admin/users', { params })
        return res.data?.data
    },

    async adminOverride(userId, payload) {
        const res = await api.patch(`/verification/admin/${userId}`, payload)
        return res.data?.data
    },
}

export default verificationService
