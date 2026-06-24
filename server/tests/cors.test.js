const corsOptions = require('../config/cors');

describe('CORS Configuration', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should allow localhost:3000 in development mode when no CLIENT_URL is set', (done) => {
    process.env.NODE_ENV = 'development';
    delete process.env.CLIENT_URL;
    corsOptions.origin('http://localhost:3000', (err, result) => {
      try {
        expect(err).toBeNull();
        expect(result).toBe(true);
        done();
      } catch (error) {
        done(error);
      }
    });
  });

  it('should deny malicious.com in development mode when no CLIENT_URL is set', (done) => {
    process.env.NODE_ENV = 'development';
    delete process.env.CLIENT_URL;
    corsOptions.origin('http://malicious.com', (err, result) => {
      try {
        expect(err.message).toBe('Not allowed by CORS: http://malicious.com');
        expect(result).toBe(false);
        done();
      } catch (error) {
        done(error);
      }
    });
  });

  it('should deny localhost:3000 in production mode when no CLIENT_URL is set', (done) => {
    process.env.NODE_ENV = 'production';
    delete process.env.CLIENT_URL;
    corsOptions.origin('http://localhost:3000', (err, result) => {
      try {
        expect(err).toBeNull();
        expect(result).toBe(false);
        done();
      } catch (error) {
        done(error);
      }
    });
  });

  it('should allow CLIENT_URL in production mode', (done) => {
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_URL = 'https://myapp.com';
    corsOptions.origin('https://myapp.com', (err, result) => {
      try {
        expect(err).toBeNull();
        expect(result).toBe(true);
        done();
      } catch (error) {
        done(error);
      }
    });
  });

  it('should deny other origins in production mode even if CLIENT_URL is set', (done) => {
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_URL = 'https://myapp.com';
    corsOptions.origin('https://malicious.com', (err, result) => {
      try {
        expect(err).toBeNull();
        expect(result).toBe(false);
        done();
      } catch (error) {
        done(error);
      }
    });
  });

  it('should allow any origin from a comma-separated CLIENT_URL list', (done) => {
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_URL = 'https://myapp.com, https://another.com';
    corsOptions.origin('https://another.com', (err, result) => {
      try {
        expect(err).toBeNull();
        expect(result).toBe(true);
        done();
      } catch (error) {
        done(error);
      }
    });
  });

  it('should deny requests with no origin in production mode', (done) => {
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_URL = 'https://myapp.com';
    corsOptions.origin(undefined, (err, result) => {
      try {
        expect(err.message).toBe('Origin header required in production');
        expect(result).toBe(false);
        done();
      } catch (error) {
        done(error);
      }
    });
  });

  it('should allow requests with no origin in development mode', (done) => {
    process.env.NODE_ENV = 'development';
    process.env.CLIENT_URL = 'https://myapp.com';
    corsOptions.origin(undefined, (err, result) => {
      try {
        expect(err).toBeNull();
        expect(result).toBe(true);
        done();
      } catch (error) {
        done(error);
      }
    });
  });
});
