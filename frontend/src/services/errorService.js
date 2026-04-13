import api from './api'

const errorService = {
    async scanCase(caseId, alerts = true) {
        const res = await api.post(`/errors/scan/${caseId}`, null, {
            params: { alerts },
        })
        return res.data?.data
    },

    async scanAll(alerts = true) {
        const res = await api.post('/errors/scan-all', null, {
            params: { alerts },
        })
        return res.data?.data
    },

    async getSummary() {
        const res = await api.get('/errors/summary')
        return res.data?.data
    },

    async listCases(params = {}) {
        const res = await api.get('/errors/cases', { params })
        return res.data?.data
    },
}

export default errorService
