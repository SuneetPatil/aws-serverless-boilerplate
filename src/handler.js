const serverless = require('serverless-http');
const app = require('./app');
const db = require('./db/sequelize.db.js');
const sql = require('./config/neondb.js');
const { createLogger } = require('./utils/awsLogger');
const logger = createLogger('handler');

let isDbConnected = false;

const connectToDatabase = async () => {
  if (!isDbConnected) {
    try {
      logger.info('Attempting DB connection...');
      await db.sequelize.authenticate();
      logger.info("Sequelize: Connected to DB successfully.");
      isDbConnected = true;
      if (sql) {
        const result = await sql`SELECT version()`;
        logger.info("Neon DB version fetched", { version: result[0]?.version });
      }
    } catch (error) {
      logger.error({
        message: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
};

const expressHandler = serverless(app, {
  request: (request, event, context) => {
    if (event.body && typeof event.body === 'string') {
      try {
        request.body = JSON.parse(event.body);
      } catch (err) {
        logger.warn({
          body: event.body,
          error: err.message
        });
      }
    }
    request.lambdaContext = context;
  },
});

module.exports.handler = async (event, context) => {
  logger.info('Lambda handler invoked', { event, context });
  try {
    await connectToDatabase();
    const response = await expressHandler(event, context);
    logger.info('Lambda handler executed successfully');
    return response;
  } catch (error) {
    logger.error({
      message: error.message,
      stack: error.stack
    });
    throw error;
  }
};