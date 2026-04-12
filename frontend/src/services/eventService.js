import api from './api'

const eventService = {
  async getLiveEvents(params = {}) {
    const res = await api.get('/events/live', { params })
    return res.data?.data
  },

  async getPublicEvents(params = {}) {
    const res = await api.get('/events/public', { params })
    return res.data?.data
  },

  async getCaseEvents(caseId, limit = 50) {
    const res = await api.get(`/events/case/${caseId}`, { params: { limit } })
    return res.data?.data
  },

  async getEventStats() {
    const res = await api.get('/events/stats')
    return res.data?.data
  },
}

export default eventService
