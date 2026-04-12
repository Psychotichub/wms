/**
 * Demo data for local development. Opt-in only.
 *
 * Usage (from backend/):
 *   RUN_SEED=true npm run seed
 *
 * Refuses production unless ALLOW_PRODUCTION_SEED=true as well.
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config();
const appEnv = (process.env.APP_ENV || 'development').toLowerCase();
const envFile = path.resolve(process.cwd(), `.env.${appEnv}`);
if (appEnv !== 'production' && fs.existsSync(envFile)) {
  dotenv.config({ path: envFile, override: true });
}

const isProd =
  appEnv === 'production' ||
  appEnv === 'prod' ||
  (process.env.NODE_ENV || '').toLowerCase() === 'production';

if (process.env.RUN_SEED !== 'true') {
  console.error('Refusing to run: set RUN_SEED=true (see backend/scripts/seed.js).');
  process.exit(1);
}

if (isProd && process.env.ALLOW_PRODUCTION_SEED !== 'true') {
  console.error('Refusing to seed production. Set ALLOW_PRODUCTION_SEED=true if you really mean it.');
  process.exit(1);
}

const mongoose = require('mongoose');
const dbConnect = require('../src/config/db');
const User = require('../src/models/User');
const Material = require('../src/models/Material');

const company = process.env.SEED_COMPANY || 'Demo Corp';
const site = process.env.SEED_SITE || 'main';
const seedPassword = process.env.SEED_PASSWORD || 'DemoSeed#1A';
const adminEmail = (process.env.SEED_ADMIN_EMAIL || 'admin@demo.local').toLowerCase();
const userEmail = (process.env.SEED_USER_EMAIL || 'user@demo.local').toLowerCase();

async function upsertUser({ name, email, role }) {
  let user = await User.findOne({ email });
  if (user) {
    user.name = name;
    user.company = company;
    user.site = site;
    user.sites = [site];
    user.role = role;
    user.isEmailVerified = true;
    user.createdByAdmin = true;
    user.password = seedPassword;
    await user.save();
    return { user, created: false };
  }
  user = new User({
    name,
    email,
    password: seedPassword,
    company,
    site,
    sites: [site],
    role,
    isEmailVerified: true,
    createdByAdmin: true
  });
  await user.save();
  return { user, created: true };
}

async function upsertSampleMaterial(createdById) {
  const name = 'Sample Material';
  const existing = await Material.findOne({ name, company, site });
  if (existing) {
    return { material: existing, created: false };
  }
  const material = await Material.create({
    name,
    quantity: 10,
    unit: 'pcs',
    materialPrice: 1,
    labourPrice: 0,
    price: 1,
    company,
    site,
    createdBy: createdById
  });
  return { material, created: true };
}

async function main() {
  await dbConnect();
  const adminResult = await upsertUser({
    name: 'Demo Admin',
    email: adminEmail,
    role: 'admin'
  });
  const userResult = await upsertUser({
    name: 'Demo User',
    email: userEmail,
    role: 'user'
  });
  const matResult = await upsertSampleMaterial(adminResult.user._id);

  console.log(
    JSON.stringify(
      {
        admin: { email: adminEmail, created: adminResult.created },
        user: { email: userEmail, created: userResult.created },
        material: { name: matResult.material.name, created: matResult.created },
        company,
        site
      },
      null,
      2
    )
  );
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
