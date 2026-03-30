import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

const api = axios.create({
    baseURL: API_BASE_URL,
    timeout: 15000,
})

api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('ct_token')
        if (token) {
            config.headers.Authorization = `Bearer ${token}`
        }
        return config
    },
    (error) => Promise.reject(error),
)

api.interceptors.response.use(
    (response) => response,
    (error) => {
        const status = error?.response?.status
        if (status === 401) {
            localStorage.removeItem('ct_token')
            localStorage.removeItem('ct_refresh_token')
            localStorage.removeItem('ct_user')
        }
        return Promise.reject(error)
    },
)

export default api
