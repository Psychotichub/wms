require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');

async function dropPhoneNumberIndex() {
  try {
    const uri = process.env.MONGO_URI_PROD;
    if (!uri) {
      throw new Error('MONGO_URI is not set');
    }

    await mongoose.connect(uri);
    console.log('MongoDB connected');

    const indexes = await User.collection.indexes();
    console.log('Current indexes:', indexes.map(idx => ({ name: idx.name, key: idx.key })));

    const phoneNumberIndex = indexes.find(
      (idx) => idx.key && idx.key.phoneNumber === 1
    );

    if (phoneNumberIndex) {
      await User.collection.dropIndex(phoneNumberIndex.name);
      console.log(`✅ Successfully dropped index: ${phoneNumberIndex.name}`);
    } else {
      console.log('ℹ️  No phoneNumber index found - nothing to drop');
    }

    await mongoose.disconnect();
    console.log('Done');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    if (err.code === 27) {
      console.log('Index does not exist (already dropped)');
    } else if (err.code === 85) {
      console.log('Index not found');
    }
    process.exit(1);
  }
}

dropPhoneNumberIndex();
