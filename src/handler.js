const serverless = require('serverless-http');
const app = require('./app');
const db = require('./db/sequelize.db.js');
const sql = require('./config/neondb.js');

let isDbConnected = false;
const connectToDatabase = async () => {
    if (!isDbConnected) {
        try {
            await db.sequelize.authenticate();
            console.log("Sequelize: Connected to DB.");
            isDbConnected = true;
            if (sql) {
                const result = await sql`SELECT version()`;
                console.log("Neon DB version:", result[0].version);
            }
        } catch (error) {
            console.error("Sequelize DB connection error:", error);
            throw error;
        }
    }
};

module.exports.handler = async (event, context) => {
    console.log("Incoming event:", event);
    await connectToDatabase();
    return serverless(app)(event, context);
};
