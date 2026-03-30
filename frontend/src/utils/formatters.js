export function formatDate(input) {
    if (!input) return '-'
    const date = new Date(input)
    if (Number.isNaN(date.getTime())) return '-'
    return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
    })
}

export function formatNumber(value) {
    const num = Number(value || 0)
    return num.toLocaleString()
}

export function toSentence(text = '') {
    return text
        .replaceAll('_', ' ')
        .replace(/\b\w/g, (m) => m.toUpperCase())
}
