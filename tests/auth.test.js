const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');

require('./setup');

let app;

beforeAll(async () => {
  // Lazy-require after env vars are set by setup.js
  require('express-async-errors');
  const authRoutes = require('../src/routes/auth');
  const { authenticateToken } = require('../src/middleware/auth');

  app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ message: err.message || 'Server error' });
  });
});

const validPassword = 'TestPass1!';

const signupPayload = {
  name: 'Test User',
  email: 'auth-test@example.com',
  password: validPassword,
  company: 'TestCo',
  site: 'TestSite',
};

describe('POST /api/auth/signup', () => {
  it('creates a new user and returns 201', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send(signupPayload);

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(signupPayload.email);
    expect(res.body.user.isEmailVerified).toBe(false);
  });

  it('rejects duplicate email with 400', async () => {
    await request(app).post('/api/auth/signup').send(signupPayload);
    const res = await request(app).post('/api/auth/signup').send(signupPayload);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already registered/i);
  });

  it('rejects invalid payload with 400', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'bad' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    // Create and verify a user first
    await request(app).post('/api/auth/signup').send(signupPayload);
    const User = require('../src/models/User');
    await User.updateOne(
      { email: signupPayload.email },
      { isEmailVerified: true }
    );
  });

  it('returns tokens for valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: signupPayload.email,
        password: validPassword,
        company: 'TestCo',
      });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user.email).toBe(signupPayload.email);
  });

  it('rejects wrong password with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: signupPayload.email,
        password: 'WrongPass1!',
      });

    expect(res.status).toBe(401);
  });

  it('rejects non-existent email with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'nobody@example.com',
        password: validPassword,
      });

    expect(res.status).toBe(401);
  });

  it('rejects unverified email with 403', async () => {
    const User = require('../src/models/User');
    await User.updateOne(
      { email: signupPayload.email },
      { isEmailVerified: false }
    );

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: signupPayload.email,
        password: validPassword,
      });

    expect(res.status).toBe(403);
    expect(res.body.requiresVerification).toBe(true);
  });
});

describe('POST /api/auth/refresh', () => {
  let refreshToken;

  beforeEach(async () => {
    await request(app).post('/api/auth/signup').send(signupPayload);
    const User = require('../src/models/User');
    await User.updateOne(
      { email: signupPayload.email },
      { isEmailVerified: true }
    );

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: signupPayload.email, password: validPassword });

    refreshToken = loginRes.body.refreshToken;
  });

  it('returns new tokens for valid refresh token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
  });

  it('rejects invalid refresh token with 401', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: 'invalid-token-value-here' });

    expect(res.status).toBe(401);
  });
});
