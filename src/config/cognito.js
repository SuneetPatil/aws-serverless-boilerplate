const AWS = require("./aws.js");
const cognito = new AWS.CognitoIdentityServiceProvider();

const CLIENTS = {
    browser: {
        admin: {
            CLIENT_ID: process.env.COGNITO_WEB_ADMIN_CLIENT_ID,
            CLIENT_SECRET: process.env.COGNITO_WEB_ADMIN_CLIENT_SECRET,
            USER_POOL_ID: process.env.COGNITO_WEB_ADMIN_POOL_ID
        },
        user: {
            CLIENT_ID: process.env.COGNITO_WEB_USER_CLIENT_ID,
            CLIENT_SECRET: process.env.COGNITO_WEB_USER_CLIENT_SECRET,
            USER_POOL_ID: process.env.COGNITO_USER_POOL_ID
        }
    },
    mobile: {
        admin: {
            CLIENT_ID: process.env.COGNITO_MOBILE_ADMIN_CLIENT_ID,
            CLIENT_SECRET: process.env.COGNITO_MOBILE_ADMIN_CLIENT_SECRET,
            USER_POOL_ID: process.env.COGNITO_MOBILE_ADMIN_POOL_ID
        },
        user: {
            CLIENT_ID: process.env.COGNITO_MOBILE_USER_CLIENT_ID,
            CLIENT_SECRET: process.env.COGNITO_MOBILE_USER_CLIENT_SECRET,
            USER_POOL_ID: process.env.COGNITO_USER_POOL_ID
        }
    }
};

module.exports = { cognito, CLIENTS };
