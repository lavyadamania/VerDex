import api from './api'

const mapService = {
    async listCourts(params = {}) {
        const res = await api.get('/courts/map', { params })
        return res.data?.data
    },

    async getStats() {
        const res = await api.get('/courts/map/stats')
        return res.data?.data
    },

    async getCourtDetail(id) {
        const res = await api.get(`/courts/map/${id}`)
        return res.data?.data
    },
}

export default mapService
