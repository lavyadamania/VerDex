// ============================================================
// Document Model
// ============================================================
const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  case: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Case',
    required: true,
    index: true,
  },
  uploaded_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  doc_type: {
    type: String,
    required: true,
    enum: ['fir', 'court_order', 'chargesheet', 'notice',
           'judgment', 'evidence', 'id_proof', 'other'],
  },
  file_name: { type: String, required: true },
  file_path: { type: String, required: true },
  file_size: Number,
  mime_type: String,
  extracted_text: String,    // AI-extracted OCR text
  ai_summary: String,        // AI-generated summary
  verified_status: {
    type: String,
    enum: ['pending', 'verified', 'rejected', 'flagged'],
    default: 'pending',
  },
  verification_notes: String,
}, {
  timestamps: true,
});

module.exports = mongoose.model('Document', documentSchema);
