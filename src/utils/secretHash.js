const crypto = require("crypto");

function generateSecretHash(username, client) {
    return crypto.createHmac("SHA256", client.CLIENT_SECRET)
        .update(username + client.CLIENT_ID)
        .digest("base64");
}

module.exports = { generateSecretHash };
