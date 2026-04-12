import api from './api'

const publicService = {
    async listCases(params = {}) {
        const res = await api.get('/public/cases', { params })
        return res.data?.data
    },

    async getStats() {
        const res = await api.get('/public/stats')
        return res.data?.data
    },
}

export default publicService