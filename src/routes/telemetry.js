const express = require('express');

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
    at: new Date().toISOString()
  };

  // Lightweight logging: write to stdout. Hook this into a log aggregator if needed.
  console.warn('[client-error]', JSON.stringify(payload));

  return res.status(204).send();
});

module.exports = router;
