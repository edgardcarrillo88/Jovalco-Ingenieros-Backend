/**
 * Helper de conexión a MongoDB en memoria (mongodb-memory-server).
 * Permite que los tests de servicio usen una base de datos real efímera,
 * sin depender de la base de datos de desarrollo.
 */
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongoServer;

const connect = async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
};

const disconnect = async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = undefined;
  }
};

const clearDatabase = async () => {
  if (!mongoose.connection || mongoose.connection.readyState !== 1) return;
  const collections = mongoose.connection.collections;
  const names = Object.keys(collections);
  await Promise.all(
    names.map((name) => collections[name].deleteMany({})),
  );
};

module.exports = { connect, disconnect, clearDatabase };
