const { AppError } = require("../utils/errorHandler");

const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;

  // Base structure (no `data` yet)
  const errorResponse = {
    status: "error",
    code: statusCode,
    message: err.message || "Something went wrong"
  };

  // Populate extra details ONLY for AppError instances
  if (err instanceof AppError) {
    const extra = {};

    if (err.verification_required) {
      extra.verification_required = true;
    }

    if (err.attribute) {
      extra.attribute = err.attribute;
    }

    if (err.requiresLogoutConfirmation) {
      extra.requiresLogoutConfirmation = true;
    }

    if (err.session) {
      extra.session = err.session;
    }

    if (Object.keys(extra).length > 0) {
      errorResponse.data = extra;
    }

    return res.status(statusCode).json(errorResponse);
  }

  return res.status(500).json({
    status: "error",
    code: 500,
    message: "Internal server error"
  });
};

module.exports = errorHandler;
