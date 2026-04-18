/* eslint-disable no-console */
// ============================================================
// Migration: Legacy role 'victim' -> canonical role 'user'
// ============================================================
// Usage:
//   npm run migrate:roles            # execute migration
//   npm run migrate:roles -- --dry-run
// ============================================================

const { connectDB, closeDB, mongoose } = require('../config/database');
const User = require('../models/User');
const Event = require('../models/Event');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');

function nowIso() {
  return new Date().toISOString();
}

async function collectStats() {
  const [victimUsers, userUsers, eventsWithVictimRole] = await Promise.all([
    User.countDocuments({ role: 'victim' }),
    User.countDocuments({ role: 'user' }),
    Event.countDocuments({ rolesVisibleTo: 'victim' }),
  ]);

  return {
    victimUsers,
    userUsers,
    eventsWithVictimRole,
  };
}

async function run() {
  console.log(`[${nowIso()}] Starting role migration (${isDryRun ? 'dry-run' : 'execute'})`);

  const connected = await connectDB();
  if (!connected) {
    throw new Error('Database connection failed. Migration aborted.');
  }

  const before = await collectStats();
  console.log(`[${nowIso()}] Before:`, before);

  let userUpdateResult = { matchedCount: 0, modifiedCount: 0 };
  let eventUpdateResult = { matchedCount: 0, modifiedCount: 0 };

  if (!isDryRun) {
    // 1) Migrate user.role values
    userUpdateResult = await User.updateMany(
      { role: 'victim' },
      { $set: { role: 'user' } },
    );

    // 2) Normalize event visibility arrays:
    //    replace victim -> user and de-duplicate role array values.
    eventUpdateResult = await Event.updateMany(
      { rolesVisibleTo: 'victim' },
      [
        {
          $set: {
            rolesVisibleTo: {
              $setUnion: [
                {
                  $map: {
                    input: '$rolesVisibleTo',
                    as: 'role',
                    in: {
                      $cond: [
                        { $eq: ['$$role', 'victim'] },
                        'user',
                        '$$role',
                      ],
                    },
                  },
                },
                [],
              ],
            },
          },
        },
      ],
      { updatePipeline: true },
    );
  }

  const after = await collectStats();
  console.log(`[${nowIso()}] After:`, after);

  const migrationLog = {
    migrationKey: '2026-04-role-victim-to-user',
    ranAt: new Date(),
    mode: isDryRun ? 'dry-run' : 'execute',
    before,
    after,
    updates: {
      users: userUpdateResult,
      events: eventUpdateResult,
    },
  };

  if (!isDryRun) {
    await mongoose.connection.collection('migration_logs').insertOne(migrationLog);
  }

  console.log(`[${nowIso()}] Migration completed successfully.`);
  if (isDryRun) {
    console.log(`[${nowIso()}] Dry-run mode made no changes.`);
  }
}

run()
  .catch((err) => {
    console.error(`[${nowIso()}] Migration failed:`, err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closeDB();
    } catch (err) {
      console.error(`[${nowIso()}] Failed to close DB connection:`, err.message);
    }
  });
