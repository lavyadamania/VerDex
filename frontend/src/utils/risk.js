export function riskLevelFromScore(score) {
    const value = Number(score || 0)
    if (value >= 9) return 'critical'
    if (value >= 6) return 'high'
    if (value >= 3) return 'medium'
    return 'low'
}
