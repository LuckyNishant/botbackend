const mongoose = require("mongoose");
const config = require("../config");

async function connectMongo() {
  if (!config.mongodb.uri) {
    throw new Error("MONGODB_URI is missing");
  }

  await mongoose.connect(config.mongodb.uri, {
    dbName: config.mongodb.dbName
  });
  console.log("MongoDB connected");
}

module.exports = { connectMongo };
