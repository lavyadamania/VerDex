import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

function StatusBarChart({ data = [] }) {
    return (
        <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="value" radius={[8, 8, 0, 0]} fill="#1e3a8a" />
                </BarChart>
            </ResponsiveContainer>
        </div>
    )
}

export default StatusBarChart
