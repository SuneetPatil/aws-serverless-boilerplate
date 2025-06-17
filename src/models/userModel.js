const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class Users extends Model {}
  Users.init({
    id: {
      type: DataTypes.STRING,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    cognito_sub: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    first_name: {
      type: DataTypes.STRING(100),
    },
    last_name: {
      type: DataTypes.STRING(100),
    },
    email: {
      type: DataTypes.STRING(100),
    },
    phone: {
      type: DataTypes.STRING(20),
    },
    profile_pic_url:{
      type: DataTypes.STRING(255),
    },
    role: {
      type: DataTypes.STRING(10),
      defaultValue: 'user',
    },
    is_active: {
      type: DataTypes.BOOLEAN,
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  }, {
    sequelize,
    modelName: 'Users',
    tableName: 'users',
    timestamps: false,
  });
  return Users;
};
