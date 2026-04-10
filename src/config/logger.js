const pino = require('pino');

const appEnv = (process.env.APP_ENV || 'development').toLowerCase();
const isProd = appEnv === 'production' || appEnv === 'prod';

const logger = pino({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  ...(isProd
    ? {}
    : {
        transport: {
          target: 'pino/file',
          options: { destination: 1 }
        }
      })
});

module.exports = logger;
