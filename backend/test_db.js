const mongoose = require('mongoose');
const dns = require('dns');
const env = require('./src/config/env');

dns.setServers(['8.8.8.8', '8.8.4.4']);

const uris = [env.MONGO_URI].filter(Boolean);

async function test() {
  for (const uri of uris) {
    console.log(`Testing URI: ${uri.replace(/\/\/.*@/, '//***@')}`);
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
      console.log('SUCCESS!');
      await mongoose.disconnect();
      return;
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      // console.log(err);
    }
  }
}

test();
