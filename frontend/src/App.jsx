import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './layouts/AppShell'
import ProtectedRoute from './components/ProtectedRoute'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import VictimDashboardPage from './pages/VictimDashboardPage'
import AdvocateDashboardPage from './pages/AdvocateDashboardPage'
import PublicDashboardPage from './pages/PublicDashboardPage'
import AdminDashboardPage from './pages/AdminDashboardPage'
import UnauthorizedPage from './pages/UnauthorizedPage'

function App() {
    return (
        <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />

            <Route
                path="/dashboard/victim"
                element={
                    <ProtectedRoute allowedRoles={["victim"]}>
                        <AppShell title="Victim Dashboard">
                            <VictimDashboardPage />
                        </AppShell>
                    </ProtectedRoute>
                }
            />

            <Route
                path="/dashboard/advocate"
                element={
                    <ProtectedRoute allowedRoles={["advocate"]}>
                        <AppShell title="Advocate Dashboard">
                            <AdvocateDashboardPage />
                        </AppShell>
                    </ProtectedRoute>
                }
            />

            <Route
                path="/dashboard/public"
                element={
                    <AppShell title="Public Transparency Dashboard">
                        <PublicDashboardPage />
                    </AppShell>
                }
            />

            <Route
                path="/dashboard/admin"
                element={
                    <ProtectedRoute allowedRoles={["admin", "court_staff"]}>
                        <AppShell title="Admin and Court Dashboard">
                            <AdminDashboardPage />
                        </AppShell>
                    </ProtectedRoute>
                }
            />

            <Route path="/unauthorized" element={<UnauthorizedPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    )
}

export default App
