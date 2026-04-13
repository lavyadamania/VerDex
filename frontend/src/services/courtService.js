import api from './api'

const courtService = {
    async listCourts(params = {}) {
        const res = await api.get('/courts', { params })
        return res.data?.data
    },

    async getCourtById(id) {
        const res = await api.get(`/courts/${id}`)
        return res.data?.data
    },

    async getLeaderboard() {
        const res = await api.get('/courts/leaderboard/rank')
        return res.data?.data
    },
}

export default courtService
