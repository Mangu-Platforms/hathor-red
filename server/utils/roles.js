/**
 * Role lookup helpers. The JWT deliberately carries only { userId, username },
 * so role checks read the DB row — revoking a role takes effect immediately
 * rather than at token expiry.
 */

const db = require('../config/database');

async function getUserRole(userId) {
  const result = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
  return result.rows.length > 0 ? result.rows[0].role : null;
}

async function isAdmin(userId) {
  return (await getUserRole(userId)) === 'admin';
}

module.exports = { getUserRole, isAdmin };
