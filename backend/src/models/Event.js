// ============================================================
// Event Model (MongoDB/Mongoose) — Real-time Activities Feed
// ============================================================
const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  // Event Details
  caseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Case',
    required: true,
  },
  type: {
    type: String,
    required: true,
    enum: [
      'STATUS_UPDATE',
      'HEARING_STARTED',
      'HEARING_SCHEDULED',
      'DELAY_ALERT',
      'DOCUMENT_UPLOADED',
      'ADJOURNMENT',
      'JUDGMENT',
      'STAGNATION_FLAG',
      'VERIFICATION_COMPLETE',
      'ADMIN_NOTE',
      'OTHER',
    ],
  },
  message: {
    type: String,
    required: true,
  },
  metadata: {
    caseNumber: String,
    caseTitle: String,
    courtName: String,
    oldValue: mongoose.Schema.Types.Mixed,
    newValue: mongoose.Schema.Types.Mixed,
  },

  // Creator
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },

  // Visibility Rules
  rolesVisibleTo: {
    type: [String],
    enum: ['victim', 'advocate', 'admin', 'court_staff', 'visitor'],
    default: ['admin', 'court_staff'],
  },
  usersVisibleTo: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'User',
    default: [],
  },

  // Timestamps
  eventDate: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes for efficient querying
eventSchema.index({ caseId: 1, createdAt: -1 });
eventSchema.index({ type: 1, createdAt: -1 });
eventSchema.index({ createdAt: -1 });
eventSchema.index({ eventDate: -1 });

module.exports = mongoose.model('Event', eventSchema);
