const Attendance = require('../models/Attendance');
const logger = require('../config/logger').child({ module: 'staleCheckout' });

const MAX_ACTIVE_HOURS = 14;

async function checkoutStaleAttendance() {
  const cutoff = new Date(Date.now() - MAX_ACTIVE_HOURS * 60 * 60 * 1000);

  const staleRecords = await Attendance.find({
    status: 'active',
    clockInTime: { $lt: cutoff },
  });

  if (staleRecords.length === 0) {
    return { checked: 0, checkedOut: 0 };
  }

  let checkedOut = 0;
  for (const record of staleRecords) {
    try {
      record.clockOutTime = new Date();
      record.status = 'completed';
      record.isManualCheckout = false;
      record.isAutoCheckout = true;
      record.notes = (record.notes ? record.notes + ' | ' : '') +
        `Auto-checkout: active for over ${MAX_ACTIVE_HOURS}h`;
      record.calculateTotalHours();
      await record.save();
      checkedOut++;
    } catch (err) {
      logger.error({ err, attendanceId: record._id }, 'Failed to auto-checkout stale record');
    }
  }

  return { checked: staleRecords.length, checkedOut };
}

module.exports = { checkoutStaleAttendance };
