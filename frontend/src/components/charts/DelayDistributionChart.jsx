import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

const COLORS = ['#10b981', '#f59e0b', '#f97316', '#e11d48']

function DelayDistributionChart({ data = [] }) {
    return (
        <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                    <Pie data={data} innerRadius={70} outerRadius={105} dataKey="value" nameKey="name" paddingAngle={3}>
                        {data.map((entry, index) => (
                            <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                        ))}
                    </Pie>
                    <Tooltip />
                </PieChart>
            </ResponsiveContainer>
        </div>
    )
}

export default DelayDistributionChart
