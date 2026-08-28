const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/auth');
const {
  registerValidation,
  loginValidation,
  updateProfileValidation,
  changePasswordValidation,
  validate,
} = require('../middleware/validation');

router.post('/register', registerValidation, validate, authController.register);
router.post('/login', loginValidation, validate, authController.login);
router.get('/profile', authMiddleware, authController.getProfile);
router.put('/profile', authMiddleware, updateProfileValidation, validate, authController.updateProfile);
router.post('/change-password', authMiddleware, changePasswordValidation, validate, authController.changePassword);
router.get('/stats', authMiddleware, authController.getListeningStats);

module.exports = router;
