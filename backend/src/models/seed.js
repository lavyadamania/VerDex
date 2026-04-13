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

function createRng(seed = 42) {
  let value = seed >>> 0;
  return () => {
    value = (1664525 * value + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function pickRandom(rng, items) {
  return items[Math.floor(rng() * items.length)];
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildCaseNumber(caseType, year, sequence) {
  const prefixes = {
    murder: 'MR/302',
    fraud: 'FR/420',
    cybercrime: 'CY/066',
    theft: 'TH/379',
    kidnapping: 'KD/363',
    domestic_violence: 'DV/498A',
    dowry: 'DW/304B',
    sexual_assault: 'SA/376',
    other: 'OT/999',
  };

  return `${prefixes[caseType] || prefixes.other}/${year}/${String(sequence).padStart(4, '0')}`;
}

function buildCnrNumber(courtCode, index, year) {
  return `${courtCode}-${String(index + 1).padStart(6, '0')}-${year}`;
}

function buildCaseTitle(caseType, accusedName, city) {
  const titles = {
    murder: `State vs ${accusedName} (IPC 302)`,
    fraud: `State vs ${accusedName} (Financial Fraud)`,
    cybercrime: `Cybercrime Complaint against ${accusedName}`,
    theft: `Theft Matter involving ${accusedName}`,
    kidnapping: `Kidnapping Case vs ${accusedName}`,
    domestic_violence: `Protection Order Matter - ${city}`,
    dowry: `Dowry Harassment Case vs ${accusedName}`,
    sexual_assault: `Sensitive Protection Matter - ${city}`,
    other: `${caseType.replace(/_/g, ' ')} matter - ${city}`,
  };

  return titles[caseType] || titles.other;
}

function chooseStatus(rng, caseIndex) {
  const roll = rng();
  if (roll < 0.72) {
    const ongoing = ['filed', 'hearing', 'evidence', 'arguments', 'reserved'];
    return ongoing[(caseIndex + Math.floor(roll * ongoing.length)) % ongoing.length];
  }
  if (roll < 0.9) {
    return roll < 0.8 ? 'judgment' : 'disposed';
  }
  return 'appealed';
}

function buildFilingDate(rng, caseIndex) {
  const year = 2020 + Math.floor(rng() * 6);
  const month = Math.floor(rng() * 12);
  const day = 1 + Math.floor(rng() * 27);
  const filingDate = new Date(Date.UTC(year, month, day));

  // Spread the dataset over realistic timelines.
  filingDate.setUTCDate(filingDate.getUTCDate() - (caseIndex % 90));
  return filingDate;
}

function buildNextHearingDate(status, filingDate, rng) {
  if (['judgment', 'disposed'].includes(status)) {
    return null;
  }

  const hearingOffsetDays = status === 'appealed'
    ? 45 + Math.floor(rng() * 210)
    : 7 + Math.floor(rng() * 120);

  const date = new Date(filingDate);
  date.setUTCDate(date.getUTCDate() + hearingOffsetDays);
  return date;
}

function buildHearingCount(status, rng) {
  const base = {
    filed: 1,
    hearing: 3,
    evidence: 5,
    arguments: 7,
    reserved: 9,
    judgment: 12,
    disposed: 14,
    appealed: 16,
  }[status] || 1;

  return base + Math.floor(rng() * 12);
}

function buildAdjournmentCount(status, hearingCount, rng) {
  const maxAdjournments = Math.max(0, hearingCount - 1);
  const drift = status === 'appealed' ? 4 : status === 'reserved' ? 3 : 2;
  return clampNumber(Math.floor(rng() * (maxAdjournments + drift)), 0, maxAdjournments);
}

function buildDelayRiskScore(status, hearingCount, adjournmentCount, rng) {
  const statusWeight = {
    filed: 1.2,
    hearing: 2.4,
    evidence: 3.3,
    arguments: 4.1,
    reserved: 4.9,
    judgment: 2.2,
    disposed: 1.0,
    appealed: 6.0,
  }[status] || 1.0;

  const score = statusWeight + (adjournmentCount * 0.28) + (hearingCount * 0.06) + (rng() * 1.3);
  return Number(clampNumber(score, 0, 10).toFixed(1));
}

function buildVictimId(index) {
  return `VIC-${String(1000 + index).padStart(4, '0')}`;
}

function buildAccusedId(index) {
  return `ACC-${String(7000 + index).padStart(4, '0')}`;
}

function buildJudgeId(index) {
  return `JDG-${String(5000 + index).padStart(4, '0')}`;
}

async function seed() {
  logger.info('[SEED] Seeding MongoDB...');

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
    logger.info('[CLEAN] Cleared existing data');

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
      { court_name: 'Supreme Court of India', court_type: 'supreme', district: 'New Delhi', state: 'Delhi', pin_code: '110201' },
    ]);
    logger.info(`[SUCCESS] Seeded ${courts.length} courts`);

    // ── Seed Users ──
    const adminHash = await bcrypt.hash('admin123', 12);
    const victimHash = await bcrypt.hash('victim123', 12);
    const visitorHash = await bcrypt.hash('visitor123', 12);
    const staffHash = await bcrypt.hash('staff123', 12);
    const advocateHash = await bcrypt.hash('advocate123', 12);

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

    const victim2 = await User.create({
      email: 'victim2@test.com',
      password_hash: victimHash,
      full_name: 'Second Victim User',
      phone: '+91-8888888881',
      role: 'victim',
      verification_status: 'document_verified',
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

    const judge1 = await User.create({
      email: 'judge.mehra@courtsystem.in',
      password_hash: staffHash,
      full_name: 'Hon. Justice R. K. Mehra',
      phone: '+91-7777777701',
      role: 'court_staff',
      verification_status: 'fully_verified',
    });

    const judge2 = await User.create({
      email: 'judge.nair@courtsystem.in',
      password_hash: staffHash,
      full_name: 'Hon. Justice S. Nair',
      phone: '+91-7777777702',
      role: 'court_staff',
      verification_status: 'fully_verified',
    });

    const advocate = await User.create({
      email: 'advocate@courtsystem.in',
      password_hash: advocateHash,
      full_name: 'Adv. Priya Khanna',
      phone: '+91-7666666666',
      role: 'advocate',
      verification_status: 'fully_verified',
      advocate_name: 'Adv. Priya Khanna',
      bar_council_id: 'BCI-DL-22019',
      advocate_phone: '+91-7666666666',
      advocate_email: 'advocate@courtsystem.in',
      advocate_confirmed: true,
      advocate_confirmed_at: new Date(),
    });
    logger.info('[SUCCESS] Seeded 8 users (admin + 2 victims + visitor + 3 court_staff + advocate)');

    const victimProfiles = [
      { user: victim, victim_id: buildVictimId(1) },
      { user: victim2, victim_id: buildVictimId(2) },
    ];

    for (let i = 3; i <= 25; i += 1) {
      const profile = await User.create({
        email: `victim${i}@courtsystem.in`,
        password_hash: victimHash,
        full_name: `Victim User ${i}`,
        phone: `+91-88888${String(i).padStart(4, '0')}`,
        role: 'victim',
        verification_status: i % 2 === 0 ? 'document_verified' : 'otp_verified',
      });

      victimProfiles.push({ user: profile, victim_id: buildVictimId(i) });
    }

    const judgeProfiles = [
      { name: judge1.full_name, judge_id: buildJudgeId(1) },
      { name: judge2.full_name, judge_id: buildJudgeId(2) },
      { name: 'Hon. Justice A. K. Sharma', judge_id: buildJudgeId(3) },
      { name: 'Hon. Justice B. L. Mehta', judge_id: buildJudgeId(4) },
      { name: 'Hon. Justice C. D. Patel', judge_id: buildJudgeId(5) },
      { name: 'Hon. Justice E. F. Rao', judge_id: buildJudgeId(6) },
      { name: 'Hon. Justice G. H. Singh', judge_id: buildJudgeId(7) },
      { name: 'Hon. Justice N. Verma', judge_id: buildJudgeId(8) },
    ];

    const caseTypeCatalog = ['murder', 'fraud', 'cybercrime', 'theft', 'kidnapping', 'domestic_violence', 'dowry', 'sexual_assault', 'other'];
    const courtCodes = ['DLND01', 'DLSD02', 'DLCD03', 'DLED04', 'MHMU01', 'KABB01', 'TNCH01', 'UPLK01', 'DLSC01'];
    const rng = createRng(20260413);

    const generatedCases = [];
    for (let index = 0; index < 1000; index += 1) {
      const court = courts[index % courts.length];
      const victimProfile = victimProfiles[index % victimProfiles.length];
      const judgeProfile = judgeProfiles[index % judgeProfiles.length];
      const caseType = pickRandom(rng, caseTypeCatalog);
      const status = chooseStatus(rng, index);
      const filingDate = buildFilingDate(rng, index);
      const hearingCount = buildHearingCount(status, rng);
      const adjournmentCount = buildAdjournmentCount(status, hearingCount, rng);
      const nextHearingDate = buildNextHearingDate(status, filingDate, rng);
      const accusedId = buildAccusedId(index + 1);
      const accusedName = `${pickRandom(rng, ['Rohan', 'Ramesh', 'Rahul', 'Nilesh', 'Arvind', 'Karan', 'Suraj', 'Aman', 'Vikas', 'Pradeep'])} ${pickRandom(rng, ['Sharma', 'Verma', 'Kumar', 'Rao', 'Yadav', 'Bedi', 'Patel', 'Nair', 'Singh', 'Malhotra'])}`;
      const city = court.district;
      const filingYear = filingDate.getUTCFullYear();
      const caseNumber = buildCaseNumber(caseType, filingYear, index + 1);
      const cnrNumber = buildCnrNumber(courtCodes[index % courtCodes.length], index, filingYear);
      const statusLabel = status === 'appealed' ? 'Appeal' : ['judgment', 'disposed'].includes(status) ? 'Closed' : 'Ongoing';
      const caseTitle = buildCaseTitle(caseType, accusedName, city);

      generatedCases.push({
        cnr_number: cnrNumber,
        case_number: caseNumber,
        case_type: caseType,
        case_title: caseTitle,
        court: court._id,
        victim_user: victimProfile.user._id,
        victim_id: victimProfile.victim_id,
        filing_date: filingDate,
        current_status: status,
        next_hearing_date: nextHearingDate,
        adjournment_count: adjournmentCount,
        total_hearings: hearingCount,
        accused_id: accusedId,
        judge_id: judgeProfile.judge_id,
        accused_name: accusedName,
        judge_name: judgeProfile.name,
        delay_risk_score: buildDelayRiskScore(status, hearingCount, adjournmentCount, rng),
        stagnation_flag: ['appealed', 'reserved'].includes(status) && adjournmentCount >= 8,
        advocate_name: advocate.full_name,
        advocate_contact: advocate.phone,
        disclosure_mode: statusLabel === 'Ongoing' ? 'partial' : 'full',
        disclosed_fields: statusLabel === 'Appeal' ? ['judge_name', 'timeline'] : ['judge_name'],
      });
    }

    const cases = await Case.insertMany(generatedCases, { ordered: false });
    logger.info(`[SUCCESS] Seeded ${cases.length} cases`);

    // ── Seed Case Events ──
    const events = await CaseEvent.insertMany([
      { case: cases[0]._id, event_type: 'filing', event_date: cases[0].filing_date, event_description: `Case filed: ${cases[0].case_title}`, is_public: true, created_by: victim._id },
      { case: cases[0]._id, event_type: 'hearing', event_date: new Date(cases[0].filing_date.getTime() + 30 * 24 * 60 * 60 * 1000), event_description: 'First hearing. Charges framed.', is_public: true },
      { case: cases[1]._id, event_type: 'filing', event_date: cases[1].filing_date, event_description: `Case filed: ${cases[1].case_title}`, is_public: true, created_by: victim2._id },
      { case: cases[2]._id, event_type: 'filing', event_date: cases[2].filing_date, event_description: `Case filed: ${cases[2].case_title}`, is_public: true, created_by: victimProfiles[2].user._id },
      { case: cases[3]._id, event_type: 'hearing', event_date: new Date(cases[3].filing_date.getTime() + 60 * 24 * 60 * 60 * 1000), event_description: 'Evidence recorded and matter adjourned.', is_public: true },
      { case: cases[4]._id, event_type: 'adjournment', event_date: new Date(cases[4].filing_date.getTime() + 90 * 24 * 60 * 60 * 1000), event_description: 'Adjourned due to witness unavailability.', adjournment_reason: 'Witness unavailable', is_public: true },
      { case: cases[5]._id, event_type: 'filing', event_date: cases[5].filing_date, event_description: `Case filed: ${cases[5].case_title}`, is_public: true, created_by: victimProfiles[5].user._id },
      { case: cases[6]._id, event_type: 'hearing', event_date: new Date(cases[6].filing_date.getTime() + 45 * 24 * 60 * 60 * 1000), event_description: 'Charge sheet filed by prosecution.', is_public: true },
      { case: cases[7]._id, event_type: 'order', event_date: new Date(cases[7].filing_date.getTime() + 120 * 24 * 60 * 60 * 1000), event_description: 'Interim order passed by the court.', is_public: true },
      { case: cases[8]._id, event_type: 'filing', event_date: cases[8].filing_date, event_description: `Case filed: ${cases[8].case_title}`, is_public: true, created_by: victimProfiles[8].user._id },
      { case: cases[9]._id, event_type: 'hearing', event_date: new Date(cases[9].filing_date.getTime() + 75 * 24 * 60 * 60 * 1000), event_description: 'Arguments heard and reserved for judgment.', is_public: true },
    ]);
    logger.info(`[SUCCESS] Seeded ${events.length} case events`);

    // ── Update court case counts ──
    for (const court of courts) {
      const filed = await Case.countDocuments({ court: court._id });
      const resolved = await Case.countDocuments({ court: court._id, current_status: { $in: ['disposed', 'judgment'] } });
      await Court.findByIdAndUpdate(court._id, { total_cases_filed: filed, total_cases_resolved: resolved });
    }
    logger.info('[SUCCESS] Updated court case counts');

    // ── Summary ──
    logger.info('---------------------------------------------------');
    logger.info('  [SUMMARY] Seed Summary:');
    logger.info(`     Courts: ${courts.length}`);
    logger.info(`     Users: ${2 + victimProfiles.length + 1 + 4 + 1} (admin + victims + visitor + staff + advocate)`);
    logger.info(`     Cases: ${cases.length}`);
    logger.info(`     Events: ${events.length}`);
    logger.info('  Email Admin:   admin@courtsystem.in / admin123');
    logger.info('  Email Victim:  victim@test.com / victim123');
    logger.info('  Email Victim2: victim2@test.com / victim123');
    logger.info('  Visitor: visitor@test.com / visitor123');
    logger.info('  Staff:   staff@courtsystem.in / staff123');
    logger.info('  Advocate: advocate@courtsystem.in / advocate123');
    logger.info('---------------------------------------------------');

    // ── Sync all seeded data to Redis ──
    await connectRedis();
    await bulkSyncAllCasesToRedis();
    await disconnectRedis();

  } catch (err) {
    logger.error({ err }, '[ERROR] Seeding failed');
    process.exit(1);
  }

  await closeDB();
  logger.info('Seeding done! [SUCCESS]');
  process.exit(0);
}

seed();
