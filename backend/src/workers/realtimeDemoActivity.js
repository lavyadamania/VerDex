// ============================================================
// Real-Time Demo Activity Worker
// ============================================================
// Simulates live system activity every 5-10 seconds by mutating
// random active cases and triggering real-time fanout.
// ============================================================
const Case = require('../models/Case');
const { syncCaseToRedis } = require('../utils/caseCache');
const { emitCaseEvent } = require('../services/eventService');
const { computeLeaderboard } = require('../services/leaderboardService');
const logger = require('../utils/logger');

const ACTIVE_STATUSES = ['filed', 'hearing', 'evidence', 'arguments', 'reserved'];
const STATUS_FLOW = ['filed', 'hearing', 'evidence', 'arguments', 'reserved', 'judgment'];

let timerHandle = null;
let running = false;

function getRandomDelayMs() {
    return 5000 + Math.floor(Math.random() * 5000);
}

function pickNextStatus(currentStatus) {
    const currentIndex = STATUS_FLOW.indexOf(currentStatus);
    if (currentIndex === -1) return 'hearing';
    if (currentIndex >= STATUS_FLOW.length - 1) return currentStatus;

    // 70% progress to next stage, 30% keep current for realism.
    return Math.random() < 0.7 ? STATUS_FLOW[currentIndex + 1] : currentStatus;
}

async function mutateRandomCase() {
    if (running) return;
    running = true;

    try {
        const sample = await Case.aggregate([
            { $match: { current_status: { $in: ACTIVE_STATUSES } } },
            { $sample: { size: 1 } },
        ]);

        const picked = sample[0];
        if (!picked?._id) return;

        const caseDoc = await Case.findById(picked._id);
        if (!caseDoc) return;

        const oldStatus = caseDoc.current_status;
        const newStatus = pickNextStatus(oldStatus);
        const oldRisk = caseDoc.delay_risk_score || 0;

        caseDoc.current_status = newStatus;
        caseDoc.adjournment_count = Math.max(0, (caseDoc.adjournment_count || 0) + (Math.random() < 0.6 ? 1 : 0));
        caseDoc.delay_risk_score = Math.min(10, Math.max(0, oldRisk + (Math.random() < 0.5 ? 0.4 : -0.2)));
        caseDoc.stagnation_flag = caseDoc.delay_risk_score >= 9;
        caseDoc.last_update = new Date();
        await caseDoc.save();

        await syncCaseToRedis(caseDoc);

        await emitCaseEvent({
            caseId: caseDoc._id,
            type: caseDoc.delay_risk_score >= 6 ? 'DELAY_ALERT' : 'STATUS_UPDATE',
            message: `Demo update: ${caseDoc.cnr_number} moved to ${newStatus} (risk ${caseDoc.delay_risk_score.toFixed(1)})`,
            metadata: {
                caseNumber: caseDoc.cnr_number,
                oldValue: oldStatus,
                newValue: newStatus,
                adjournmentCount: caseDoc.adjournment_count,
                delayRiskScore: caseDoc.delay_risk_score,
            },
            rolesVisibleTo: ['visitor', 'victim', 'advocate', 'court_staff', 'admin'],
            usersVisibleTo: caseDoc.victim_user ? [caseDoc.victim_user] : [],
        });

        // Keep leaderboard visibly moving in demo mode.
        await computeLeaderboard();

        logger.info(`⚡ Demo realtime update emitted for case ${caseDoc.cnr_number}`);
    } catch (err) {
        logger.error({ err }, 'Realtime demo activity failed');
    } finally {
        running = false;
    }
}

function loop() {
    timerHandle = setTimeout(async () => {
        await mutateRandomCase();
        loop();
    }, getRandomDelayMs());
}

async function startRealtimeDemoActivity() {
    if (timerHandle) return;
    logger.info('⚡ Realtime demo worker started (5-10s random updates)');
    loop();
}

async function stopRealtimeDemoActivity() {
    if (timerHandle) {
        clearTimeout(timerHandle);
        timerHandle = null;
    }
}

module.exports = {
    startRealtimeDemoActivity,
    stopRealtimeDemoActivity,
};
