const express = require('express');
const router = express.Router();
const TimeEntry = require('../models/TimeEntry');
const Attendance = require('../models/Attendance');
const { authenticateToken, requireActiveSite } = require('../middleware/auth');
const { validate, z } = require('../middleware/validation');

// Use shared JWT auth middleware
const requireAuth = [authenticateToken, requireActiveSite];

const idParamsSchema = z.object({
  id: z.string().min(1)
});

const startSchema = z.object({
  taskId: z.string().optional(),
  taskType: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.any()).optional(),
  isBillable: z.union([z.boolean(), z.string()]).optional(),
  location: z.any().optional()
});

const stopSchema = z.object({
  notes: z.string().optional(),
  location: z.any().optional()
});

const manualSchema = z.object({
  taskId: z.string().optional(),
  taskType: z.string().optional(),
  description: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  category: z.string().optional(),
  tags: z.array(z.any()).optional(),
  isBillable: z.union([z.boolean(), z.string()]).optional(),
  notes: z.string().optional()
});

const approveSchema = z.object({
  notes: z.string().optional()
});

const rejectSchema = z.object({
  reason: z.string().min(1)
});

const getTodayStart = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

const requireCheckedIn = async (req, res, next) => {
  try {
    const employeeId = req.user?.id || req.user?.userId;
    if (!employeeId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const today = getTodayStart();
    const activeAttendance = await Attendance.findOne({
      employee: employeeId,
      status: 'active',
      date: today
    });

    if (!activeAttendance) {
      return res.status(403).json({ error: 'Check in required to start work' });
    }

    return next();
  } catch (error) {
    console.error('Error validating attendance for time tracking:', error);
    return res.status(500).json({ error: 'Failed to validate attendance' });
  }
};

// Middleware to check if user can access employee's time data
const canAccessEmployeeTime = (req, res, next) => {
  const user = req.user || {};
  const isAdmin = user.role === 'admin' || user.role === 'manager';
  const targetEmployeeId = req.query.employeeId;

  // Allow admins/managers to view any employee
  if (isAdmin) return next();

  // If no target specified, assume current user
  if (!targetEmployeeId) return next();

  // Otherwise, only allow if target matches current user
  if ((user.id || user.userId)?.toString() === targetEmployeeId?.toString()) {
    return next();
  }

  return res.status(403).json({ error: 'Access denied' });
};

// POST /api/time/start - Start time tracking
router.post('/start', requireAuth, requireCheckedIn, validate(startSchema), async (req, res) => {
  try {
    const { taskId, taskType, description, category, tags, isBillable, location } = req.data;
    const employeeId = req.user?.id || req.user?.userId;

    if (!employeeId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Check if there's already an active time entry for this employee
    const activeEntry = await TimeEntry.findOne({
      employee: employeeId,
      status: 'active'
    });

    if (activeEntry) {
      return res.status(400).json({
        error: 'Time tracking already active',
        activeEntry
      });
    }

    const timeEntry = new TimeEntry({
      employee: employeeId,
      taskId,
      taskType,
      description,
      startTime: new Date(),
      category: category || 'work',
      tags: tags || [],
      isBillable: isBillable !== false,
      location
    });

    await timeEntry.save();
    await timeEntry.populate('employee', 'name email');

    res.status(201).json({
      timeEntry,
      message: 'Time tracking started successfully'
    });
  } catch (error) {
    console.error('Error starting time tracking:', error);
    res.status(500).json({ error: 'Failed to start time tracking' });
  }
});

// POST /api/time/stop - Stop active time tracking
router.post('/stop', requireAuth, validate(stopSchema), async (req, res) => {
  try {
    const { notes, location } = req.data;
    const employeeId = req.user?.id || req.user?.userId;

    if (!employeeId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const activeEntry = await TimeEntry.findOne({
      employee: employeeId,
      status: 'active'
    });

    if (!activeEntry) {
      return res.status(404).json({ error: 'No active time tracking found' });
    }

    await activeEntry.complete(notes);

    if (location) {
      activeEntry.location = location;
      await activeEntry.save();
    }

    await activeEntry.populate('employee', 'name email');

    res.json({
      timeEntry: activeEntry,
      message: 'Time tracking stopped successfully'
    });
  } catch (error) {
    console.error('Error stopping time tracking:', error);
    res.status(500).json({ error: 'Failed to stop time tracking' });
  }
});

// GET /api/time/active - Get active time entry for current user
router.get('/active', requireAuth, async (req, res) => {
  try {
    const employeeId = req.user?.id || req.user?.userId;

    if (!employeeId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const activeEntry = await TimeEntry.findOne({
      employee: employeeId,
      status: 'active'
    }).populate('employee', 'name email');

    if (!activeEntry) {
      return res.json({ activeEntry: null });
    }

    // Calculate current duration
    const now = new Date();
    const currentDuration = Math.floor((now - activeEntry.startTime) / (1000 * 60)); // minutes

    res.json({
      activeEntry,
      currentDuration,
      formattedCurrentDuration: `${Math.floor(currentDuration / 60)}h ${currentDuration % 60}m`
    });
  } catch (error) {
    console.error('Error fetching active time entry:', error);
    res.status(500).json({ error: 'Failed to fetch active time entry' });
  }
});

// POST /api/time/manual - Create manual time entry
router.post('/manual', requireAuth, requireCheckedIn, validate(manualSchema), async (req, res) => {
  try {
    const { taskId, taskType, description, startTime, endTime, category, tags, isBillable, notes } = req.data;
    const employeeId = req.user?.id;

    if (!employeeId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const timeEntry = new TimeEntry({
      employee: employeeId,
      taskId,
      taskType,
      description,
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      category: category || 'work',
      tags: tags || [],
      isBillable: isBillable !== false,
      isManual: true,
      notes,
      status: 'completed'
    });

    timeEntry.calculateDuration();
    await timeEntry.save();
    await timeEntry.populate('employee', 'name email');

    res.status(201).json({
      timeEntry,
      message: 'Manual time entry created successfully'
    });
  } catch (error) {
    console.error('Error creating manual time entry:', error);
    res.status(500).json({ error: 'Failed to create manual time entry' });
  }
});

// GET /api/time/entries - Get time entries with filtering
router.get('/entries', requireAuth, canAccessEmployeeTime, async (req, res) => {
  try {
    const {
      employeeId,
      startDate,
      endDate,
      status,
      category,
      taskType,
      page = 1,
      limit = 20
    } = req.query;

    const query = {};

    // Filter by employee (for managers/admins)
    if (employeeId) {
      query.employee = employeeId;
    } else {
      // If no employeeId specified, use current user's ID
      query.employee = req.user?.id || req.user?.userId;
    }

    // Date range filter
    if (startDate && endDate) {
      query.startTime = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    // Status filter
    if (status) {
      query.status = status;
    }

    // Category filter
    if (category) {
      query.category = category;
    }

    // Task type filter
    if (taskType) {
      query.taskType = taskType;
    }

    const timeEntries = await TimeEntry.find(query)
      .populate('employee', 'name email hourlyRate')
      .populate('approvedBy', 'name')
      .sort({ startTime: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await TimeEntry.countDocuments(query);

    // Calculate totals
    const totals = await TimeEntry.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalMinutes: { $sum: '$duration' },
          totalOvertimeHours: { $sum: '$overtime.overtimeHours' },
          totalEntries: { $sum: 1 }
        }
      }
    ]);

    res.json({
      entries: timeEntries,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      totals: totals[0] || {
        totalMinutes: 0,
        totalOvertimeHours: 0,
        totalEntries: 0
      }
    });
  } catch (error) {
    console.error('Error fetching time entries:', error);
    res.status(500).json({ error: 'Failed to fetch time entries' });
  }
});

// PUT /api/time/entries/:id/approve - Approve time entry
router.put(
  '/entries/:id/approve',
  requireAuth,
  validate(idParamsSchema, { source: 'params' }),
  validate(approveSchema),
  async (req, res) => {
  try {
    const { notes } = req.data;
    const approverId = req.user?.id;

    const timeEntry = await TimeEntry.findById(req.params.id);

    if (!timeEntry) {
      return res.status(404).json({ error: 'Time entry not found' });
    }

    timeEntry.status = 'approved';
    timeEntry.approvedBy = approverId;
    timeEntry.approvedAt = new Date();

    if (notes) {
      timeEntry.notes = notes;
    }

    await timeEntry.save();
    await timeEntry.populate('employee', 'name email');
    await timeEntry.populate('approvedBy', 'name');

    res.json({
      timeEntry,
      message: 'Time entry approved successfully'
    });
  } catch (error) {
    console.error('Error approving time entry:', error);
    res.status(500).json({ error: 'Failed to approve time entry' });
  }
});

// PUT /api/time/entries/:id/reject - Reject time entry
router.put(
  '/entries/:id/reject',
  requireAuth,
  validate(idParamsSchema, { source: 'params' }),
  validate(rejectSchema),
  async (req, res) => {
  try {
    const { reason } = req.data;
    const approverId = req.user?.id;

    const timeEntry = await TimeEntry.findById(req.params.id);

    if (!timeEntry) {
      return res.status(404).json({ error: 'Time entry not found' });
    }

    timeEntry.status = 'rejected';
    timeEntry.approvedBy = approverId;
    timeEntry.approvedAt = new Date();
    timeEntry.rejectionReason = reason;

    await timeEntry.save();
    await timeEntry.populate('employee', 'name email');
    await timeEntry.populate('approvedBy', 'name');

    res.json({
      timeEntry,
      message: 'Time entry rejected successfully'
    });
  } catch (error) {
    console.error('Error rejecting time entry:', error);
    res.status(500).json({ error: 'Failed to reject time entry' });
  }
});

// GET /api/time/timesheet - Get timesheet for date range
router.get('/timesheet', requireAuth, canAccessEmployeeTime, async (req, res) => {
  try {
    const { employeeId, startDate, endDate } = req.query;

    const targetEmployeeId = employeeId || req.user?.id;

    if (!targetEmployeeId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start date and end date are required' });
    }

    const timesheet = await TimeEntry.getTimesheet(
      targetEmployeeId,
      new Date(startDate),
      new Date(endDate)
    );

    // Group by date for better presentation
    const groupedByDate = timesheet.reduce((acc, entry) => {
      const date = entry.startTime.toISOString().split('T')[0];
      if (!acc[date]) {
        acc[date] = [];
      }
      acc[date].push(entry);
      return acc;
    }, {});

    // Calculate daily totals
    const dailyTotals = Object.keys(groupedByDate).map(date => {
      const entries = groupedByDate[date];
      const totalMinutes = entries.reduce((sum, entry) => sum + (entry.duration || 0), 0);
      const totalOvertimeHours = entries.reduce((sum, entry) => sum + (entry.overtime?.overtimeHours || 0), 0);

      return {
        date,
        entries: entries.length,
        totalHours: totalMinutes / 60,
        totalOvertimeHours,
        regularHours: (totalMinutes / 60) - totalOvertimeHours
      };
    });

    res.json({
      timesheet,
      groupedByDate,
      dailyTotals,
      summary: {
        totalEntries: timesheet.length,
        totalHours: dailyTotals.reduce((sum, day) => sum + day.totalHours, 0),
        totalOvertimeHours: dailyTotals.reduce((sum, day) => sum + day.totalOvertimeHours, 0),
        totalRegularHours: dailyTotals.reduce((sum, day) => sum + day.regularHours, 0)
      }
    });
  } catch (error) {
    console.error('Error fetching timesheet:', error);
    res.status(500).json({ error: 'Failed to fetch timesheet' });
  }
});

// GET /api/time/project/:projectId/:taskType - Get project time aggregation
router.get('/project/:projectId/:taskType', requireAuth, async (req, res) => {
  try {
    const { projectId, taskType } = req.params;

    const projectTime = await TimeEntry.getProjectTime(projectId, taskType);

    res.json({
      projectId,
      taskType,
      timeByEmployee: projectTime
    });
  } catch (error) {
    console.error('Error fetching project time:', error);
    res.status(500).json({ error: 'Failed to fetch project time' });
  }
});

module.exports = router;
