// eslint-disable-next-line max-classes-per-file
class AppError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;

        Error.captureStackTrace(this, this.constructor);
    }
}

class BadRequestError extends AppError {
    constructor(message = 'Bad request') {
        super(message, 400);
    }
}

class UnauthorizedError extends AppError {
    constructor(message = 'Unauthorized') {
        super(message, 401);
    }
}

class NotFoundError extends AppError {
    constructor(message = 'Not found') {
        super(message, 404);
    }
}
class ConflictError extends AppError {
    constructor(message = 'Conflict') {
        super(message, 409);
    }
}

class VerificationError extends AppError {
  constructor(message = "Verification required", attribute = null, session = null) {
    super(message, 400);
    this.verification_required = true;
    this.attribute = attribute;
    this.session = session;
  }
}

class SessionError extends AppError {
    constructor(message = "An active session exists on another device") {
        super(message, 409);
        this.requiresLogoutConfirmation = true;
    }
} 

class InternalServerError extends AppError {
    constructor(message = 'Internal server error') {
        super(message, 500);
    }
}

module.exports = {
    AppError,
    BadRequestError,
    UnauthorizedError,
    NotFoundError,
    ConflictError,
    VerificationError,
    SessionError,
    InternalServerError,
};
