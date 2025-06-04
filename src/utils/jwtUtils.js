const jwksClient = require("jwks-rsa");
const jwt = require("jsonwebtoken");

const getJwksClient = (region, poolId) =>
    jwksClient({ jwksUri: `https://cognito-idp.${region}.amazonaws.com/${poolId}/.well-known/jwks.json` });

const getSigningKey = (client, token) => {
    const decodedHeader = jwt.decode(token, { complete: true }).header;
    return new Promise((resolve, reject) => {
        client.getSigningKey(decodedHeader.kid, (err, key) => {
            if (err) return reject(err);
            const signingKey = key.publicKey || key.rsaPublicKey;
            resolve(signingKey);
        });
    });
};

module.exports = { getJwksClient, getSigningKey };
