const express = require('express');
const router = express.Router();
const commerceController = require('../controllers/commerceController');
const authMiddleware = require('../middleware/auth');
const {
  validate,
  idParamValidation,
  productValidation,
  productUpdateValidation,
  checkoutValidation,
  downloadTokenRequestValidation,
  downloadTokenParamValidation,
  tierValidation,
  subscribeValidation,
  earlyAccessValidation,
} = require('../middleware/validation');

// Products
router.get('/products', authMiddleware, commerceController.listProducts);
router.post('/products', authMiddleware, productValidation, validate, commerceController.createProduct);
router.put('/products/:id', authMiddleware, productUpdateValidation, validate, commerceController.updateProduct);

// Checkout + library
router.post('/checkout', authMiddleware, checkoutValidation, validate, commerceController.checkoutProduct);
router.get('/library', authMiddleware, commerceController.getLibrary);
router.post('/download-token', authMiddleware, downloadTokenRequestValidation, validate, commerceController.requestDownloadToken);
// The 64-hex token IS the credential (shared via email/link) — no JWT here.
router.get('/download/:token', downloadTokenParamValidation, validate, commerceController.downloadByToken);

// Fan clubs
router.post('/tiers', authMiddleware, tierValidation, validate, commerceController.createTier);
router.get('/artists/:id/tiers', authMiddleware, idParamValidation, validate, commerceController.listTiers);
router.post('/subscribe', authMiddleware, subscribeValidation, validate, commerceController.subscribeTier);
router.post('/subscriptions/:id/cancel', authMiddleware, idParamValidation, validate, commerceController.cancelSubscription);
router.get('/subscriptions', authMiddleware, commerceController.mySubscriptions);

// Artist money + early access
router.get('/revenue', authMiddleware, commerceController.getRevenue);
router.put('/songs/:id/early-access', authMiddleware, earlyAccessValidation, validate, commerceController.setEarlyAccess);

module.exports = router;
