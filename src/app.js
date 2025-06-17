const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();
const errorHandler = require('./middlewares/errorHandler');
const cors = require('cors');
const db = require('./db/sequelize.db.js');
const sql = require('./config/neondb.js');

const port = process.env.PORT || 3000;

const { createLogger } = require('./utils/awsLogger');
const logger = createLogger('app');

const routes = require('./routes/route');
const app = express();

const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'role', 'device', 'device_id', 'ip_address'],
  exposedHeaders: ['Content-Type', 'Authorization', 'role', 'device', 'device_id', 'ip_address'],
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

app.use('/api', routes);

app.get('/', (req, res) => {
  res.status(200).json({
    status: "success",
    code: 200,
    message: "Welcome to the Serverless Auth API's"
  });
});

app.use(errorHandler);

(async () => {
  try {
    logger.info('Attempting DB connection...');
    await db.sequelize.authenticate();
    logger.info("Sequelize: Connected to DB successfully.");
    if (sql) {
      const result = await sql`SELECT version()`;
      logger.info("Neon DB version fetched", { version: result[0]?.version });
    }
  } catch (error) {
    logger.error({
      message: error.message,
      stack: error.stack
    });
  }
})();

app.listen(port, () => {
  logger.info(`Server is running on port ${port}`);
});

module.exports = app;