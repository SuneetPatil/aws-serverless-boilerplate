const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Session = sequelize.define('Session', {
    "session_id": {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    "user_id": {
      type: DataTypes.STRING,
      allowNull: false,
    },
    "user-agent": {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    "device_id": {
      type: DataTypes.TEXT,
    },
    "ip_address": {
      type: DataTypes.STRING(45),
      allowNull: false,
    },
    "refresh_token": {
      type: DataTypes.TEXT,
    },
    "created_at": {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    "expires_at": {
      type: DataTypes.DATE,
    },
    "is_active": {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  }, {
    tableName: 'sessions',
    timestamps: false,
  });

  Session.associate = (models) => {
    Session.belongsTo(models.User, {
      foreignKey: 'user_id',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    });
  };
  return Session;
};
