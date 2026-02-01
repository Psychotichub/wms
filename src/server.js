const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
// const rateLimit = require('express-rate-limit');
const dbConnect = require('./config/db');

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
let todoRoutes;
try {
  todoRoutes = require('./routes/todos');
  console.log('[Server] Todo routes loaded successfully');
} catch (error) {
  console.error('[Server] Error loading todo routes:', error);
  throw error;
}
const { initializeScheduledJobs } = require('./utils/scheduler');

const app = express();
const port = process.env.PORT || 4000;

dbConnect();

// Initialize scheduled jobs (cron tasks)
initializeScheduledJobs();

app.use(helmet());
app.use(compression());

// CORS
// - Native apps often send no Origin header -> allow (origin === undefined/null)
// - Web dev should be allowed (localhost) + optional whitelist via env
const corsOriginsEnv = (process.env.CORS_ORIGINS || '').trim();
const allowedOrigins = corsOriginsEnv
  ? corsOriginsEnv.split(',').map((o) => o.trim()).filter(Boolean)
  : [];

const isAllowedLocalhostOrigin = (origin) => {
  if (!origin) return true; // allow native / server-to-server
  try {
    const url = new URL(origin);
    const hostname = url.hostname;
    
    // Allow localhost variants
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '10.0.2.2'
    ) {
      return true;
    }
    
    // Allow Expo web build URLs (expo.app, exp.direct, etc.)
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

// Rate limiting - COMMENTED OUT
// In development, disable by default to avoid blocking local testing.
// const rateLimitWindowMs =
//   Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
// const rateLimitMax =
//   Number(process.env.RATE_LIMIT_MAX) ||
//   (appEnv === 'production' ? 100 : 10000);
// const rateLimitEnabled =
//   (process.env.RATE_LIMIT_ENABLED || (appEnv === 'production' ? 'true' : 'false')).toLowerCase() === 'true';

// const limiter = rateLimit({
//   windowMs: rateLimitWindowMs,
//   max: rateLimitMax,
//   message: 'Too many requests from this IP, please try again later',
//   standardHeaders: true,
//   legacyHeaders: false,
//   skip(req) {
//     // Don't rate-limit auth endpoints; prevents refresh/login loops from turning into 429s.
//     return req.path.startsWith('/api/auth/');
//   },
// });
// if (rateLimitEnabled) {
//   app.use(limiter);
// }
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'wms-backend' });
});

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
console.log('[Server] Todo routes registered at /api/todos');

app.use((err, _req, res, _next) => {
  // Generic error handler to avoid leaking details
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

app.listen(port, () => {
  console.log(`WMS backend running on http://localhost:${port}`);
});

