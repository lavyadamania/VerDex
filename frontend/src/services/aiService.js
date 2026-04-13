import api from './api'

const aiService = {
    async getStatus() {
        const res = await api.get('/ai/status')
        return res.data?.data
    },

    async analyzeDocument(documentId) {
        const res = await api.post(`/ai/analyze/${documentId}`)
        return res.data?.data
    },

    async analyzeDocumentSync(documentId) {
        const res = await api.post(`/ai/analyze-sync/${documentId}`)
        return res.data?.data
    },

    async extractText(documentId) {
        const res = await api.post(`/ai/extract-text/${documentId}`)
        return res.data?.data
    },

    async summarize(documentId) {
        const res = await api.post(`/ai/summarize/${documentId}`)
        return res.data?.data
    },

    async classify(documentId) {
        const res = await api.post(`/ai/classify/${documentId}`)
        return res.data?.data
    },

    async getQueue() {
        const res = await api.get('/ai/queue')
        return res.data?.data
    },
}

export default aiService
