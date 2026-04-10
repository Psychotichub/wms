const express = require('express');
const logger = require('../config/logger').child({ module: 'telemetry' });

const router = express.Router();

const truncate = (value, max = 2000) => {
  if (typeof value !== 'string') return value;
  return value.length > max ? `${value.slice(0, max)}…` : value;
};

router.post('/client-error', (req, res) => {
  const {
    message,
    name,
    stack,
    level = 'error',
    context,
    extra,
    platform
  } = req.body || {};

  if (!message) {
    return res.status(400).json({ message: 'message is required' });
  }

  const payload = {
    message: truncate(message),
    name: truncate(name),
    stack: truncate(stack, 4000),
    level,
    context: truncate(context),
    extra,
    platform,
    ip: req.ip,
  };

  logger.warn(payload, 'Client error reported');

  return res.status(204).send();
});

module.exports = router;
