jest.mock('../config/database', () => ({ query: jest.fn() }));
jest.mock('../config/redis', () => ({
  redisClient: { isReady: false, publish: jest.fn() },
  getRedisClient: jest.fn(() => null),
  connectRedis: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  requestLogger: (req, res, next) => next(),
}));

const fs = require('fs');
const db = require('../config/database');
const exportService = require('../services/privacy/exportService');

describe('exportService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('requestExport', () => {
    it('creates a request and enqueues the gdpr-export job', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // no in-flight
        .mockResolvedValueOnce({ rows: [{ id: 11, user_id: 5, status: 'pending' }] })
        .mockResolvedValueOnce({ rows: [{ id: 200, job_type: 'gdpr-export' }] }); // enqueue insert

      const request = await exportService.requestExport(5);

      expect(request.id).toBe(11);
      const enqueue = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO jobs'));
      expect(enqueue[1][0]).toBe('gdpr-export');
      expect(JSON.parse(enqueue[1][1])).toEqual({ requestId: 11 });
    });

    it('rejects a second request while one is in flight', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 10 }] });
      await expect(exportService.requestExport(5)).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('processExportJob', () => {
    it('assembles all sections, writes the artifact, and marks the request ready', async () => {
      let readyParams = null;
      db.query.mockImplementation((sql, params) => {
        if (sql.includes('SELECT * FROM data_export_requests WHERE id')) {
          return Promise.resolve({ rows: [{ id: 11, user_id: 5 }] });
        }
        if (sql.includes('FROM users WHERE id')) {
          return Promise.resolve({ rows: [{ id: 5, username: 'max', email: 'max@example.com' }] });
        }
        if (sql.includes(`status = 'ready', file_path`) || sql.includes(`'ready'`) && sql.includes('download_token')) {
          readyParams = params;
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await exportService.processExportJob({ requestId: 11 });

      expect(result.sections).toBeGreaterThanOrEqual(15);
      expect(readyParams).not.toBeNull();
      const filePath = readyParams[1];
      expect(readyParams[2]).toMatch(/^[0-9a-f]{64}$/);
      expect(readyParams[3]).toBe('72');

      const artifact = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      expect(artifact.profile.username).toBe('max');
      expect(artifact).toHaveProperty('listeningEvents');
      expect(artifact).toHaveProperty('purchases');
      expect(artifact).toHaveProperty('revenue');
      expect(artifact.profile).not.toHaveProperty('password_hash');

      fs.unlinkSync(filePath);
    });

    it('marks the request failed when assembly blows up', async () => {
      const calls = [];
      db.query.mockImplementation((sql, params) => {
        calls.push([sql, params]);
        if (sql.includes('SELECT * FROM data_export_requests WHERE id')) {
          return Promise.resolve({ rows: [{ id: 12, user_id: 5 }] });
        }
        if (sql.includes('FROM users WHERE id')) {
          return Promise.reject(new Error('db exploded'));
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(exportService.processExportJob({ requestId: 12 })).rejects.toThrow('db exploded');
      const failUpdate = calls.find(([sql]) => sql.includes(`status = 'failed'`));
      expect(failUpdate[1]).toEqual([12, 'db exploded']);
    });
  });

  describe('resolveDownload', () => {
    it('only resolves ready, unexpired tokens', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      expect(await exportService.resolveDownload('a'.repeat(64))).toBeNull();

      const [sql] = db.query.mock.calls[0];
      expect(sql).toContain(`status = 'ready'`);
      expect(sql).toContain('expires_at > CURRENT_TIMESTAMP');
    });
  });
});
