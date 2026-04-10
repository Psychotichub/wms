const { randomUUID } = require('crypto');

const requestId = (req, _res, next) => {
  req.id = req.headers['x-request-id'] || randomUUID();
  next();
};

module.exports = requestId;
