import api from './api'

const alertService = {
    async list(params = {}) {
        const res = await api.get('/alerts', { params })
        return res.data?.data
    },

    async getUnreadCount() {
        const res = await api.get('/alerts/count')
        return res.data?.data
    },

    async markAllRead() {
        const res = await api.patch('/alerts/read-all')
        return res.data?.data
    },

    async markRead(id) {
        const res = await api.patch(`/alerts/${id}/read`)
        return res.data?.data
    },

    async dismiss(id) {
        const res = await api.patch(`/alerts/${id}/dismiss`)
        return res.data?.data
    },

    async listAll(params = {}) {
        const res = await api.get('/alerts/admin/all', { params })
        return res.data?.data
    },
}

export default alertService
