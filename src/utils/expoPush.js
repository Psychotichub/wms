const { Expo } = require('expo-server-sdk');

// Expo SDK works with Node's global fetch (Node 18+). Your environment is Node 24.
const expo = new Expo();

async function sendExpoPushNotification({ to, title, body, data }) {
  if (!to) {
    throw new Error('Missing Expo push token');
  }
  if (!Expo.isExpoPushToken(to)) {
    throw new Error(`Invalid Expo push token: ${to}`);
  }

  const messages = [
    {
      to,
      title,
      body,
      data,
      sound: 'default',
      priority: 'high',
    },
  ];

  const chunks = expo.chunkPushNotifications(messages);
  const tickets = [];
  for (const chunk of chunks) {
    // eslint-disable-next-line no-await-in-loop
    const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
    tickets.push(...ticketChunk);
  }

  return tickets;
}

module.exports = { sendExpoPushNotification };


