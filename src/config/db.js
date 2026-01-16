const mongoose = require('mongoose');

const dbConnect = async () => {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    throw new Error('MONGO_URI is not set');
  }

  try {
    await mongoose.connect(uri);
    console.log('MongoDB connected');
  } catch (err) {
    console.error('Mongo connection error', err);
    process.exit(1);
  }
};

module.exports = dbConnect;

