// ============================================================
// Court Model (MongoDB/Mongoose)
// ============================================================
const mongoose = require('mongoose');

const courtSchema = new mongoose.Schema({
  court_name: {
    type: String,
    required: true,
    trim: true,
  },
  court_type: {
    type: String,
    required: true,
    enum: ['district', 'sessions', 'high_court', 'supreme', 'magistrate', 'special'],
  },
  district: {
    type: String,
    required: true,
    trim: true,
  },
  state: {
    type: String,
    required: true,
    trim: true,
  },
  pin_code: String,

  // ── Geo Coordinates (for delay heatmap) ──
  lat: { type: Number, default: null },
  lng: { type: Number, default: null },

  total_cases_filed: { type: Number, default: 0 },
  total_cases_resolved: { type: Number, default: 0 },
}, {
  timestamps: true,   // auto createdAt, updatedAt
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Virtual: resolution rate
courtSchema.virtual('resolution_rate').get(function () {
  if (this.total_cases_filed === 0) return 0;
  return ((this.total_cases_resolved / this.total_cases_filed) * 100).toFixed(1);
});

courtSchema.index({ state: 1, district: 1 });

module.exports = mongoose.model('Court', courtSchema);
