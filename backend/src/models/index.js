// ============================================================
// Models Index — Export all Mongoose models
// ============================================================
const Court = require('./Court');
const User = require('./User');
const Case = require('./Case');
const CaseEvent = require('./CaseEvent');
const Document = require('./Document');
const Alert = require('./Alert');
const DisclosureRequest = require('./DisclosureRequest');
const AuditLog = require('./AuditLog');

module.exports = {
  Court,
  User,
  Case,
  CaseEvent,
  Document,
  Alert,
  DisclosureRequest,
  AuditLog,
};
