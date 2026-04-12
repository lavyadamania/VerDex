/**
 * Demo Data Seeder
 *
 * Usage:
 *   npm run seed:demo
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const env = require('../config/env');
const logger = require('../utils/logger');

const User = require('../models/User');
const Case = require('../models/Case');
const Document = require('../models/Document');
const Event = require('../models/Event');
const Alert = require('../models/Alert');
const Court = require('../models/Court');

const DEMO_PASSWORD = 'password123';

async function connectDB() {
  await mongoose.connect(env.MONGO_URI);
  logger.info('Connected to MongoDB');
}

async function clearCollections() {
  await Promise.all([
    Alert.deleteMany({}),
    Event.deleteMany({}),
    Document.deleteMany({}),
    Case.deleteMany({}),
    Court.deleteMany({}),
    User.deleteMany({}),
  ]);
}

async function seedUsers() {
  const password_hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const users = await User.insertMany([
    {
      email: 'victim@example.com',
      password_hash,
      full_name: 'Alice Victim',
      phone: '9876543210',
      role: 'victim',
      verification_status: 'fully_verified',
    },
    {
      email: 'advocate@example.com',
      password_hash,
      full_name: 'Bob Advocate',
      phone: '9876543211',
      role: 'advocate',
      verification_status: 'fully_verified',
      advocate_name: 'Bob Advocate',
      bar_council_id: 'BAR/2020/001',
      advocate_phone: '9876543211',
      advocate_email: 'advocate@example.com',
      advocate_confirmed: true,
      advocate_confirmed_at: new Date(),
    },
    {
      email: 'staff@example.com',
      password_hash,
      full_name: 'Carol Court Staff',
      phone: '9876543212',
      role: 'court_staff',
      verification_status: 'fully_verified',
    },
    {
      email: 'admin@example.com',
      password_hash,
      full_name: 'David Admin',
      phone: '9876543213',
      role: 'admin',
      verification_status: 'fully_verified',
    },
  ]);

  return {
    victim: users.find((u) => u.role === 'victim'),
    advocate: users.find((u) => u.role === 'advocate'),
    staff: users.find((u) => u.role === 'court_staff'),
    admin: users.find((u) => u.role === 'admin'),
    all: users,
  };
}

async function seedCourts() {
  const courts = await Court.insertMany([
    {
      court_name: 'High Court, Mumbai',
      court_type: 'high_court',
      district: 'Mumbai',
      state: 'Maharashtra',
      pin_code: '400001',
      lat: 19.076,
      lng: 72.8777,
    },
    {
      court_name: 'Delhi High Court',
      court_type: 'high_court',
      district: 'New Delhi',
      state: 'Delhi',
      pin_code: '110003',
      lat: 28.6139,
      lng: 77.209,
    },
  ]);

  return courts;
}

async function seedCases(users, courts) {
  const now = Date.now();

  const cases = await Case.insertMany([
    {
      cnr_number: 'CNR-2026-001-MH-HC',
      case_type: 'fraud',
      case_title: 'Property Investment Fraud',
      court: courts[0]._id,
      victim_user: users.victim._id,
      filing_date: new Date(now - 45 * 24 * 60 * 60 * 1000),
      current_status: 'hearing',
      next_hearing_date: new Date(now + 3 * 24 * 60 * 60 * 1000),
      disclosure_mode: 'partial',
      disclosed_fields: ['judge_name', 'timeline'],
      accused_name: 'Redacted',
      judge_name: 'Hon. Justice A. K. Sharma',
      advocate_name: users.advocate.full_name,
      advocate_contact: users.advocate.phone,
      total_hearings: 2,
      adjournment_count: 1,
      delay_risk_score: 4,
    },
    {
      cnr_number: 'CNR-2026-002-MH-HC',
      case_type: 'domestic_violence',
      case_title: 'Domestic Violence Complaint',
      court: courts[0]._id,
      victim_user: users.victim._id,
      filing_date: new Date(now - 15 * 24 * 60 * 60 * 1000),
      current_status: 'filed',
      next_hearing_date: new Date(now + 1 * 24 * 60 * 60 * 1000),
      disclosure_mode: 'full',
      disclosed_fields: ['judge_name', 'timeline', 'advocate_name'],
      judge_name: 'Hon. Justice P. N. Deshmukh',
      advocate_name: users.advocate.full_name,
      advocate_contact: users.advocate.phone,
      total_hearings: 0,
      adjournment_count: 0,
      delay_risk_score: 2,
    },
    {
      cnr_number: 'CNR-2026-003-DL-HC',
      case_type: 'cybercrime',
      case_title: 'Online Identity Theft',
      court: courts[1]._id,
      victim_user: null,
      filing_date: new Date(now - 120 * 24 * 60 * 60 * 1000),
      current_status: 'evidence',
      next_hearing_date: new Date(now + 7 * 24 * 60 * 60 * 1000),
      disclosure_mode: 'full',
      disclosed_fields: ['judge_name'],
      judge_name: 'Hon. Justice R. K. Singh',
      total_hearings: 5,
      adjournment_count: 3,
      delay_risk_score: 7,
      stagnation_flag: true,
    },
  ]);

  return cases;
}

async function seedDocuments(cases, users) {
  await Document.insertMany([
    {
      case: cases[0]._id,
      uploaded_by: users.victim._id,
      doc_type: 'evidence',
      file_name: 'property-evidence.pdf',
      file_path: '/uploads/property-evidence.pdf',
      file_size: 204800,
      mime_type: 'application/pdf',
      verified_status: 'verified',
    },
    {
      case: cases[1]._id,
      uploaded_by: users.staff._id,
      doc_type: 'court_order',
      file_name: 'interim-order.pdf',
      file_path: '/uploads/interim-order.pdf',
      file_size: 118000,
      mime_type: 'application/pdf',
      verified_status: 'pending',
    },
    {
      case: cases[2]._id,
      uploaded_by: users.admin._id,
      doc_type: 'fir',
      file_name: 'fir-copy.pdf',
      file_path: '/uploads/fir-copy.pdf',
      file_size: 98000,
      mime_type: 'application/pdf',
      verified_status: 'verified',
    },
  ]);
}

async function seedEvents(cases, users) {
  const now = Date.now();

  await Event.insertMany([
    {
      caseId: cases[0]._id,
      type: 'STATUS_UPDATE',
      message: 'Case moved from filed to hearing',
      createdBy: users.staff._id,
      metadata: {
        caseNumber: cases[0].cnr_number,
        caseTitle: cases[0].case_title,
        oldValue: 'filed',
        newValue: 'hearing',
      },
      rolesVisibleTo: ['admin', 'court_staff', 'advocate', 'victim', 'visitor'],
      usersVisibleTo: [users.victim._id],
      createdAt: new Date(now - 2 * 24 * 60 * 60 * 1000),
    },
    {
      caseId: cases[0]._id,
      type: 'HEARING_SCHEDULED',
      message: 'Next hearing scheduled for 3 days from now',
      createdBy: users.staff._id,
      metadata: {
        caseNumber: cases[0].cnr_number,
        caseTitle: cases[0].case_title,
        newValue: cases[0].next_hearing_date,
      },
      rolesVisibleTo: ['admin', 'court_staff', 'advocate', 'victim', 'visitor'],
      usersVisibleTo: [users.victim._id],
      createdAt: new Date(now - 24 * 60 * 60 * 1000),
    },
    {
      caseId: cases[1]._id,
      type: 'DOCUMENT_UPLOADED',
      message: 'Court order uploaded to case documents',
      createdBy: users.staff._id,
      metadata: {
        caseNumber: cases[1].cnr_number,
        caseTitle: cases[1].case_title,
      },
      rolesVisibleTo: ['admin', 'court_staff', 'advocate', 'victim', 'visitor'],
      usersVisibleTo: [users.victim._id],
      createdAt: new Date(now - 6 * 60 * 60 * 1000),
    },
    {
      caseId: cases[2]._id,
      type: 'DELAY_ALERT',
      message: 'Case has crossed delay threshold and needs review',
      createdBy: null,
      metadata: {
        caseNumber: cases[2].cnr_number,
        caseTitle: cases[2].case_title,
        newValue: 120,
      },
      rolesVisibleTo: ['admin', 'court_staff'],
      usersVisibleTo: [],
      createdAt: new Date(now - 2 * 60 * 60 * 1000),
    },
    {
      caseId: cases[2]._id,
      type: 'STAGNATION_FLAG',
      message: 'Case marked stagnant due to inactivity',
      createdBy: null,
      metadata: {
        caseNumber: cases[2].cnr_number,
        caseTitle: cases[2].case_title,
      },
      rolesVisibleTo: ['admin', 'court_staff'],
      usersVisibleTo: [],
      createdAt: new Date(now - 60 * 60 * 1000),
    },
  ]);
}

async function seedAlerts(cases, users) {
  await Alert.insertMany([
    {
      case: cases[0]._id,
      user: users.victim._id,
      alert_type: 'hearing_reminder',
      alert_title: 'Hearing Reminder',
      alert_message: 'Your hearing is scheduled in 3 days.',
      severity: 'medium',
      is_read: false,
    },
    {
      case: cases[2]._id,
      user: users.staff._id,
      alert_type: 'stagnation',
      alert_title: 'Stagnation Alert',
      alert_message: 'A case has been stagnant for too long.',
      severity: 'high',
      is_read: false,
    },
  ]);
}

async function seedAll() {
  try {
    await connectDB();
    logger.info('Starting demo data seed');

    await clearCollections();
    const users = await seedUsers();
    const courts = await seedCourts();
    const cases = await seedCases(users, courts);
    await seedDocuments(cases, users);
    await seedEvents(cases, users);
    await seedAlerts(cases, users);

    logger.info('Demo data seeding complete');
    logger.info(`Users: ${users.all.length}`);
    logger.info(`Courts: ${courts.length}`);
    logger.info(`Cases: ${cases.length}`);
    logger.info('Test credentials:');
    logger.info('victim@example.com / password123');
    logger.info('advocate@example.com / password123');
    logger.info('staff@example.com / password123');
    logger.info('admin@example.com / password123');

    await mongoose.disconnect();
  } catch (err) {
    logger.error({ err }, 'Seeding failed');
    await mongoose.disconnect();
    process.exit(1);
  }
}

if (require.main === module) {
  seedAll();
}

module.exports = { seedAll };
