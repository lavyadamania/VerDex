import { useCallback, useEffect, useMemo, useState } from 'react'
import authService from '../services/authService'
import AuthContext from './auth-context'

export function AuthProvider({ children }) {
    const [user, setUser] = useState(() => {
        const saved = localStorage.getItem('ct_user')
        return saved ? JSON.parse(saved) : null
    })
    const [loading, setLoading] = useState(true)

    const isAuthenticated = Boolean(user)

    useEffect(() => {
        let mounted = true

        async function bootstrapSession() {
            const token = localStorage.getItem('ct_token')
            if (!token) {
                if (mounted) setLoading(false)
                return
            }

            try {
                const payload = await authService.getMe()
                const sessionUser = payload?.user || payload
                if (mounted && sessionUser) {
                    setUser(sessionUser)
                    localStorage.setItem('ct_user', JSON.stringify(sessionUser))
                }
            } catch {
                localStorage.removeItem('ct_token')
                localStorage.removeItem('ct_refresh_token')
                localStorage.removeItem('ct_user')
                if (mounted) setUser(null)
            } finally {
                if (mounted) setLoading(false)
            }
        }

        bootstrapSession()

        return () => {
            mounted = false
        }
    }, [])

    const login = useCallback(async (credentials) => {
        const data = await authService.login(credentials)
        const sessionUser = data?.user
        localStorage.setItem('ct_token', data?.token || '')
        localStorage.setItem('ct_refresh_token', data?.refreshToken || '')
        localStorage.setItem('ct_user', JSON.stringify(sessionUser || null))
        setUser(sessionUser || null)
        return sessionUser
    }, [])

    const register = useCallback(async (payload) => {
        return authService.register(payload)
    }, [])

    const verifyOtp = useCallback(async (otp) => {
        const data = await authService.verifyOtp(otp)
        setUser((currentUser) => {
            const current = currentUser || {}
            const updated = { ...current, verification_status: data?.verification_status || 'otp_verified' }
            localStorage.setItem('ct_user', JSON.stringify(updated))
            return updated
        })
        return data
    }, [])

    const resendOtp = useCallback(async () => {
        return authService.resendOtp()
    }, [])

    const logout = useCallback(async () => {
        try {
            await authService.logout()
        } catch {
            // Clear local session even if backend logout fails.
        }
        localStorage.removeItem('ct_token')
        localStorage.removeItem('ct_refresh_token')
        localStorage.removeItem('ct_user')
        setUser(null)
    }, [])

    const value = useMemo(
        () => ({
            user,
            loading,
            isAuthenticated,
            login,
            register,
            verifyOtp,
            resendOtp,
            logout,
        }),
        [user, loading, isAuthenticated, login, register, verifyOtp, resendOtp, logout],
    )

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
