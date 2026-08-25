/**
 * Audit trail for sensitive actions (Olympus M6).
 *
 * record() never throws by default: an audit outage must not take down the
 * action it observes (availability doctrine). Set AUDIT_STRICT=true to invert
 * that for regulated deployments where an unauditable action must fail.
 */

const db = require('../../config/database');
const { logger } = require('../../utils/logger');

async function record({ userId = null, action, targetType = null, targetId = null, detail = {}, ip = null }) {
  try {
    await db.query(
      `INSERT INTO audit_log (user_id, action, target_type, target_id, detail, ip)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, action, targetType, targetId, JSON.stringify(detail || {}), ip]
    );
    return true;
  } catch (err) {
    if (String(process.env.AUDIT_STRICT).toLowerCase() === 'true') throw err;
    logger.warn(`Audit write failed (action continued): ${action} — ${err.message}`);
    return false;
  }
}

/** The caller's own audit trail (transparency requirement). */
async function forUser(userId, { limit = 100 } = {}) {
  const result = await db.query(
    `SELECT action, target_type, target_id, detail, ip, created_at
     FROM audit_log WHERE user_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [userId, Math.min(limit, 500)]
  );
  return result.rows;
}

module.exports = { record, forUser };
