const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const db = require('../db/sequelize.db');
const { Session } = db;
const { UnauthorizedError, NotFoundError } = require('../utils/errorHandler');
const { createLogger } = require('../utils/awsLogger');
const logger = createLogger('middlewares - auth');
// AWS Cognito details
const region = process.env.AWS_REG;

// Role-wise Cognito User Pool ID
const roleToUserPoolId = {
  user: process.env.COGNITO_USER_POOL_ID,
  admin: process.env.COGNITO_ADMIN_POOL_ID,
};

// Return issuer URL and JWKS client for the given role
function getClientByRole(role) {
  const userPoolId = roleToUserPoolId[role];
  if (!userPoolId) return null;
  const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
  const client = jwksClient({
    jwksUri: `${issuer}/.well-known/jwks.json`,
  });
  return { issuer, client };
}

function getKey(client, header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      logger.error('Error fetching signing key from JWKS', { kid: header.kid, error: err.message });
      return callback(err);
    }
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

module.exports = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.error('Authorization header missing or invalid');
    return next(new NotFoundError('Authorization header missing or invalid'));
  }
  const role = req.body?.role || req.headers['role'];
  if (!role || !roleToUserPoolId[role]) {
    logger.warn('Missing or invalid role');
    return next(new UnauthorizedError('Missing or invalid role'));
  }
  const { issuer, client } = getClientByRole(role);
  if (!issuer || !client) {
    return next(new UnauthorizedError('No user pool found for given role'));
  }
  logger.info('Using user-pool for role', { role, userPoolId: roleToUserPoolId[role] });
  const token = authHeader.split(' ')[1];
  try {
    jwt.verify(token, (header, cb) => getKey(client, header, cb), { issuer }, async (err, decoded) => {
      if (err || !decoded || !decoded.sub) {
        logger.error('Unauthorized or invalid token', {
          error: err?.message || 'Invalid token',
        });
        return next(new UnauthorizedError('Unauthorized or invalid token'));
      }
      logger.info('Token verified successfully', { username: decoded.username, sub: decoded.sub });
      req.user = decoded;
      req.token = token;
      const session = await Session.findOne({
        where: {
          user_id: decoded.username,
          is_active: true,
        },
      });
      if (!session) {
        logger.warn('No active session found for user', { username: decoded.username });
        return next(new UnauthorizedError('Token has been invalidated. Please login again.'));
      }
      return next();
    });
  } catch (err) {
    logger.error({
      message: err.message,
      stack: err.stack
    });
    return next(new UnauthorizedError('Unauthorized access'));
  }
};