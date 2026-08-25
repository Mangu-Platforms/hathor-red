const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const db = require('../config/database');
const { logger } = require('../utils/logger');
const auditService = require('../services/privacy/auditService');
const exportService = require('../services/privacy/exportService');

/** POST /api/privacy/export — queue a GDPR export (72h SLA). */
const requestExport = async (req, res) => {
  try {
    const request = await exportService.requestExport(req.user.userId);
    await auditService.record({
      userId: req.user.userId,
      action: 'gdpr_export_requested',
      targetType: 'data_export_request',
      targetId: request.id,
      ip: req.ip,
    });
    res.status(202).json({
      message: 'Export queued. You will be able to download it from this endpoint when ready (within 72 hours).',
      request: { id: request.id, status: request.status, createdAt: request.created_at },
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    logger.error('Request export error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/** GET /api/privacy/export — latest export status (+ download URL when ready). */
const exportStatus = async (req, res) => {
  try {
    const latest = await exportService.latestExport(req.user.userId);
    if (!latest) return res.json({ export: null });

    res.json({
      export: {
        id: latest.id,
        status: latest.status,
        createdAt: latest.created_at,
        completedAt: latest.completed_at,
        expiresAt: latest.expires_at,
        error: latest.error,
        downloadUrl: latest.status === 'ready' ? `/api/privacy/export/download/${latest.download_token}` : null,
      },
    });
  } catch (error) {
    logger.error('Export status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/** GET /api/privacy/export/download/:token — serve the JSON artifact. */
const downloadExport = async (req, res) => {
  try {
    const request = await exportService.resolveDownload(req.params.token);
    if (!request) {
      return res.status(410).json({ error: 'Export link invalid or expired' });
    }

    const filePath = path.resolve(request.file_path);
    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      return res.status(404).json({ error: 'Export artifact missing — request a fresh export' });
    }

    await auditService.record({
      userId: request.user_id,
      action: 'gdpr_export_downloaded',
      targetType: 'data_export_request',
      targetId: request.id,
      ip: req.ip,
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename="mangu-data-export-${request.user_id}.json"`);
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
      else res.destroy();
    });
    stream.pipe(res);
  } catch (error) {
    logger.error('Download export error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
};

/** POST /api/privacy/deletion-request — start account deletion (GDPR erasure). */
const requestDeletion = async (req, res) => {
  try {
    const inserted = await db.query(
      `INSERT INTO deletion_requests (user_id, reason)
       VALUES ($1, $2)
       ON CONFLICT (user_id) WHERE status = 'pending'
       DO NOTHING
       RETURNING *`,
      [req.user.userId, req.body.reason || null]
    );
    if (inserted.rows.length === 0) {
      return res.status(409).json({ error: 'A deletion request is already pending' });
    }

    await auditService.record({
      userId: req.user.userId,
      action: 'account_deletion_requested',
      targetType: 'deletion_request',
      targetId: inserted.rows[0].id,
      ip: req.ip,
    });

    res.status(202).json({
      message: 'Deletion request recorded. Processing follows the platform retention policy; financial records are retained as legally required.',
      request: { id: inserted.rows[0].id, status: 'pending' },
    });
  } catch (error) {
    logger.error('Request deletion error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/** DELETE /api/privacy/deletion-request — cancel a pending request. */
const cancelDeletion = async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE deletion_requests SET status = 'canceled', resolved_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND status = 'pending'
       RETURNING id`,
      [req.user.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No pending deletion request' });
    }

    await auditService.record({
      userId: req.user.userId,
      action: 'account_deletion_canceled',
      targetType: 'deletion_request',
      targetId: result.rows[0].id,
      ip: req.ip,
    });
    res.json({ message: 'Deletion request canceled' });
  } catch (error) {
    logger.error('Cancel deletion error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/** GET /api/privacy/audit — the caller's own audit trail. */
const myAuditTrail = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const entries = await auditService.forUser(req.user.userId, { limit });
    res.json({ entries });
  } catch (error) {
    logger.error('Audit trail error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  requestExport,
  exportStatus,
  downloadExport,
  requestDeletion,
  cancelDeletion,
  myAuditTrail,
};
