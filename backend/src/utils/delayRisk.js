// ============================================================
// Delay Risk Calculator — Court Map Heatmap Layer
// ============================================================
// Computes delay risk level for a court based on JSI score and
// stagnation metrics. Used by the leaderboard refresh worker
// and the /api/courts/map endpoint.
//
// Risk Levels:
//   LOW      — JSI >= 70
//   MEDIUM   — JSI >= 45
//   HIGH     — JSI >= 25  (or stagnation_count > 50)
//   CRITICAL — JSI <  25
// ============================================================

/**
 * Compute the delay risk level for a court.
 *
 * @param {Object} court — Court metrics object
 * @param {number} court.jsi_score — Justice Speed Index (0-100, higher = better)
 * @param {number} [court.stagnation_count=0] — Number of stagnant/stuck cases
 * @returns {'LOW'|'MEDIUM'|'HIGH'|'CRITICAL'} Delay risk category
 */
function computeDelayRisk(court) {
  const jsi = parseFloat(court.jsi_score) || 0;
  const stagnation = parseInt(court.stagnation_count, 10) || 0;

  let risk;

  if (jsi >= 70) {
    risk = 'LOW';
  } else if (jsi >= 45) {
    risk = 'MEDIUM';
  } else if (jsi >= 25) {
    risk = 'HIGH';
  } else {
    risk = 'CRITICAL';
  }

  // Override: if stagnation_count > 50, force minimum HIGH
  if (stagnation > 50 && (risk === 'LOW' || risk === 'MEDIUM')) {
    risk = 'HIGH';
  }

  return risk;
}

/**
 * Get a numeric severity weight for sorting/coloring (0-3).
 *
 * @param {'LOW'|'MEDIUM'|'HIGH'|'CRITICAL'} risk
 * @returns {number}
 */
function riskSeverity(risk) {
  const map = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
  return map[risk] ?? 0;
}

/**
 * Get the hex color associated with a risk level (for frontend markers).
 *
 * @param {'LOW'|'MEDIUM'|'HIGH'|'CRITICAL'} risk
 * @returns {string} Hex color code
 */
function riskColor(risk) {
  const map = {
    LOW: '#22c55e',      // green
    MEDIUM: '#f59e0b',   // amber
    HIGH: '#ef4444',     // red
    CRITICAL: '#7f1d1d', // dark red
  };
  return map[risk] || '#6b7280';
}

module.exports = {
  computeDelayRisk,
  riskSeverity,
  riskColor,
};
