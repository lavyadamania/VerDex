import api from './api'

const documentService = {
    async upload(caseId, file, docType = 'other') {
        const formData = new FormData()
        formData.append('document', file)
        formData.append('doc_type', docType)

        const res = await api.post(`/documents/${caseId}/upload`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        })
        return res.data?.data
    },

    async download(docId) {
        const res = await api.get(`/documents/download/${docId}`, {
            responseType: 'blob',
        })
        return {
            blob: res.data,
            contentType: res.headers?.['content-type'] || 'application/octet-stream',
        }
    },

    async verify(docId, payload) {
        const res = await api.patch(`/documents/${docId}/verify`, payload)
        return res.data?.data
    },

    async remove(docId) {
        const res = await api.delete(`/documents/${docId}`)
        return res.data
    },
}

export default documentService
