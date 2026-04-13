const mongoose = require('mongoose');
const dns = require('dns');

dns.setServers(['8.8.8.8', '8.8.4.4']);

const uris = [
  'mongodb+srv://verdex_db:verdex123@cluster0.64flr9x.mongodb.net/court_transparency?retryWrites=true&w=majority',
  'mongodb+srv://verdex_db:no_sqlpass123@cluster0.64flr9x.mongodb.net/court_transparency?retryWrites=true&w=majority'
];

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
