import { useState } from 'react'
import Sidebar from './Sidebar'
import TopNavbar from './TopNavbar'

function AppShell({ title, children }) {
    const [sidebarOpen, setSidebarOpen] = useState(false)

    return (
        <div className="min-h-screen bg-slate-100 dark:bg-slate-950">
            <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
            <div className="lg:pl-72">
                <TopNavbar title={title} onMenuClick={() => setSidebarOpen(true)} />
                <main className="p-4 lg:p-8">{children}</main>
            </div>
        </div>
    )
}

export default AppShell
