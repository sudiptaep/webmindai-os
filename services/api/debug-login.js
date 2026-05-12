require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const PlatformAdminSchema = new mongoose.Schema({
  _id: String,
  name: String,
  email: { type: String, lowercase: true },
  password_hash: String,
  role: String,
}, { _id: false, versionKey: false });

async function main() {
  await mongoose.connect(process.env.MONGO_PLATFORM_URI);

  const PlatformAdmin = mongoose.model('PlatformAdmin', PlatformAdminSchema);

  const email = 'admin@platform.com';
  const password = 'Admin1234';

  const admin = await PlatformAdmin.findOne({ email }).lean();
  console.log('Found admin:', admin ? 'YES' : 'NO');
  if (admin) {
    console.log('Email match:', admin.email);
    console.log('Hash present:', !!admin.password_hash);
    console.log('Hash value:', admin.password_hash?.slice(0, 20));
    const valid = await bcrypt.compare(password, admin.password_hash);
    console.log('bcrypt.compare result:', valid);
  }

  await mongoose.disconnect();
}

main().catch(console.error);
