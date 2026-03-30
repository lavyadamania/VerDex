// ============================================================
// Disclosure Request Model
// ============================================================
const mongoose = require('mongoose');

const disclosureRequestSchema = new mongoose.Schema({
  case: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Case',
    required: true,
    index: true,
  },
  requested_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  requested_fields: {
    type: [String],           // e.g., ['accused_name', 'judge_name', 'timeline']
    required: true,
  },
  justification: String,
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'revoked'],
    default: 'pending',
  },
  safety_check_passed: { type: Boolean, default: false },
  safety_check_notes: String,
  reviewed_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  reviewed_at: Date,
}, {
  timestamps: true,
});

module.exports = mongoose.model('DisclosureRequest', disclosureRequestSchema);
