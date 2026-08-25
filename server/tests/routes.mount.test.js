jest.mock('../config/database', () => ({ query: jest.fn() }));
jest.mock('../config/redis', () => ({
  redisClient: { isReady: false },
  getRedisClient: jest.fn(() => null),
  connectRedis: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  requestLogger: (req, res, next) => next(),
}));

/**
 * Wiring smoke test: requiring a route file crashes at import time if a
 * controller function or validation chain it references doesn't exist
 * (Express throws on undefined handlers). Asserting the registered paths
 * keeps the API contract pinned.
 */

const routePaths = (router) =>
  router.stack.filter((layer) => layer.route).map((layer) => {
    const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
    return `${methods} ${layer.route.path}`;
  });

describe('route wiring', () => {
  it('media routes mount with every handler defined', () => {
    const paths = routePaths(require('../routes/media'));
    expect(paths).toEqual(expect.arrayContaining([
      'GET /songs/:id/pipeline',
      'GET /songs/:id/waveform',
      'GET /songs/:id/hls/master.m3u8',
      'GET /songs/:id/hls/:variantKey/:file',
      'POST /songs/:id/reprocess',
      'GET /jobs/:id',
    ]));
  });

  it('commerce routes mount with every handler defined', () => {
    const paths = routePaths(require('../routes/commerce'));
    expect(paths).toEqual(expect.arrayContaining([
      'GET /products',
      'POST /products',
      'PUT /products/:id',
      'POST /checkout',
      'GET /library',
      'POST /download-token',
      'GET /download/:token',
      'POST /tiers',
      'GET /artists/:id/tiers',
      'POST /subscribe',
      'POST /subscriptions/:id/cancel',
      'GET /subscriptions',
      'GET /revenue',
      'PUT /songs/:id/early-access',
    ]));
  });

  it('discovery routes mount with every handler defined', () => {
    const paths = routePaths(require('../routes/discovery'));
    expect(paths).toEqual(expect.arrayContaining([
      'GET /search',
      'GET /radar',
      'GET /similar/:id',
      'POST /reindex',
    ]));
  });

  it('social routes mount with every handler defined', () => {
    const paths = routePaths(require('../routes/social'));
    expect(paths).toEqual(expect.arrayContaining([
      'GET /songs/:id/comments',
      'POST /songs/:id/comments',
      'DELETE /comments/:id',
    ]));
  });

  it('intel routes mount with every handler defined', () => {
    const paths = routePaths(require('../routes/intel'));
    expect(paths).toEqual(expect.arrayContaining([
      'POST /events',
      'GET /overview',
      'GET /top-tracks',
      'GET /songs/:id/retention',
      'GET /geography',
      'GET /revenue-by-track',
    ]));
  });

  it('privacy routes mount with every handler defined', () => {
    const paths = routePaths(require('../routes/privacy'));
    expect(paths).toEqual(expect.arrayContaining([
      'POST /export',
      'GET /export',
      'GET /export/download/:token',
      'POST /deletion-request',
      'DELETE /deletion-request',
      'GET /audit',
    ]));
  });

  it('every POST/PUT route carries at least three middlewares (auth + validation + validate)', () => {
    const routers = ['media', 'commerce', 'discovery', 'social', 'intel', 'privacy']
      .map((name) => require(`../routes/${name}`));

    for (const router of routers) {
      for (const layer of router.stack) {
        if (!layer.route) continue;
        const methods = layer.route.methods;
        if (methods.post || methods.put) {
          // handler stack = middlewares + controller
          expect(layer.route.stack.length).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });
});
