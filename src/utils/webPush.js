const webpush = require('web-push');

let configured = false;

function configureWebPush() {
  if (configured) return;
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_SUBJECT || 'mailto:admin@example.com';

  if (!publicKey || !privateKey) {
    // Not configured (optional feature)
    configured = true;
    return;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

async function sendWebPushNotification({ subscription, payload }) {
  configureWebPush();
  if (!process.env.WEB_PUSH_VAPID_PUBLIC_KEY || !process.env.WEB_PUSH_VAPID_PRIVATE_KEY) {
    throw new Error('Web Push is not configured (missing VAPID keys)');
  }
  if (!subscription) {
    throw new Error('Missing web push subscription');
  }

  return await webpush.sendNotification(subscription, payload);
}

module.exports = {
  sendWebPushNotification,
};


