// ============================================================
// Request Validation Middleware (Zod)
// ============================================================
const { ZodError } = require('zod');

/**
 * Creates a validation middleware from a Zod schema.
 * Validates req.body by default, can also validate params/query.
 *
 * @param {import('zod').ZodSchema} schema - Zod schema
 * @param {'body'|'params'|'query'} source - what to validate
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    try {
      const parsed = schema.parse(req[source]);
      req[source] = parsed; // replace with parsed (cleaned) data
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: err.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
      }
      next(err);
    }
  };
}

module.exports = { validate };
