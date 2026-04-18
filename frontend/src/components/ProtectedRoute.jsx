import { Navigate, useLocation } from 'react-router-dom'
import useAuth from '../hooks/useAuth'
import Loader from './ui/Loader'
import { normalizeRole } from '../utils/roles'

function ProtectedRoute({ children, allowedRoles = [] }) {
    const { isAuthenticated, user, loading } = useAuth()
    const location = useLocation()

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <Loader label="Validating session..." />
            </div>
        )
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" replace state={{ from: location.pathname }} />
    }

    const normalizedUserRole = normalizeRole(user?.role)
    const normalizedAllowedRoles = allowedRoles.map((role) => normalizeRole(role))

    if (allowedRoles.length > 0 && !normalizedAllowedRoles.includes(normalizedUserRole)) {
        return <Navigate to="/unauthorized" replace />
    }

    return children
}

export default ProtectedRoute
