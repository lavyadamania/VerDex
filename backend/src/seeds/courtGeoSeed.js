// ============================================================
// Court Geo Seed — Populate Indian courts with lat/lng coordinates
// ============================================================
// Seeds 15 real Indian courts with accurate GPS coordinates.
// Upserts into the existing Court collection (safe to re-run).
//
// Usage: node src/seeds/courtGeoSeed.js
// ============================================================
const { connectDB, closeDB } = require('../config/database');
const { connectRedis, disconnectRedis } = require('../config/redis');
const Court = require('../models/Court');
const { geoAddAllCourts } = require('../services/courtMapService');
const logger = require('../utils/logger');

// ── 15 Indian Courts with realistic coordinates ──
const COURT_GEO_DATA = [
  {
    court_name: 'Patiala House Court',
    court_type: 'district',
    district: 'New Delhi',
    state: 'Delhi',
    pin_code: '110001',
    lat: 28.6225,
    lng: 77.2340,
  },
  {
    court_name: 'Saket Court',
    court_type: 'district',
    district: 'South Delhi',
    state: 'Delhi',
    pin_code: '110017',
    lat: 28.5244,
    lng: 77.2066,
  },
  {
    court_name: 'Tis Hazari Court',
    court_type: 'district',
    district: 'Central Delhi',
    state: 'Delhi',
    pin_code: '110054',
    lat: 28.6612,
    lng: 77.2273,
  },
  {
    court_name: 'Karkardooma Court',
    court_type: 'district',
    district: 'East Delhi',
    state: 'Delhi',
    pin_code: '110032',
    lat: 28.6508,
    lng: 77.2972,
  },
  {
    court_name: 'Mumbai City Civil Court',
    court_type: 'sessions',
    district: 'Mumbai',
    state: 'Maharashtra',
    pin_code: '400032',
    lat: 18.9402,
    lng: 72.8355,
  },
  {
    court_name: 'Bangalore City Court',
    court_type: 'sessions',
    district: 'Bangalore Urban',
    state: 'Karnataka',
    pin_code: '560009',
    lat: 12.9767,
    lng: 77.5713,
  },
  {
    court_name: 'Chennai High Court',
    court_type: 'high_court',
    district: 'Chennai',
    state: 'Tamil Nadu',
    pin_code: '600104',
    lat: 13.0827,
    lng: 80.2867,
  },
  {
    court_name: 'Lucknow Bench',
    court_type: 'high_court',
    district: 'Lucknow',
    state: 'Uttar Pradesh',
    pin_code: '226001',
    lat: 26.8467,
    lng: 80.9462,
  },
  {
    court_name: 'Kolkata High Court',
    court_type: 'high_court',
    district: 'Kolkata',
    state: 'West Bengal',
    pin_code: '700001',
    lat: 22.5726,
    lng: 88.3639,
  },
  {
    court_name: 'Hyderabad City Civil Court',
    court_type: 'district',
    district: 'Hyderabad',
    state: 'Telangana',
    pin_code: '500002',
    lat: 17.3850,
    lng: 78.4867,
  },
  {
    court_name: 'Ahmedabad City Court',
    court_type: 'sessions',
    district: 'Ahmedabad',
    state: 'Gujarat',
    pin_code: '380001',
    lat: 23.0225,
    lng: 72.5714,
  },
  {
    court_name: 'Pune District Court',
    court_type: 'district',
    district: 'Pune',
    state: 'Maharashtra',
    pin_code: '411001',
    lat: 18.5204,
    lng: 73.8567,
  },
  {
    court_name: 'Jaipur City Court',
    court_type: 'district',
    district: 'Jaipur',
    state: 'Rajasthan',
    pin_code: '302001',
    lat: 26.9124,
    lng: 75.7873,
  },
  {
    court_name: 'Chandigarh District Court',
    court_type: 'district',
    district: 'Chandigarh',
    state: 'Chandigarh',
    pin_code: '160001',
    lat: 30.7333,
    lng: 76.7794,
  },
  {
    court_name: 'Patna High Court',
    court_type: 'high_court',
    district: 'Patna',
    state: 'Bihar',
    pin_code: '800001',
    lat: 25.6093,
    lng: 85.1376,
  },
];

// ============================================================
// Seed function — upserts court geo coordinates
// ============================================================
async function seedCourtGeo() {
  logger.info('═══════════════════════════════════════════════════');
  logger.info('  🗺️  Court Geo Seed — Starting...');
  logger.info('═══════════════════════════════════════════════════');

  const connected = await connectDB();
  if (!connected) {
    logger.error('Cannot connect to MongoDB. Aborting geo seed.');
    process.exit(1);
  }

  try {
    let upserted = 0;
    let updated = 0;

    for (const courtData of COURT_GEO_DATA) {
      // Upsert: match by court_name + district + state
      const result = await Court.findOneAndUpdate(
        {
          court_name: courtData.court_name,
          district: courtData.district,
          state: courtData.state,
        },
        {
          $set: {
            court_type: courtData.court_type,
            pin_code: courtData.pin_code,
            lat: courtData.lat,
            lng: courtData.lng,
          },
        },
        { upsert: true, new: true, runValidators: true }
      );

      if (result.createdAt && result.updatedAt &&
          result.createdAt.getTime() === result.updatedAt.getTime()) {
        upserted++;
        logger.info(`  📌 Created: ${courtData.court_name} (${courtData.district}, ${courtData.state}) → [${courtData.lat}, ${courtData.lng}]`);
      } else {
        updated++;
        logger.info(`  ✏️  Updated: ${courtData.court_name} → [${courtData.lat}, ${courtData.lng}]`);
      }
    }

    // ── Register in Redis geo index ──
    await connectRedis();
    const geoCount = await geoAddAllCourts();
    await disconnectRedis();

    logger.info('═══════════════════════════════════════════════════');
    logger.info('  📊 Geo Seed Summary:');
    logger.info(`     New courts:     ${upserted}`);
    logger.info(`     Updated courts: ${updated}`);
    logger.info(`     Total:          ${COURT_GEO_DATA.length}`);
    logger.info(`     Redis geo-indexed: ${geoCount}`);
    logger.info('═══════════════════════════════════════════════════');

  } catch (err) {
    logger.error({ err }, '❌ Geo seeding failed');
    process.exit(1);
  }

  await closeDB();
  logger.info('Geo seeding done! ✅');
  process.exit(0);
}

// Run if executed directly
if (require.main === module) {
  seedCourtGeo();
}

module.exports = { seedCourtGeo, COURT_GEO_DATA };
