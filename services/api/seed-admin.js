require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

async function main() {
  console.log('Connecting to:', process.env.MONGO_PLATFORM_URI?.slice(0, 40) + '...');
  await mongoose.connect(process.env.MONGO_PLATFORM_URI, { dbName: 'platform' });

  await mongoose.connection.collection('platformadmins').deleteMany({});
  console.log('Cleared existing admins');

  const password = 'Admin1234';
  const hash = await bcrypt.hash(password, 12);

  // Verify hash works before inserting
  const valid = await bcrypt.compare(password, hash);
  console.log('Hash self-test:', valid); // must be true

  await mongoose.connection.collection('platformadmins').insertOne({
    _id: crypto.randomUUID(),
    name: 'Super Admin',
    email: 'admin@platform.com',
    password_hash: hash,
    role: 'super_admin',
    created_at: new Date(),
  });

  // Read back and verify
  const doc = await mongoose.connection.collection('platformadmins').findOne({ email: 'admin@platform.com' });
  console.log('Stored doc email:', doc.email);
  const check = await bcrypt.compare(password, doc.password_hash);
  console.log('Readback bcrypt check:', check); // must be true

  await mongoose.disconnect();
  console.log('Done. Login with admin@platform.com / Admin1234');
}

main().catch(e => { console.error(e); process.exit(1); });
