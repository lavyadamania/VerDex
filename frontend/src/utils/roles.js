const LEGACY_ROLE_MAP = {
    victim: 'user',
}

export function normalizeRole(role) {
    if (!role || typeof role !== 'string') return role
    return LEGACY_ROLE_MAP[role] || role
}