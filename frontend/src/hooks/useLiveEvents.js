import { useEffect, useState, useRef } from 'react'
import { io } from 'socket.io-client'

/**
 * useLiveEvents Hook
 *
 * Connects to Socket.io server and manages real-time event stream.
 * Features:
 * - JWT authentication via token
 * - Automatic reconnection
 * - Event filtering based on payload
 * - History pagination with initial load
 * - Room management (user, role, case-specific)
 *
 * Usage:
 *   const { events, connecting, error, joinCase, leaveCase } = useLiveEvents()
 */
export default function useLiveEvents() {
  const [events, setEvents] = useState([])
  const [connecting, setConnecting] = useState(true)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(null)
  const socketRef = useRef(null)
  const timeoutRef = useRef(null)

  useEffect(() => {
    // Get token from localStorage
    const token = localStorage.getItem('ct_token')

    // Connect to Socket.io server
    const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'
    socketRef.current = io(apiBase, {
      auth: {
        token: token || '',
      },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
    })

    // ── Connection Handlers ──
    socketRef.current.on('connect', () => {
      setConnected(true)
      setConnecting(false)
      setError(null)
      console.log('✅ Socket connected:', socketRef.current.id)
    })

    socketRef.current.on('disconnect', () => {
      setConnected(false)
      console.log('🔌 Socket disconnected')
    })

    socketRef.current.on('connect_error', (err) => {
      setError(`Connection error: ${err.message}`)
      console.error('Socket connection error:', err)
    })

    // ── Live Event Handler ──
    socketRef.current.on('live_event', (eventPayload) => {
      console.log('📡 Live event received:', eventPayload)
      setEvents((prev) => [eventPayload, ...prev.slice(0, 99)])
    })

    socketRef.current.on('pong', () => {
      console.log('🏓 Pong')
    })

    // Cleanup on unmount
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect()
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  // ── Join case-specific room ──
  const joinCase = (caseId) => {
    if (socketRef.current && connected) {
      socketRef.current.emit('join_case', caseId)
      console.log(`📍 Joined case room: ${caseId}`)
    }
  }

  // ── Leave case room ──
  const leaveCase = (caseId) => {
    if (socketRef.current && connected) {
      socketRef.current.emit('leave_case', caseId)
      console.log(`📍 Left case room: ${caseId}`)
    }
  }

  // ── Heartbeat to keep connection alive ──
  const sendPing = () => {
    if (socketRef.current && connected) {
      socketRef.current.emit('ping')
    }
  }

  return {
    events,
    setEvents,
    connecting,
    connected,
    error,
    joinCase,
    leaveCase,
    sendPing,
    socket: socketRef.current,
  }
}
