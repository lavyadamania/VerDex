// ============================================================
// Alert Model
// ============================================================
const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  case: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Case',
    required: true,
    index: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
  },
  alert_type: {
    type: String,
    required: true,
    enum: ['delay_warning', 'delay_high_risk', 'delay_critical',
           'hearing_reminder', 'stagnation', 'document_verified',
           'disclosure_request', 'error_detected'],
  },
  alert_title: { type: String, required: true },
  alert_message: { type: String, required: true },
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium',
  },
  is_read: { type: Boolean, default: false },
  is_dismissed: { type: Boolean, default: false },
}, {
  timestamps: true,
});

// Compound index for fetching unread alerts efficiently
alertSchema.index({ user: 1, is_read: 1 });

module.exports = mongoose.model('Alert', alertSchema);
