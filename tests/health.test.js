const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');

require('./setup');

const app = express();

app.get('/health', (_req, res) => {
  const mongoState = mongoose.connection.readyState;
  const stateMap = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  const mem = process.memoryUsage();
  const healthy = mongoState === 1;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    service: 'wms-backend',
    uptime: Math.floor(process.uptime()),
    mongo: stateMap[mongoState] || 'unknown',
    redis: { configured: false, status: 'not_used' },
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
    },
  });
});

describe('GET /health', () => {
  it('returns 200 with status ok when MongoDB is connected', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('wms-backend');
    expect(res.body.mongo).toBe('connected');
    expect(res.body.memory).toBeDefined();
    expect(typeof res.body.uptime).toBe('number');
    expect(res.body.redis).toEqual({ configured: false, status: 'not_used' });
  });
});
