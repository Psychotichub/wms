require('express-async-errors');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
// const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const Sentry = require('@sentry/node');
const pinoHttp = require('pino-http');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const dbConnect = require('./config/db');
const logger = require('./config/logger');
const requestId = require('./middleware/requestId');

// Environment loading / switching
// 1) Load base `.env` first (so APP_ENV can be read from it).
// 2) If `.env.<appEnv>` exists, load it (development only) to override.
dotenv.config();

const appEnv = (process.env.APP_ENV || 'development').toLowerCase();
const envFile = path.resolve(process.cwd(), `.env.${appEnv}`);
if (appEnv !== 'production' && fs.existsSync(envFile)) {
  dotenv.config({ path: envFile, override: true });
}

// Resolve env-specific vars (allows using *_DEV / *_PROD in addition to plain vars)
const isProdEnv = appEnv === 'production' || appEnv === 'prod';
process.env.MONGO_URI =
  process.env.MONGO_URI ||
  (isProdEnv ? process.env.MONGO_URI_PROD : process.env.MONGO_URI_DEV) ||
  process.env.MONGO_URI;
process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  (isProdEnv ? process.env.JWT_SECRET_PROD : process.env.JWT_SECRET_DEV) ||
  process.env.JWT_SECRET;
process.env.CORS_ORIGINS =
  process.env.CORS_ORIGINS ||
  (isProdEnv ? process.env.CORS_ORIGINS_PROD : process.env.CORS_ORIGINS_DEV) ||
  process.env.CORS_ORIGINS;

// Sentry — initialise early so it can capture startup errors.
// Set SENTRY_DSN in your .env to enable; without it Sentry is a harmless no-op.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: appEnv,
    tracesSampleRate: isProdEnv ? 0.2 : 1.0,
  });
  logger.info('Sentry initialised');
}

// IMPORTANT: require routes only AFTER env is loaded, because some routes read secrets at module load.
const authRoutes = require('./routes/auth');
const reportRoutes = require('./routes/reports');
const materialRoutes = require('./routes/materials');
const receivedRoutes = require('./routes/received');
const panelRoutes = require('./routes/panels');
const userRoutes = require('./routes/users');
const settingsRoutes = require('./routes/settings');
const sitesRoutes = require('./routes/sites');
const employeeRoutes = require('./routes/employees');
const notificationRoutes = require('./routes/notifications');
const locationRoutes = require('./routes/locations');
const { router: deviceRoutes } = require('./routes/devices');
const telemetryRoutes = require('./routes/telemetry');
const contractRoutes = require('./routes/contracts');
const inventoryRoutes = require('./routes/inventory');
const taskRoutes = require('./routes/tasks');
const isolationTestRoutes = require('./routes/isolationTests');
let todoRoutes;
try {
  todoRoutes = require('./routes/todos');
  logger.info('Todo routes loaded');
} catch (error) {
  logger.error({ err: error }, 'Error loading todo routes');
  throw error;
}
const { initializeScheduledJobs } = require('./utils/scheduler');

const app = express();
const port = process.env.PORT || 4000;

dbConnect();

initializeScheduledJobs();

// ── Core middleware ──────────────────────────────────────────────────────────

app.use(requestId);

app.use(
  pinoHttp({
    logger,
    genReqId: (req) => req.id,
    serializers: {
      req: (req) => ({ method: req.method, url: req.url, id: req.id }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
    autoLogging: {
      ignore: (req) => req.url === '/health',
    },
  })
);

app.use(helmet());
app.use(compression());

// CORS
const corsOriginsEnv = (process.env.CORS_ORIGINS || '').trim();
const allowedOrigins = corsOriginsEnv
  ? corsOriginsEnv.split(',').map((o) => o.trim()).filter(Boolean)
  : [];

const isAllowedLocalhostOrigin = (origin) => {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    const hostname = url.hostname;

    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '10.0.2.2'
    ) {
      return true;
    }

    if (
      hostname.includes('.expo.app') ||
      hostname.includes('.exp.direct') ||
      hostname.includes('expo.dev')
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
};

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (isAllowedLocalhostOrigin(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked origin: ${origin}`));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Length'],
  })
);

// ── Rate limiting (commented out for now) ────────────────────────────────────

// const rateLimitWindowMs =
//   Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
// const rateLimitMax =
//   Number(process.env.RATE_LIMIT_MAX) ||
//   (isProdEnv ? 100 : 10000);
// const rateLimitEnabled =
//   (process.env.RATE_LIMIT_ENABLED || (isProdEnv ? 'true' : 'false')).toLowerCase() === 'true';
//
// const generalLimiter = rateLimit({
//   windowMs: rateLimitWindowMs,
//   max: rateLimitMax,
//   message: 'Too many requests from this IP, please try again later',
//   standardHeaders: true,
//   legacyHeaders: false,
//   skip(req) {
//     return req.path.startsWith('/api/auth/');
//   },
// });
//
// const authLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   max: isProdEnv ? 15 : 10000,
//   message: 'Too many authentication attempts, please try again later',
//   standardHeaders: true,
//   legacyHeaders: false,
// });
//
// if (rateLimitEnabled) {
//   app.use(generalLimiter);
//   logger.info('General rate limiter enabled');
// }
//
// const telemetryLimiter = rateLimit({
//   windowMs: 60 * 1000,
//   max: 10,
//   message: 'Too many telemetry reports',
//   standardHeaders: true,
//   legacyHeaders: false,
// });

app.use(express.json({ limit: '1mb' }));

// ── Health check ────────────────────────────────────────────────────────────

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
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
    },
  });
});

// ── Swagger / OpenAPI docs ──────────────────────────────────────────────────

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'WMS Backend API',
      version: '0.1.0',
      description: 'Work Management System API documentation',
    },
    servers: [
      { url: `http://localhost:${port}`, description: 'Local' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/routes/*.js'],
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ── Routes ──────────────────────────────────────────────────────────────────

app.use('/api/auth', authRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/received', receivedRoutes);
app.use('/api/panels', panelRoutes);
app.use('/api/users', userRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/sites', sitesRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/telemetry', telemetryRoutes);
app.use('/api/contracts', contractRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/todos', todoRoutes);
app.use('/api/isolation-tests', isolationTestRoutes);

// ── Global error handler ────────────────────────────────────────────────────

app.use((err, req, res, _next) => {
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err);
  }
  const log = req.log || logger;
  log.error({ err, requestId: req.id }, 'Unhandled error');
  res.status(err.status || 500).json({
    message: isProdEnv ? 'Server error' : (err.message || 'Server error'),
    ...(req.id && { requestId: req.id }),
  });
});

// ── Start server ────────────────────────────────────────────────────────────

const server = app.listen(port, () => {
  logger.info(`WMS backend running on http://localhost:${port}`);
});

// ── Graceful shutdown ───────────────────────────────────────────────────────

const shutdown = async (signal) => {
  logger.info({ signal }, 'Shutdown signal received, closing gracefully…');
  server.close(async () => {
    try {
      await mongoose.connection.close();
      logger.info('MongoDB connection closed');
    } catch (err) {
      logger.error({ err }, 'Error closing MongoDB connection');
    }
    process.exit(0);
  });

  // Force-kill after 10 s if graceful close stalls
  setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
