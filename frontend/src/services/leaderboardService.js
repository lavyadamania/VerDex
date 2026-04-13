import api from './api'

const leaderboardService = {
    async getStats() {
        const res = await api.get('/leaderboard/stats')
        return res.data?.data
    },

    async getCourtDetail(courtId) {
        const res = await api.get(`/leaderboard/court/${courtId}`)
        return res.data?.data
    },

    async refresh() {
        const res = await api.post('/leaderboard/refresh')
        return res.data?.data
    },
}

export default leaderboardService
