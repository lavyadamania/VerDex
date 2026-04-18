// ============================================================
// Role Utilities — Canonical role handling with legacy aliases
// ============================================================

const LEGACY_ROLE_MAP = {
  victim: 'user',
};

function normalizeRole(role) {
  if (!role || typeof role !== 'string') return role;
  return LEGACY_ROLE_MAP[role] || role;
}

function expandRoleAliases(role) {
  const normalized = normalizeRole(role);
  if (!normalized) return [];

  if (normalized === 'user') {
    return ['user', 'victim'];
  }

  return [normalized];
}

function hasRole(userRole, ...allowedRoles) {
  const normalizedUserRole = normalizeRole(userRole);
  return allowedRoles.some((allowedRole) => normalizeRole(allowedRole) === normalizedUserRole);
}

function isCaseOwnerRole(role) {
  return normalizeRole(role) === 'user';
}

module.exports = {
  normalizeRole,
  expandRoleAliases,
  hasRole,
  isCaseOwnerRole,
};