const express = require('express');
const crypto = require('crypto');
const User = require('../models/User');
const Employee = require('../models/Employee');
const Todo = require('../models/Todo');
const Task = require('../models/Task');
const DailyReport = require('../models/DailyReport');
const Notification = require('../models/Notification');
const NotificationPreferences = require('../models/NotificationPreferences');
const Material = require('../models/Material');
const Received = require('../models/Received');
const { authenticateToken } = require('../middleware/auth');
const { validate, z } = require('../middleware/validation');

const router = express.Router();

const deleteAccountSchema = z.object({
  password: z.string().min(1),
  confirmPhrase: z.literal('DELETE MY ACCOUNT')
});

router.get('/export', authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId)
      .select('-password -refreshTokens -emailVerificationToken -emailVerificationCode')
      .lean();
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const employee = await Employee.findOne({ user: userId }).lean();
    const employeeId = employee?._id;

    const [todos, tasks, reports, materialsCreated, receivedCreated, notifPrefs, notificationSample] =
      await Promise.all([
        Todo.find({ user: userId }).lean(),
        employeeId
          ? Task.find({
              $or: [{ assignedTo: employeeId }, { assignedBy: userId }]
            })
              .limit(500)
              .lean()
          : Task.find({ assignedBy: userId }).limit(500).lean(),
        DailyReport.find({ createdBy: userId }).limit(500).lean(),
        Material.find({ createdBy: userId }).limit(500).lean(),
        Received.find({ createdBy: userId }).limit(500).lean(),
        employeeId
          ? NotificationPreferences.findOne({ user: employeeId }).lean()
          : Promise.resolve(null),
        employeeId
          ? Notification.find({ recipient: employeeId }).sort({ createdAt: -1 }).limit(200).lean()
          : Promise.resolve([])
      ]);

    res.json({
      exportedAt: new Date().toISOString(),
      user,
      employee,
      todos,
      tasks,
      dailyReports: reports,
      materialsCreated: materialsCreated,
      receivedRecords: receivedCreated,
      notificationPreferences: notifPrefs,
      notifications: notificationSample
    });
  } catch (err) {
    next(err);
  }
});

router.post('/delete-account', authenticateToken, validate(deleteAccountSchema), async (req, res, next) => {
  try {
    const { password } = req.data;
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (user.isDeleted) {
      return res.status(400).json({ message: 'Account already deactivated' });
    }

    const valid = await user.comparePassword(password);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid password' });
    }

    await Employee.updateMany({ user: user._id }, { $unset: { user: '' } });

    const anonEmail = `deleted_${user._id}_${Date.now()}@wms-deleted.invalid`;
    user.name = 'Deleted user';
    user.email = anonEmail;
    user.password = crypto.randomBytes(32).toString('hex');
    user.isDeleted = true;
    user.deletedAt = new Date();
    user.refreshTokens = [];
    user.boundDevices = [];
    user.site = null;
    user.sites = [];
    await user.save();

    res.json({ message: 'Account has been deactivated and personal data anonymized.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
