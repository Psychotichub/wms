const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const dbConnect = require('./config/db');
const authRoutes = require('./routes/auth');
const reportRoutes = require('./routes/reports');
const materialRoutes = require('./routes/materials');
const receivedRoutes = require('./routes/received');
const panelRoutes = require('./routes/panels');
const userRoutes = require('./routes/users');
const settingsRoutes = require('./routes/settings');
const employeeRoutes = require('./routes/employees');
const timeTrackingRoutes = require('./routes/timeTracking');
const notificationRoutes = require('./routes/notifications');
const locationRoutes = require('./routes/locations');
const { router: deviceRoutes } = require('./routes/devices');

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

dbConnect();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'wms-backend' });
});

app.use('/api/auth', authRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/received', receivedRoutes);
app.use('/api/panels', panelRoutes);
app.use('/api/users', userRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/time', timeTrackingRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/devices', deviceRoutes);

app.use((err, _req, res, _next) => {
  // Generic error handler to avoid leaking details
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`WMS backend running on http://localhost:${port}`);
});

