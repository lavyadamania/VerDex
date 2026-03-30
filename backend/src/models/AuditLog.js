// ============================================================
// Audit Log Model
// ============================================================
const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  action: {
    type: String,
    required: true,        // e.g., 'case.create', 'disclosure.approve', 'document.upload'
  },
  entity_type: {
    type: String,
    required: true,        // 'case', 'document', 'disclosure', 'user', etc.
  },
  entity_id: mongoose.Schema.Types.ObjectId,
  old_value: mongoose.Schema.Types.Mixed,   // flexible JSON
  new_value: mongoose.Schema.Types.Mixed,   // flexible JSON
  ip_address: String,
  user_agent: String,
}, {
  timestamps: true,
});

auditLogSchema.index({ entity_type: 1, entity_id: 1 });
auditLogSchema.index({ user: 1 });
auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
