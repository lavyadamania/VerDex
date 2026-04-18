import { useCallback, useEffect, useState } from 'react'
import { io } from 'socket.io-client'

const MAX_EVENTS = 200
const subscribers = new Set()

const globalState = {
  events: [],
  connected: false,
  connecting: false,
  status: 'idle', // idle | live | reconnecting | offline
  source: 'none', // sse | socket | none
  error: null,
  pulseAt: 0,
}

let sseSource = null
let socketRef = null
let reconnectTimer = null
let reconnectAttempts = 0
const seenEventKeys = new Set()

function notify() {
  subscribers.forEach((listener) => {
    try {
      listener({ ...globalState })
    } catch {
      // Ignore subscriber errors
    }
  })
}

function createEventKey(evt) {
  const type = evt?.type || 'UNKNOWN'
  const caseId = evt?.caseId || evt?.payload?.caseId || 'none'
  const ts = evt?.timestamp || evt?.createdAt || Date.now()
  return `${type}:${caseId}:${ts}`
}

function normalizeEvent(evt) {
  const type = evt?.type || 'CASE_UPDATE'
  const payload = evt?.payload || evt?.data || evt || {}
  const timestamp = evt?.timestamp || Date.now()

  return {
    _id: payload?._id || `${type}-${timestamp}-${Math.round(Math.random() * 1e6)}`,
    type,
    caseId: evt?.caseId || payload?.caseId || null,
    payload,
    message: payload?.message || evt?.message || type,
    timestamp,
    createdAt: new Date(timestamp).toISOString(),
  }
}

function ingestEvent(rawEvent) {
  const event = normalizeEvent(rawEvent)
  const key = createEventKey(event)

  if (seenEventKeys.has(key)) return
  seenEventKeys.add(key)
  if (seenEventKeys.size > 1000) {
    const first = seenEventKeys.values().next().value
    seenEventKeys.delete(first)
  }

  globalState.events = [event, ...globalState.events].slice(0, MAX_EVENTS)
  globalState.pulseAt = Date.now()
  notify()
}

function resolveSseBase() {
  const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api'
  if (apiBase.startsWith('http://') || apiBase.startsWith('https://')) return apiBase
  return `${window.location.origin}${apiBase}`
}

function setConnectionState(partial) {
  Object.assign(globalState, partial)
  notify()
}

function connectSocketFallback() {
  if (socketRef?.connected) return

  const token = localStorage.getItem('ct_token')
  const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'

  socketRef = io(apiBase, {
    auth: { token: token || '' },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 20,
  })

  socketRef.on('connect', () => {
    setConnectionState({ connected: true, connecting: false, status: 'live', source: 'socket', error: null })
  })

  socketRef.on('disconnect', () => {
    setConnectionState({ connected: false, connecting: false, status: 'offline', source: 'none' })
  })

  socketRef.on('connect_error', (err) => {
    setConnectionState({ connected: false, connecting: false, status: 'offline', source: 'none', error: err?.message || 'Socket connection error' })
  })

  socketRef.on('live_event', (eventPayload) => {
    ingestEvent(eventPayload)
  })
}

function connectSse() {
  if (sseSource) return

  const token = localStorage.getItem('ct_token')
  const base = resolveSseBase()
  const url = token
    ? `${base}/sse/events?token=${encodeURIComponent(token)}`
    : `${base}/sse/events`

  setConnectionState({ connecting: true, status: 'reconnecting', error: null })

  try {
    sseSource = new EventSource(url)
  } catch {
    sseSource = null
    connectSocketFallback()
    return
  }

  sseSource.onopen = () => {
    reconnectAttempts = 0
    setConnectionState({ connected: true, connecting: false, status: 'live', source: 'sse', error: null })
  }

  sseSource.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data)
      ingestEvent(payload)
    } catch {
      // Ignore malformed frames
    }
  }

  sseSource.onerror = () => {
    if (sseSource) {
      sseSource.close()
      sseSource = null
    }

    reconnectAttempts += 1
    setConnectionState({ connected: false, connecting: true, status: 'reconnecting', source: 'none', error: 'SSE disconnected' })

    const waitMs = Math.min(10000, 1000 * Math.max(1, reconnectAttempts))
    if (reconnectTimer) clearTimeout(reconnectTimer)

    reconnectTimer = setTimeout(() => {
      connectSse()
      if (reconnectAttempts >= 3) {
        connectSocketFallback()
      }
    }, waitMs)
  }
}

function disconnectAll() {
  if (sseSource) {
    sseSource.close()
    sseSource = null
  }

  if (socketRef) {
    socketRef.disconnect()
    socketRef = null
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

export default function useLiveEvents() {
  const [state, setState] = useState({ ...globalState })

  useEffect(() => {
    const listener = (next) => setState(next)
    subscribers.add(listener)

    if (!sseSource && !socketRef) {
      connectSse()
    }

    return () => {
      subscribers.delete(listener)
      if (subscribers.size === 0) {
        disconnectAll()
      }
    }
  }, [])

  const joinCase = useCallback((caseId) => {
    if (socketRef?.connected && caseId) {
      socketRef.emit('join_case', caseId)
    }
  }, [])

  const leaveCase = useCallback((caseId) => {
    if (socketRef?.connected && caseId) {
      socketRef.emit('leave_case', caseId)
    }
  }, [])

  const setEvents = useCallback((updater) => {
    globalState.events = typeof updater === 'function' ? updater(globalState.events) : updater
    notify()
  }, [])

  return {
    events: state.events,
    setEvents,
    connecting: state.connecting,
    connected: state.connected,
    status: state.status,
    source: state.source,
    error: state.error,
    pulseAt: state.pulseAt,
    joinCase,
    leaveCase,
    socket: socketRef,
  }
}
