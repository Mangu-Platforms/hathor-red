const express = require('express');
const router = express.Router();
const privacyController = require('../controllers/privacyController');
const authMiddleware = require('../middleware/auth');
const {
  validate,
  exportRequestValidation,
  exportDownloadValidation,
  deletionRequestValidation,
} = require('../middleware/validation');

router.post('/export', authMiddleware, exportRequestValidation, validate, privacyController.requestExport);
router.get('/export', authMiddleware, privacyController.exportStatus);
// The 64-hex token is the credential (GDPR "secure download link").
router.get('/export/download/:token', exportDownloadValidation, validate, privacyController.downloadExport);
router.post('/deletion-request', authMiddleware, deletionRequestValidation, validate, privacyController.requestDeletion);
router.delete('/deletion-request', authMiddleware, privacyController.cancelDeletion);
router.get('/audit', authMiddleware, privacyController.myAuditTrail);

module.exports = router;
