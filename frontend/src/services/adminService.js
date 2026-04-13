import api from './api'

const adminService = {
    async getStats() {
        const res = await api.get('/admin/stats')
        return res.data?.data
    },

    async listCases(params = {}) {
        const res = await api.get('/admin/cases', { params })
        return res.data?.data
    },

    async getStuckCases(params = {}) {
        const res = await api.get('/admin/stuck-cases', { params })
        return res.data?.data
    },

    async getCourtAnalytics() {
        const res = await api.get('/admin/court-analytics')
        return res.data?.data
    },

    async getAuditLogs(params = {}) {
        const res = await api.get('/admin/audit-logs', { params })
        return res.data?.data
    },

    async listUsers(params = {}) {
        const res = await api.get('/admin/users', { params })
        return res.data?.data
    },
}

export default adminService
