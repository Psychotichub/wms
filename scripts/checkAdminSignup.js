const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

const baseDir = path.resolve(__dirname, '..');
process.chdir(baseDir);

// Load env the same way as server.js
dotenv.config();
const appEnv = (process.env.APP_ENV || 'development').toLowerCase();
const envFile = path.resolve(process.cwd(), `.env.${appEnv}`);
if (appEnv !== 'production' && fs.existsSync(envFile)) {
  dotenv.config({ path: envFile, override: true });
}

const ADMIN_CODE = process.env.ADMIN_SIGNUP_CODE;
const API_URL = process.env.API_URL || 'http://localhost:4000';

const makeRandomEmail = () =>
  `admin-check-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`;

const run = async () => {
  console.log('Env check:', {
    appEnv,
    envFile: fs.existsSync(envFile) ? envFile : null,
    adminCodeConfigured: Boolean(ADMIN_CODE),
    adminCodeLength: ADMIN_CODE ? ADMIN_CODE.length : 0,
    apiUrl: API_URL
  });

  if (!ADMIN_CODE) {
    console.error('ADMIN_SIGNUP_CODE is not set. Aborting.');
    process.exit(1);
  }

  const payload = {
    name: 'Admin Check',
    email: makeRandomEmail(),
    password: 'Password123!',
    company: 'TestCo',
    site: 'TestSite',
    adminCode: ADMIN_CODE
  };

  const response = await fetch(`${API_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  console.log('Signup response:', {
    status: response.status,
    role: data?.user?.role,
    adminCodeStatus: data?.adminCodeStatus || null,
    message: data?.message || null,
  });
};

run().catch((err) => {
  console.error('Admin signup check failed:', err);
  process.exit(1);
});
