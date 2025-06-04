const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();
const errorHandler = require('./middlewares/errorHandler');

const db = require('./db/sequelize.db.js');
const sql = require('./config/neondb.js');

const port = process.env.PORT || 3000;
const routes = require('./routes/route');

const app = express();

app.use(bodyParser.json());

app.use('/api', routes);

app.get('/', (req, res) => {
  res.status(200).json({ message: "Welcome to the Serverless Auth API's" });
});

app.use(errorHandler);

(async () => {
  try {
    await db.sequelize.authenticate();
    console.log("Sequelize: Database connected successfully.");
    if (sql) {
      const result = await sql`SELECT version()`;
      console.log("Neon DB version:", result[0].version);
    }
  } catch (error) {
    console.error("Error connecting to the database:", error);
  }
})();

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

module.exports = app;