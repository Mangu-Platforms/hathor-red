// Mock environment variables BEFORE requiring the module
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRE = '1h';

const { generateToken, hashPassword, comparePassword } = require('../utils/auth');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

describe('Authentication Utilities', () => {
  describe('generateToken', () => {
    it('should generate a valid JWT token', () => {
      const userId = 1;
      const username = 'testuser';
      const token = generateToken(userId, username);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');

      // Verify the token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      expect(decoded.userId).toBe(userId);
      expect(decoded.username).toBe(username);
      expect(decoded.iss).toBe('hathor-music');
    });

    it('should throw when JWT_SECRET is not set', () => {
      const savedSecret = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;
      expect(() => generateToken(1, 'testuser')).toThrow('JWT_SECRET environment variable is not set');
      process.env.JWT_SECRET = savedSecret;
    });
  });

  describe('hashPassword', () => {
    it('should hash the password correctly', async () => {
      const password = 'password123';
      const hash = await hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(0);
    });
  });

  describe('comparePassword', () => {
    it('should return true for matching password', async () => {
      const password = 'password123';
      const hash = await bcrypt.hash(password, 10);

      const isMatch = await comparePassword(password, hash);
      expect(isMatch).toBe(true);
    });

    it('should return false for non-matching password', async () => {
      const password = 'password123';
      const hash = await bcrypt.hash(password, 10);

      const isMatch = await comparePassword('wrongpassword', hash);
      expect(isMatch).toBe(false);
    });
  });
});
