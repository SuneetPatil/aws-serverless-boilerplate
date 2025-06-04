const UserModel = require('./userModel');
const SessionModel = require('./sessionModel');

const initializeModels = (sequelize) => {
    const db = {};
    db.User = UserModel(sequelize);
    db.Session = SessionModel(sequelize);
    if (db.User.associate) db.User.associate(db);
    if (db.Session.associate) db.Session.associate(db);

    return db;
};

module.exports = initializeModels;
