// ============================================================
// MongoDB Seed Script
// ============================================================
// Seeds sample data: courts, users, cases, case events.
// Usage: node src/models/seed.js
// ============================================================
const bcrypt = require('bcryptjs');
const { connectDB, closeDB } = require('../config/database');
const { connectRedis, disconnectRedis } = require('../config/redis');
const { Court, User, Case, CaseEvent } = require('./index');
const { bulkSyncAllCasesToRedis } = require('../utils/caseCache');
const logger = require('../utils/logger');

async function seed() {
  logger.info('🌱 Seeding MongoDB...');

  const connected = await connectDB();
  if (!connected) {
    logger.error('Cannot connect to MongoDB. Aborting seed.');
    process.exit(1);
  }

  try {
    // ── Clear existing data ──
    await Court.deleteMany({});
    await User.deleteMany({});
    await Case.deleteMany({});
    await CaseEvent.deleteMany({});
    logger.info('🧹 Cleared existing data');

    // ── Seed Courts ──
    const courts = await Court.insertMany([
      { court_name: 'Patiala House Court', court_type: 'district', district: 'New Delhi', state: 'Delhi', pin_code: '110001' },
      { court_name: 'Saket Court', court_type: 'district', district: 'South Delhi', state: 'Delhi', pin_code: '110017' },
      { court_name: 'Tis Hazari Court', court_type: 'district', district: 'Central Delhi', state: 'Delhi', pin_code: '110054' },
      { court_name: 'Karkardooma Court', court_type: 'district', district: 'East Delhi', state: 'Delhi', pin_code: '110032' },
      { court_name: 'Mumbai City Civil Court', court_type: 'sessions', district: 'Mumbai', state: 'Maharashtra', pin_code: '400032' },
      { court_name: 'Bangalore City Court', court_type: 'sessions', district: 'Bangalore Urban', state: 'Karnataka', pin_code: '560009' },
      { court_name: 'Chennai High Court', court_type: 'high_court', district: 'Chennai', state: 'Tamil Nadu', pin_code: '600104' },
      { court_name: 'Lucknow Bench', court_type: 'high_court', district: 'Lucknow', state: 'Uttar Pradesh', pin_code: '226001' },
    ]);
    logger.info(`✅ Seeded ${courts.length} courts`);

    // ── Seed Users ──
    const adminHash = await bcrypt.hash('admin123', 12);
    const victimHash = await bcrypt.hash('victim123', 12);
    const visitorHash = await bcrypt.hash('visitor123', 12);
    const staffHash = await bcrypt.hash('staff123', 12);

    const admin = await User.create({
      email: 'admin@courtsystem.in',
      password_hash: adminHash,
      full_name: 'System Administrator',
      phone: '+91-9999999999',
      role: 'admin',
      verification_status: 'fully_verified',
    });

    const victim = await User.create({
      email: 'victim@test.com',
      password_hash: victimHash,
      full_name: 'Test Victim User',
      phone: '+91-8888888888',
      role: 'victim',
      verification_status: 'otp_verified',
    });

    const visitor = await User.create({
      email: 'visitor@test.com',
      password_hash: visitorHash,
      full_name: 'Public Visitor',
      role: 'visitor',
      verification_status: 'unverified',
    });

    const staff = await User.create({
      email: 'staff@courtsystem.in',
      password_hash: staffHash,
      full_name: 'Court Staff Member',
      phone: '+91-7777777777',
      role: 'court_staff',
      verification_status: 'fully_verified',
    });
    logger.info('✅ Seeded 4 users (admin + victim + visitor + court_staff)');

    // ── Seed Cases ──
    const cases = await Case.insertMany([
      {
        cnr_number: 'DLND01-000001-2024',
        case_type: 'sexual_assault',
        case_title: 'State vs Unknown (POCSO)',
        court: courts[0]._id,
        victim_user: victim._id,
        filing_date: new Date('2024-01-15'),
        current_status: 'hearing',
        next_hearing_date: new Date('2026-04-10'),
        adjournment_count: 8,
        total_hearings: 12,
        accused_name: 'John Doe',
        judge_name: 'Hon. Justice A.K. Sharma',
        delay_risk_score: 6.5,
        advocate_name: 'Adv. Priya Singh',
      },
      {
        cnr_number: 'DLSD02-000045-2024',
        case_type: 'domestic_violence',
        case_title: 'Protection Order Application',
        court: courts[1]._id,
        victim_user: victim._id,
        filing_date: new Date('2024-06-20'),
        current_status: 'evidence',
        next_hearing_date: new Date('2026-04-15'),
        adjournment_count: 3,
        total_hearings: 5,
        accused_name: 'Ramesh Kumar',
        judge_name: 'Hon. Justice B.L. Mehta',
        delay_risk_score: 3.2,
      },
      {
        cnr_number: 'MHMU01-000102-2023',
        case_type: 'sexual_assault',
        case_title: 'State vs Accused (IPC 376)',
        court: courts[4]._id,
        filing_date: new Date('2023-03-10'),
        current_status: 'arguments',
        next_hearing_date: new Date('2026-05-01'),
        adjournment_count: 15,
        total_hearings: 22,
        accused_name: 'Rahul Verma',
        judge_name: 'Hon. Justice C.D. Patel',
        delay_risk_score: 8.7,
        stagnation_flag: true,
      },
      {
        cnr_number: 'KABB01-000078-2025',
        case_type: 'cybercrime',
        case_title: 'Online Harassment Case',
        court: courts[5]._id,
        filing_date: new Date('2025-01-05'),
        current_status: 'filed',
        next_hearing_date: new Date('2026-04-20'),
        adjournment_count: 1,
        total_hearings: 2,
        accused_name: 'Unknown',
        judge_name: 'Hon. Justice E.F. Rao',
        delay_risk_score: 1.5,
      },
      {
        cnr_number: 'DLCD03-000200-2022',
        case_type: 'murder',
        case_title: 'State vs Accused (IPC 302)',
        court: courts[2]._id,
        filing_date: new Date('2022-08-14'),
        current_status: 'reserved',
        adjournment_count: 20,
        total_hearings: 35,
        accused_name: 'Suspect X',
        judge_name: 'Hon. Justice G.H. Singh',
        delay_risk_score: 9.2,
        stagnation_flag: true,
      },
    ]);
    logger.info(`✅ Seeded ${cases.length} cases`);

    // ── Seed Case Events ──
    const events = await CaseEvent.insertMany([
      { case: cases[0]._id, event_type: 'filing', event_date: new Date('2024-01-15'), event_description: 'FIR filed and case registered under POCSO Act', is_public: true, created_by: victim._id },
      { case: cases[0]._id, event_type: 'hearing', event_date: new Date('2024-03-10'), event_description: 'First hearing. Charges framed.', is_public: true },
      { case: cases[0]._id, event_type: 'adjournment', event_date: new Date('2024-05-20'), event_description: 'Adjourned due to absence of witness', adjournment_reason: 'Witness unavailable', is_public: true },
      { case: cases[0]._id, event_type: 'hearing', event_date: new Date('2024-08-15'), event_description: 'Prosecution evidence recorded', is_public: true },
      { case: cases[0]._id, event_type: 'adjournment', event_date: new Date('2024-11-10'), event_description: 'Adjourned. Judge on leave.', adjournment_reason: 'Judge unavailability', is_public: true },
      { case: cases[0]._id, event_type: 'hearing', event_date: new Date('2025-02-20'), event_description: 'Cross-examination of witness 1', is_public: true },
      { case: cases[2]._id, event_type: 'filing', event_date: new Date('2023-03-10'), event_description: 'Case filed under IPC 376', is_public: true },
      { case: cases[2]._id, event_type: 'adjournment', event_date: new Date('2023-06-15'), event_description: 'Adjourned. Incomplete investigation.', adjournment_reason: 'Pending investigation', is_public: true },
      { case: cases[4]._id, event_type: 'filing', event_date: new Date('2022-08-14'), event_description: 'Murder case registered under IPC 302', is_public: true },
      { case: cases[4]._id, event_type: 'hearing', event_date: new Date('2022-11-20'), event_description: 'Charge sheet filed by prosecution', is_public: true },
    ]);
    logger.info(`✅ Seeded ${events.length} case events`);

    // ── Update court case counts ──
    for (const court of courts) {
      const filed = await Case.countDocuments({ court: court._id });
      const resolved = await Case.countDocuments({ court: court._id, current_status: 'disposed' });
      await Court.findByIdAndUpdate(court._id, { total_cases_filed: filed, total_cases_resolved: resolved });
    }
    logger.info('✅ Updated court case counts');

    // ── Summary ──
    logger.info('═══════════════════════════════════════════════════');
    logger.info('  📊 Seed Summary:');
    logger.info(`     Courts: ${courts.length}`);
    logger.info(`     Users: 4 (admin + victim + visitor + court_staff)`);
    logger.info(`     Cases: ${cases.length}`);
    logger.info(`     Events: ${events.length}`);
    logger.info('  📧 Admin:   admin@courtsystem.in / admin123');
    logger.info('  📧 Victim:  victim@test.com / victim123');
    logger.info('  👁️  Visitor: visitor@test.com / visitor123');
    logger.info('  📋 Staff:   staff@courtsystem.in / staff123');
    logger.info('═══════════════════════════════════════════════════');

    // ── Sync all seeded data to Redis ──
    await connectRedis();
    await bulkSyncAllCasesToRedis();
    await disconnectRedis();

  } catch (err) {
    logger.error({ err }, '❌ Seeding failed');
    process.exit(1);
  }

  await closeDB();
  logger.info('Seeding done! ✅');
  process.exit(0);
}

seed();
