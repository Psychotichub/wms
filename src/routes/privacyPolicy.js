const express = require('express');

const router = express.Router();

const appName = process.env.APP_NAME || 'WMS';
const supportEmail = process.env.SUPPORT_EMAIL || process.env.EMAIL_USER || 'support@example.com';

router.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${appName} Privacy Policy</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
      main { max-width: 820px; margin: 24px auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 24px; }
      h1, h2 { margin-top: 0; }
      p, li { line-height: 1.6; }
      code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; }
    </style>
  </head>
  <body>
    <main>
      <h1>${appName} Privacy Policy</h1>
      <p><strong>Effective date:</strong> ${new Date().toISOString().slice(0, 10)}</p>

      <p>
        This Privacy Policy explains how ${appName} collects, uses, and protects your information when you use our app.
      </p>

      <h2>Information We Collect</h2>
      <ul>
        <li>Account information (name, email, role, company/site assignment).</li>
        <li>Operational data you create in the app (tasks, reports, attendance records, notifications).</li>
        <li>Location data when location-based attendance features are enabled.</li>
        <li>Device and diagnostic information needed for app security and reliability.</li>
      </ul>

      <h2>How We Use Information</h2>
      <ul>
        <li>To provide attendance, task, and reporting functionality.</li>
        <li>To improve app reliability, notifications, and security.</li>
        <li>To comply with legal requirements and prevent abuse.</li>
      </ul>

      <h2>Data Sharing</h2>
      <p>
        We do not sell personal data. Data may be shared with service providers required to operate the app
        (for example hosting, notifications, and email delivery) under appropriate safeguards.
      </p>

      <h2>Data Retention and Deletion</h2>
      <p>
        Data is retained as needed for operations, legal obligations, and security. You can request account deletion
        through the app flow or by contacting support.
      </p>

      <h2>Your Rights</h2>
      <p>
        Depending on your jurisdiction, you may have rights to access, correct, export, or delete your data.
      </p>

      <h2>Contact</h2>
      <p>
        For privacy-related questions, contact us at <a href="mailto:${supportEmail}">${supportEmail}</a>.
      </p>
    </main>
  </body>
</html>`);
});

module.exports = router;
