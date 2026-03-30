// ============================================================
// Case Event Model (Timeline entries)
// ============================================================
const mongoose = require('mongoose');

const caseEventSchema = new mongoose.Schema({
  case: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Case',
    required: true,
    index: true,
  },
  event_type: {
    type: String,
    required: true,
    enum: ['filing', 'hearing', 'adjournment', 'order',
           'evidence_submitted', 'argument', 'judgment',
           'notice', 'transfer', 'other'],
  },
  event_date: {
    type: Date,
    required: true,
  },
  event_description: String,
  adjournment_reason: String,   // only when event_type = 'adjournment'
  order_summary: String,        // AI-generated summary
  is_public: { type: Boolean, default: false },
  created_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
}, {
  timestamps: true,
});

caseEventSchema.index({ event_date: -1 });

module.exports = mongoose.model('CaseEvent', caseEventSchema);
