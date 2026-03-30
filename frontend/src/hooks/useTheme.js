import { useEffect, useState } from 'react'

function useTheme() {
    const [theme, setTheme] = useState(() => localStorage.getItem('ct_theme') || 'light')

    useEffect(() => {
        const root = document.documentElement
        if (theme === 'dark') root.classList.add('dark')
        else root.classList.remove('dark')
        localStorage.setItem('ct_theme', theme)
    }, [theme])

    function toggleTheme() {
        setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))
    }

    return { theme, toggleTheme }
}

export default useTheme
