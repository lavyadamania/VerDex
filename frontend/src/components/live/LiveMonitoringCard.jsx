import { useEffect, useState } from 'react'
import { Activity, AlertCircle, Clock, FileText, Zap, CheckCircle } from 'lucide-react'
import useLiveEvents from '../../hooks/useLiveEvents'
import eventService from '../../services/eventService'
import Loader from '../ui/Loader'
import EmptyState from '../ui/EmptyState'

/**
 * LiveMonitoringCard Component
 *
 * Displays real-time events from the system.
 * - Connects via Socket.io for live updates
 * - Fetches historical events on initial load
 * - Shows latest 5-10 events with timestamps
 * - Integrates with user role-based filtering (handled server-side)
 * - Displays "LIVE" indicator and connection status
 */
function LiveMonitoringCard() {
  const { events, setEvents, connecting, connected, error: socketError } = useLiveEvents()
  const [loading, setLoading] = useState(true)
  const [apiError, setApiError] = useState(null)

  // Load initial events on mount
  useEffect(() => {
    async function loadInitialEvents() {
      try {
        setLoading(true)
        const token = localStorage.getItem('ct_token')
        const result = token
          ? await eventService.getLiveEvents({ limit: 10 })
          : await eventService.getPublicEvents({ limit: 10 })

        if (result?.events) {
          setEvents(result.events)
        }
      } catch (err) {
        setApiError(err?.response?.data?.error || 'Failed to load events')
      } finally {
        setLoading(false)
      }
    }

    loadInitialEvents()
  }, [])

  const getEventIcon = (eventType) => {
    switch (eventType) {
      case 'STATUS_UPDATE':
        return <CheckCircle className="h-4 w-4 text-blue-500" />
      case 'HEARING_STARTED':
      case 'HEARING_SCHEDULED':
        return <Clock className="h-4 w-4 text-purple-500" />
      case 'DELAY_ALERT':
        return <AlertCircle className="h-4 w-4 text-orange-500" />
      case 'DOCUMENT_UPLOADED':
        return <FileText className="h-4 w-4 text-green-500" />
      case 'ADJOURNMENT':
        return <Zap className="h-4 w-4 text-amber-500" />
      case 'JUDGMENT':
        return <CheckCircle className="h-4 w-4 text-emerald-600" />
      default:
        return <Activity className="h-4 w-4 text-slate-500" />
    }
  }

  const getEventBadgeColor = (eventType) => {
    switch (eventType) {
      case 'STATUS_UPDATE':
        return 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
      case 'HEARING_STARTED':
      case 'HEARING_SCHEDULED':
        return 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
      case 'DELAY_ALERT':
        return 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
      case 'DOCUMENT_UPLOADED':
        return 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
      case 'ADJOURNMENT':
        return 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
      case 'JUDGMENT':
        return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
      default:
        return 'bg-slate-50 text-slate-700 dark:bg-slate-900/30 dark:text-slate-300'
    }
  }

  const formatTime = (timestamp) => {
    const now = new Date()
    const eventTime = new Date(timestamp)
    const diff = Math.floor((now - eventTime) / 1000)

    if (diff < 60) return 'now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return eventTime.toLocaleDateString()
  }

  // Display states
  if (loading && connecting) {
    return (
      <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <Loader label="Initializing live monitor..." />
      </div>
    )
  }

  if (socketError && events.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <EmptyState
          title="Live monitoring unavailable"
          message={socketError}
        />
      </div>
    )
  }

  if (apiError && events.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <EmptyState
          title="Failed to load events"
          message={apiError}
        />
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      {/* Header with Live Indicator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-slate-700 dark:text-slate-300" />
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Live Monitoring</p>
        </div>
        <div className="flex items-center gap-2">
          {connected && (
            <>
              <div className="inline-block h-2 w-2 animate-pulse rounded-full bg-green-500"></div>
              <span className="text-xs font-medium text-green-600 dark:text-green-400">LIVE</span>
            </>
          )}
          {!connected && !connecting && (
            <>
              <div className="h-2 w-2 rounded-full bg-slate-400"></div>
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Offline</span>
            </>
          )}
          {connecting && (
            <>
              <div className="inline-block h-2 w-2 animate-spin rounded-full border border-amber-500 border-t-transparent"></div>
              <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Connecting...</span>
            </>
          )}
        </div>
      </div>

      {/* No Events State */}
      {events.length === 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400">No events yet. Activity will appear here.</p>
      )}

      {/* Events List */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {events.slice(0, 10).map((event) => (
          <div
            key={event._id}
            className="flex gap-3 rounded-lg border border-slate-200 px-3 py-2 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/50"
          >
            <div className="mt-0.5">{getEventIcon(event.type)}</div>

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-slate-900 dark:text-slate-100 break-words">
                  {event.message}
                </p>
                <span
                  className={`shrink-0 whitespace-nowrap rounded px-2 py-1 text-xs font-medium ${getEventBadgeColor(event.type)}`}
                >
                  {event.type.replace(/_/g, ' ')}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {formatTime(event.createdAt)}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Footer Info */}
      <p className="border-t border-slate-200 pt-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        Showing {Math.min(events.length, 10)} of {events.length} events • Real-time updates enabled
      </p>
    </div>
  )
}

export default LiveMonitoringCard
