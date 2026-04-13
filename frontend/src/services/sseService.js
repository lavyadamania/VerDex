import api from './api'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

function resolveSseBaseUrl() {
    if (API_BASE_URL.startsWith('http://') || API_BASE_URL.startsWith('https://')) {
        return API_BASE_URL
    }
    return window.location.origin + API_BASE_URL
}

const sseService = {
    connect(token, onMessage, onError) {
        if (!token) return null
        const base = resolveSseBaseUrl()
        const url = `${base}/sse/events?token=${encodeURIComponent(token)}`
        const source = new EventSource(url)

        source.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data)
                onMessage?.(payload)
            } catch {
                onMessage?.({ type: 'raw', data: event.data })
            }
        }

        source.onerror = (err) => {
            onError?.(err)
        }

        return source
    },

    async getStatus() {
        const res = await api.get('/sse/status')
        return res.data?.data
    },
}

export default sseService
