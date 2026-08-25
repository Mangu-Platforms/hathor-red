const express = require('express');
const router = express.Router();
const discoveryController = require('../controllers/discoveryController');
const authMiddleware = require('../middleware/auth');
const { validate, idParamValidation, discoverySearchValidation, reindexValidation } = require('../middleware/validation');

router.get('/search', authMiddleware, discoverySearchValidation, validate, discoveryController.search);
router.get('/radar', authMiddleware, discoveryController.getRadar);
router.get('/similar/:id', authMiddleware, idParamValidation, validate, discoveryController.similar);
router.post('/reindex', authMiddleware, reindexValidation, validate, discoveryController.reindex);

module.exports = router;
