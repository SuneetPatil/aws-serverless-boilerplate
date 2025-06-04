const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const db = require('../db/sequelize.db');
const { Session } = db;
const { UnauthorizedError, NotFoundError } = require('../utils/errorHandler');
// AWS Cognito details
const region = process.env.AWS_REGION;

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
    if (err) return callback(err);
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

module.exports = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new NotFoundError('Authorization header missing or invalid'));
  }

  const role = req.body?.role || req.headers['role'];
  console.log('Using user pool for role:', roleToUserPoolId[role]);;
  if (!role || !roleToUserPoolId[role]) {
    return next(new UnauthorizedError('Missing or invalid role'));
  }
  const { issuer, client } = getClientByRole(role);
  if (!issuer || !client) {
    return next(new UnauthorizedError('No user pool found for given role'));
  }
  const token = authHeader.split(' ')[1];
  try {
    jwt.verify(token, (header, cb) => getKey(client, header, cb), { issuer }, async (err, decoded) => {
      if (err || !decoded || !decoded.sub) {
        console.error('Token verification error:', err);
        return next(new UnauthorizedError('Unauthorized or invalid token'));
      }
      req.user = decoded;
      req.token = token;
      const session = await Session.findOne({
        where: {
          user_id: decoded.username,
          is_active: true,
        },
      });
      if (!session) {
        return next(new UnauthorizedError('Token has been invalidated. Please login again.'));
      }
      return next();
    });
  } catch (err) {
    console.error('Middleware error:', err);
    return next(new UnauthorizedError('Unauthorized access'));
  }
};