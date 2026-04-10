const mongoose = require('mongoose');
const logger = require('./logger');

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000;

const getMongoHost = (mongoUri) => {
  if (!mongoUri) {
    return 'unknown-host';
  }

  const cleaned = mongoUri.replace(/^mongodb\+srv:\/\//, '').replace(/^mongodb:\/\//, '');
  const withoutCreds = cleaned.includes('@') ? cleaned.split('@')[1] : cleaned;
  const hostPart = withoutCreds.split('/')[0];

  return hostPart || 'unknown-host';
};

const getMongoLocationLabel = (mongoUri) => {
  const host = getMongoHost(mongoUri).toLowerCase();
  const isSrv = /^mongodb\+srv:\/\//.test(mongoUri || '');
  const isAtlas = host.endsWith('.mongodb.net');
  const isLocal =
    host.includes('localhost') ||
    host.startsWith('127.0.0.1') ||
    host.startsWith('0.0.0.0');

  if (isLocal) {
    return 'local';
  }

  if (isSrv || isAtlas) {
    return 'cloud';
  }

  return 'cloud';
};

const resolveMongoUri = (appEnv) => {
  const env = (appEnv || '').toLowerCase();
  const isProd = env === 'prod' || env === 'production';

  if (isProd && process.env.MONGO_URI_PROD) {
    return process.env.MONGO_URI_PROD;
  }

  if (!isProd && process.env.MONGO_URI_DEV) {
    return process.env.MONGO_URI_DEV;
  }

  return process.env.MONGO_URI;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const dbConnect = async () => {
  const appEnv = (process.env.APP_ENV || '').toLowerCase();
  const envLabel = appEnv === 'prod' || appEnv === 'production' ? 'production' : 'development';
  const uri = resolveMongoUri(appEnv);

  if (!uri) {
    throw new Error('MONGO_URI is not set');
  }

  // Connection event listeners
  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });
  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected');
  });
  mongoose.connection.on('error', (err) => {
    logger.error({ err }, 'MongoDB connection error');
  });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await mongoose.connect(uri, {
        maxPoolSize: 10,
      });
      const connectedDbName = mongoose.connection?.name || 'unknown-db';
      logger.info(
        `MongoDB connected (${envLabel}, ${getMongoLocationLabel(uri)}/${connectedDbName})`
      );
      return;
    } catch (err) {
      logger.error(
        { err, attempt, maxRetries: MAX_RETRIES },
        `MongoDB connection attempt ${attempt}/${MAX_RETRIES} failed`
      );

      if (attempt === MAX_RETRIES) {
        logger.fatal('All MongoDB connection attempts exhausted, exiting');
        process.exit(1);
      }

      const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
      logger.info(`Retrying in ${backoff}ms…`);
      await sleep(backoff);
    }
  }
};

module.exports = dbConnect;
