// ============================================================
// Case Model (MongoDB/Mongoose) — Core Entity
// ============================================================
const mongoose = require('mongoose');

const caseSchema = new mongoose.Schema({
  cnr_number: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  case_number: String,
  case_type: {
    type: String,
    required: true,
    enum: ['sexual_assault', 'domestic_violence', 'dowry', 'kidnapping',
           'murder', 'fraud', 'theft', 'cybercrime', 'other'],
  },
  case_title: String,
  court: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Court',
    required: true,
  },
  victim_user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  filing_date: {
    type: Date,
    required: true,
  },
  current_status: {
    type: String,
    enum: ['filed', 'hearing', 'evidence', 'arguments',
           'reserved', 'judgment', 'disposed', 'appealed'],
    default: 'filed',
  },
  next_hearing_date: Date,
  last_update: {
    type: Date,
    default: Date.now,
  },
  adjournment_count: { type: Number, default: 0 },
  total_hearings: { type: Number, default: 0 },

  // ── Disclosure Settings (victim-controlled) ──
  disclosure_mode: {
    type: String,
    enum: ['private', 'partial', 'full'],
    default: 'private',
  },
  disclosed_fields: {
    type: [String],   // e.g., ['accused_name', 'judge_name', 'timeline']
    default: [],
  },

  // ── Sensitive Data (NEVER in public view) ──
  accused_name: String,
  judge_name: String,
  victim_statement: String,
  advocate_name: String,
  advocate_contact: String,

  // ── Risk Scoring ──
  delay_risk_score: {
    type: Number,
    default: 0,
    min: 0,
    max: 10,
  },
  stagnation_flag: { type: Boolean, default: false },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Virtual: days pending
caseSchema.virtual('days_pending').get(function () {
  if (this.current_status === 'disposed') return 0;
  const filed = new Date(this.filing_date);
  const now = new Date();
  return Math.floor((now - filed) / (1000 * 60 * 60 * 24));
});

// Virtual: masked ID for public dashboard
caseSchema.virtual('masked_id').get(function () {
  const idStr = this._id.toString();
  return `CT-${idStr.slice(-6).toUpperCase()}`;
});

// Method: get anonymized version for public view
caseSchema.methods.toAnonymized = function () {
  const obj = {
    masked_id: this.masked_id,
    case_type: this.case_type,
    filing_date: this.filing_date,
    current_status: this.current_status,
    days_pending: this.days_pending,
    adjournment_count: this.adjournment_count,
    next_hearing_date: this.next_hearing_date,
    delay_risk_score: this.delay_risk_score,
    stagnation_flag: this.stagnation_flag,
  };

  // Include court info if populated
  if (this.court && this.court.court_name) {
    obj.court_name = this.court.court_name;
    obj.district = this.court.district;
    obj.state = this.court.state;
  }

  // Include disclosed fields only if disclosure_mode is not 'private'
  if (this.disclosure_mode !== 'private' && this.disclosed_fields.length > 0) {
    for (const field of this.disclosed_fields) {
      if (this[field] !== undefined) {
        obj[field] = this[field];
      }
    }
  }

  return obj;
};

caseSchema.index({ court: 1 });
caseSchema.index({ current_status: 1 });
caseSchema.index({ victim_user: 1 });
caseSchema.index({ next_hearing_date: 1 });
caseSchema.index({ last_update: 1 });
caseSchema.index({ delay_risk_score: -1 });

module.exports = mongoose.model('Case', caseSchema);
