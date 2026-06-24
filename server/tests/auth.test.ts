/**
 * Auth Controller Tests
 * Hathor Red v2.0
 */

import request from 'supertest';
import app from '../app';
import db from '../config/database';
import { hashPassword } from '../utils/auth';

async function createTestUser(overrides: any = {}) {
  const passwordHash = await hashPassword(overrides.password || 'testpass123');
  const result = await db.query(
    `INSERT INTO users (username, email, password_hash, display_name, role)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [
      overrides.username || `testuser_${Date.now()}`,
      overrides.email || `test_${Date.now()}@example.com`,
      passwordHash,
      overrides.displayName || 'Test User',
      overrides.role || 'listener',
    ]
  );
  return result.rows[0];
}

describe('Auth Controller', () => {
  describe('POST /api/v1/auth/register', () => {
    it('should register a new user', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: `newuser_${Date.now()}`,
          email: `new_${Date.now()}@example.com`,
          password: 'securepassword123',
          displayName: 'New User',
        });
      
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body.user).toBeDefined();
    });

    it('should reject duplicate username', async () => {
      const user = await createTestUser();
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: user.username,
          email: `other_${Date.now()}@example.com`,
          password: 'securepassword123',
        });
      
      expect(res.status).toBe(409);
    });

    it('should reject weak password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          username: `user_${Date.now()}`,
          email: `user_${Date.now()}@example.com`,
          password: '123',
        });
      
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should login with valid credentials', async () => {
      const user = await createTestUser({ password: 'testpass123' });
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: user.username,
          password: 'testpass123',
        });
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
    });

    it('should reject invalid credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: 'nonexistent',
          password: 'wrongpassword',
        });
      
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('should refresh access token', async () => {
      const user = await createTestUser({ password: 'testpass123' });
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: user.username, password: 'testpass123' });
      
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`refresh_token=${loginRes.body.refreshToken}`])
        .send();
      
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('accessToken');
    });

    it('should reject invalid refresh token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', ['refresh_token=invalid_token'])
        .send();
      
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('should logout and clear cookies', async () => {
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .send();
      
      expect(res.status).toBe(200);
      expect(res.headers['set-cookie']).toBeDefined();
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('should return current user profile', async () => {
      const user = await createTestUser({ password: 'testpass123' });
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: user.username, password: 'testpass123' });
      
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
        .send();
      
      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.username).toBe(user.username);
    });

    it('should reject unauthenticated request', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .send();
      
      expect(res.status).toBe(401);
    });
  });
});
