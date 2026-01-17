const { z } = require('zod');

const validate = (schema, options = {}) => (req, res, next) => {
  try {
    const source = options.source || (req.method === 'GET' ? 'query' : 'body');
    const data = source === 'params' ? req.params : source === 'query' ? req.query : req.body;
    req.data = schema.parse(data); // Stores validated data in req.data
    return next();
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues = Array.isArray(err.errors)
        ? err.errors
        : Array.isArray(err.issues)
          ? err.issues
          : [];
      return res.status(400).json({
        message: 'Validation failed',
        errors: issues.map((e) => ({ field: e.path.join('.'), message: e.message }))
      });
    }
    return next(err);
  }
};

module.exports = { validate, z };
