const AWS = require("aws-sdk");

const AWS_REGION = process.env.AWS_REG;
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET;

AWS.config.update({
    region: AWS_REGION,
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
});

module.exports = AWS;