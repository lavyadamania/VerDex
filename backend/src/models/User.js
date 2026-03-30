// ============================================================
// User Model (MongoDB/Mongoose)
// ============================================================
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password_hash: {
    type: String,
    required: true,
  },
  full_name: {
    type: String,
    required: true,
    trim: true,
  },
  phone: String,
  role: {
    type: String,
    required: true,
    enum: ['victim', 'admin', 'court_staff', 'advocate', 'visitor'],
    default: 'victim',
  },
  verification_status: {
    type: String,
    enum: ['unverified', 'otp_verified', 'document_verified', 'fully_verified'],
    default: 'unverified',
  },
  otp_code: String,
  otp_expires_at: Date,
  last_login: Date,
  is_active: { type: Boolean, default: true },
}, {
  timestamps: true,
});

// Don't return password hash in JSON
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password_hash;
  delete obj.otp_code;
  return obj;
};

userSchema.index({ role: 1 });
userSchema.index({ verification_status: 1 });

module.exports = mongoose.model('User', userSchema);
