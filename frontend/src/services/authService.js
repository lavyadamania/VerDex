import api from './api'

const authService = {
    async login(payload) {
        const res = await api.post('/auth/login', payload)
        return res.data?.data
    },

    async register(payload) {
        const res = await api.post('/auth/register', payload)
        return res.data?.data
    },

    async getMe() {
        const res = await api.get('/auth/me')
        return res.data?.data
    },

    async refresh(refreshToken) {
        const res = await api.post('/auth/refresh', { refreshToken })
        return res.data?.data
    },
}

export default authService
