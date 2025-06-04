require('dotenv').config();
const { Sequelize } = require('sequelize');
const initializeModels = require('../models');

const sequelize = new Sequelize(process.env.PGDATABASE, process.env.PGUSER, process.env.PGPASSWORD, {
  host: process.env.PGHOST,
  dialect: 'postgres',
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  },
  define: {
    schema: 'sample-neon',
  },
  logging: false
});

const db = initializeModels(sequelize, Sequelize);
db.sequelize = sequelize;
db.Sequelize = Sequelize;

sequelize.sync({ force: false });

module.exports = db;
