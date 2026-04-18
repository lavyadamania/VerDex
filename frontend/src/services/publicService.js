import api from './api'

const publicService = {
    async listCases(params = {}) {
        const res = await api.get('/public/cases', { params })
        return res.data?.data
    },

    async searchCaseByCnr(cnr) {
        const res = await api.get('/public/cases/search/by-cnr', {
            params: { cnr },
        })
        return res.data?.data
    },

    async getCaseByMaskedId(maskedId) {
        const res = await api.get(`/public/cases/${maskedId}`)
        return res.data?.data
    },

    async getCourts(params = {}) {
        const res = await api.get('/public/courts', { params })
        return res.data?.data
    },

    async getCourtById(id) {
        const res = await api.get(`/public/courts/${id}`)
        return res.data?.data
    },

    async getLeaderboard(params = {}) {
        const res = await api.get('/leaderboard', { params })
        return res.data?.data
    },

    async getStats() {
        const res = await api.get('/public/stats')
        return res.data?.data
    },
}

export default publicService