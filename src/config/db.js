const mongoose = require('mongoose');

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

const dbConnect = async () => {
  const appEnv = (process.env.APP_ENV || '').toLowerCase();
  const envLabel = appEnv === 'prod' || appEnv === 'production' ? 'production' : 'development';
  const uri = resolveMongoUri(appEnv);

  if (!uri) {
    throw new Error('MONGO_URI is not set');
  }

  try {
    await mongoose.connect(uri);
    const connectedDbName = mongoose.connection?.name || 'unknown-db';
    console.log(
      `MongoDB connected (${envLabel}, ${getMongoLocationLabel(uri)}/${connectedDbName})`
    );
  } catch (err) {
    console.error('Mongo connection error', err);
    process.exit(1);
  }
};

module.exports = dbConnect;

