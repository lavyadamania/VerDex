import api from './api'

const delayService = {
    async scanAll() {
        const res = await api.post('/delays/scan')
        return res.data?.data
    },

    async getHistory(caseId) {
        const res = await api.get(`/delays/history/${caseId}`)
        return res.data?.data
    },

    async getRedisSets() {
        const res = await api.get('/delays/redis-sets')
        return res.data?.data
    },
}

export default delayService
