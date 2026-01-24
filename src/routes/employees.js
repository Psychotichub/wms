const express = require('express');
const router = express.Router();
const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const Location = require('../models/Location');
const User = require('../models/User');
const DailyReport = require('../models/DailyReport');
const Notification = require('../models/Notification');
const NotificationPreferences = require('../models/NotificationPreferences');
const { validateDeviceBinding } = require('./devices');
const { authenticateToken, requireActiveSite } = require('../middleware/auth');
const { validate, z } = require('../middleware/validation');

// Use shared JWT auth middleware
const requireAuth = [authenticateToken, requireActiveSite];

const idParamsSchema = z.object({
  id: z.string().min(1)
});

const employeeCreateSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  role: z.string().optional(),
  department: z.string().optional(),
  skills: z.array(z.any()).optional(),
  hourlyRate: z.union([z.number(), z.string()]).optional(),
  manager: z.string().optional(),
  address: z.any().optional(),
  emergencyContact: z.any().optional(),
  password: z.string().min(6).optional() // Password to create User account
});

const employeeUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  role: z.string().optional(),
  department: z.string().optional(),
  skills: z.array(z.any()).optional(),
  hourlyRate: z.union([z.number(), z.string()]).optional(),
  isActive: z.union([z.boolean(), z.string()]).optional(),
  manager: z.string().optional(),
  address: z.any().optional(),
  emergencyContact: z.any().optional(),
  password: z.string().min(6).optional() // Password to create/update User account
});

const geofenceCheckInSchema = z.object({
  locationId: z.string().optional(),
  locationName: z.string().optional(),
  latitude: z.union([z.number(), z.string()]),
  longitude: z.union([z.number(), z.string()]),
  accuracy: z.union([z.number(), z.string()]).optional(),
  timestamp: z.string().optional(),
  notes: z.string().optional(),
  deviceInfo: z.any().optional()
});

const geofenceCheckOutSchema = z.object({
  locationId: z.string().optional(),
  latitude: z.union([z.number(), z.string()]).optional(),
  longitude: z.union([z.number(), z.string()]).optional(),
  accuracy: z.union([z.number(), z.string()]).optional(),
  timestamp: z.string().optional()
});

// Middleware to check if user has admin/manager permissions
const requireManager = (req, res, next) => {
  // This should check user role from your auth system
  // For now, we'll assume role checking is handled elsewhere
  next();
};

// GET /api/employees - Get all employees with optional filtering
router.get('/', requireAuth, async (req, res) => {
  try {
    const {
      role,
      department,
      isActive = 'true',
      search,
      page = 1,
      limit = 20
    } = req.query;

    const query = {};

    // Filter by active status
    if (isActive !== 'all') {
      query.isActive = isActive === 'true';
    }

    // Filter by role
    if (role && role !== 'all') {
      query.role = role;
    }

    // Filter by department
    if (department && department !== 'all') {
      query.department = department;
    }

    // Search by name or email
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const employees = await Employee.find(query)
      .populate('manager', 'name email')
      .sort({ name: 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('-__v');

    const total = await Employee.countDocuments(query);

    res.json({
      employees,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching employees:', error);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

// GET /api/employees/:id - Get single employee with productivity metrics
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id)
      .populate('manager', 'name email')
      .populate({
        path: 'manager',
        select: 'name'
      });

    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // Get recent attendance records for productivity calculation
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentAttendance = await Attendance.find({
      employee: employee._id,
      date: { $gte: thirtyDaysAgo }
    }).sort({ date: -1 });

    // Calculate productivity metrics
    const totalHours = recentAttendance.reduce((sum, record) => sum + (record.totalHours || 0), 0);
    const averageHoursPerDay = recentAttendance.length > 0 ? totalHours / recentAttendance.length : 0;

    res.json({
      employee,
      recentAttendance: recentAttendance.slice(0, 10), // Last 10 records
      productivityStats: {
        totalHoursWorked: totalHours,
        averageHoursPerDay: averageHoursPerDay,
        attendanceDays: recentAttendance.length
      }
    });
  } catch (error) {
    console.error('Error fetching employee:', error);
    res.status(500).json({ error: 'Failed to fetch employee' });
  }
});

// POST /api/employees - Create new employee (and optionally User account)
router.post('/', requireAuth, requireManager, validate(employeeCreateSchema), async (req, res) => {
  try {
    const { name, email, phone, role, department, skills, hourlyRate, manager, address, emergencyContact, password } = req.data;
    const normalizedEmail = email.toLowerCase();

    // Check if email already exists in Employee
    const existingEmployee = await Employee.findOne({ email: normalizedEmail });
    if (existingEmployee) {
      return res.status(400).json({ error: 'Employee with this email already exists' });
    }

    // Check if email already exists in User (if password provided)
    let userAccount = null;
    if (password) {
      const existingUser = await User.findOne({ email: normalizedEmail });
      if (existingUser) {
        return res.status(400).json({ error: 'User account with this email already exists. Employee can be created without password, or link to existing user.' });
      }

      // Create User account
      const company = req.user.company;
      const site = req.user.site;
      
      userAccount = await User.create({
        name,
        email: normalizedEmail,
        password,
        role: 'user', // Employees get 'user' role by default
        company,
        site
      });
    }

    // Create Employee
    const employee = new Employee({
      name,
      email: normalizedEmail,
      phone,
      role: role || 'worker',
      department,
      skills: skills || [],
      hourlyRate: hourlyRate || 0,
      manager,
      address,
      emergencyContact,
      user: userAccount ? userAccount._id : undefined
    });

    await employee.save();

    // Populate manager and user info in response
    await employee.populate('manager', 'name email');
    if (userAccount) {
      await employee.populate('user', 'name email role');
    }

    res.status(201).json({
      employee,
      userCreated: !!userAccount,
      message: userAccount 
        ? 'Employee and user account created successfully' 
        : 'Employee created successfully (no user account - employee cannot log in)'
    });
  } catch (error) {
    console.error('Error creating employee:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to create employee' });
  }
});

// PUT /api/employees/:id - Update employee
router.put(
  '/:id',
  requireAuth,
  requireManager,
  validate(idParamsSchema, { source: 'params' }),
  validate(employeeUpdateSchema),
  async (req, res) => {
  try {
    const { name, email, phone, role, department, skills, hourlyRate, isActive, manager, address, emergencyContact, password } = req.data;

    const employee = await Employee.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // Check if email change conflicts with existing employee
    const normalizedEmail = email ? email.toLowerCase() : employee.email;
    if (email && normalizedEmail !== employee.email) {
      const existingEmployee = await Employee.findOne({
        email: normalizedEmail,
        _id: { $ne: req.params.id }
      });
      if (existingEmployee) {
        return res.status(400).json({ error: 'Employee with this email already exists' });
      }
    }

    // Handle User account creation/update if password provided
    let userCreated = false;
    if (password) {
      if (employee.user) {
        // Update existing User account password
        const user = await User.findById(employee.user);
        if (user) {
          user.password = password;
          await user.save();
        }
      } else {
        // Create new User account
        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser) {
          // Link to existing User
          employee.user = existingUser._id;
        } else {
          // Create new User
          const userAccount = await User.create({
            name: name || employee.name,
            email: normalizedEmail,
            password,
            role: 'user',
            company: req.user.company,
            site: req.user.site
          });
          employee.user = userAccount._id;
          userCreated = true;
        }
      }
    }

    // Update employee fields
    if (name !== undefined) employee.name = name;
    if (email !== undefined) employee.email = normalizedEmail;
    if (phone !== undefined) employee.phone = phone;
    if (role !== undefined) employee.role = role;
    if (department !== undefined) employee.department = department;
    if (skills !== undefined) employee.skills = skills;
    if (hourlyRate !== undefined) employee.hourlyRate = hourlyRate;
    if (isActive !== undefined) employee.isActive = isActive;
    if (manager !== undefined) employee.manager = manager;
    if (address !== undefined) employee.address = address;
    if (emergencyContact !== undefined) employee.emergencyContact = emergencyContact;

    await employee.save();
    await employee.populate('manager', 'name email');
    if (employee.user) {
      await employee.populate('user', 'name email role');
    }

    res.json({
      employee,
      userCreated,
      message: password && userCreated 
        ? 'Employee updated and user account created successfully' 
        : password && !userCreated
        ? 'Employee updated and user password updated successfully'
        : 'Employee updated successfully'
    });
  } catch (error) {
    console.error('Error updating employee:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to update employee' });
  }
});

// DELETE /api/employees/:id - Deactivate employee (soft delete)
router.delete('/:id', requireAuth, requireManager, async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    employee.isActive = false;
    await employee.save();

    res.json({ message: 'Employee deactivated successfully' });
  } catch (error) {
    console.error('Error deactivating employee:', error);
    res.status(500).json({ error: 'Failed to deactivate employee' });
  }
});

// POST /api/employees/:id/clock-in - Clock in employee
router.post('/:id/clock-in', requireAuth, async (req, res) => {
  try {
    const { location, notes } = req.body;
    const employeeId = req.params.id;

    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // Check if employee is already clocked in
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existingAttendance = await Attendance.findOne({
      employee: employeeId,
      date: today,
      status: { $in: ['active', 'on_break'] }
    });

    if (existingAttendance) {
      return res.status(400).json({
        error: 'Employee is already clocked in',
        attendance: existingAttendance
      });
    }

    const attendance = new Attendance({
      employee: employeeId,
      date: today,
      clockInTime: new Date(),
      location,
      notes,
      status: 'active'
    });

    await attendance.save();
    await attendance.populate('employee', 'name email');

    res.status(201).json({
      attendance,
      message: 'Clocked in successfully'
    });
  } catch (error) {
    console.error('Error clocking in:', error);
    res.status(500).json({ error: 'Failed to clock in' });
  }
});

// POST /api/employees/:id/clock-out - Clock out employee
router.post('/:id/clock-out', requireAuth, async (req, res) => {
  try {
    const { location, notes } = req.body;
    const employeeId = req.params.id;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await Attendance.findOne({
      employee: employeeId,
      date: today,
      status: 'active'
    });

    if (!attendance) {
      return res.status(404).json({ error: 'No active clock-in found for today' });
    }

    await attendance.clockOut(location, notes);
    await attendance.populate('employee', 'name email');

    res.json({
      attendance,
      message: 'Clocked out successfully'
    });
  } catch (error) {
    console.error('Error clocking out:', error);
    res.status(500).json({ error: 'Failed to clock out' });
  }
});

// GET /api/employees/:id/attendance - Get employee attendance records
router.get('/:id/attendance', requireAuth, async (req, res) => {
  try {
    const { startDate, endDate, page = 1, limit = 20 } = req.query;

    const query = { employee: req.params.id };

    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const attendance = await Attendance.find(query)
      .populate('employee', 'name email')
      .populate('approvedBy', 'name')
      .sort({ date: -1, clockInTime: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Attendance.countDocuments(query);

    res.json({
      attendance,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching attendance:', error);
    res.status(500).json({ error: 'Failed to fetch attendance records' });
  }
});

// POST /api/employees/attendance/checkin - Geofence-based check-in
router.post('/attendance/checkin', requireAuth, validate(geofenceCheckInSchema), async (req, res) => {
  try {
    const { locationId, locationName, latitude, longitude, accuracy, timestamp, notes, deviceInfo } = req.data;

    // Validate required fields
    if (!latitude || !longitude) {
      return res.status(400).json({
        error: 'Location coordinates are required',
        success: false
      });
    }

    // Validate timestamp (prevent future timestamps and old timestamps)
    const checkInTime = timestamp ? new Date(timestamp) : new Date();
    const now = new Date();
    const timeDiff = Math.abs(now - checkInTime);

    // Reject timestamps more than 5 minutes in the future or past
    if (timeDiff > 5 * 60 * 1000) {
      return res.status(400).json({
        error: 'Invalid timestamp',
        success: false
      });
    }

    // Validate device binding if required
    const userId = req.user.id || req.user.userId;
    const orgId = req.user.organizationId || req.user.company || req.user.site;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required', success: false });
    }

    if (deviceInfo?.deviceId) {
      const deviceValidation = await validateDeviceBinding(userId, deviceInfo.deviceId, deviceInfo.deviceType);
      if (!deviceValidation.valid) {
        return res.status(403).json({
          error: deviceValidation.reason,
          success: false
        });
      }
    }

    // Check if user is already checked in
    const existingAttendance = await Attendance.findOne({
      employee: userId,
      status: 'active'
    });

    if (existingAttendance) {
      return res.status(400).json({
        error: 'Already checked in',
        attendance: existingAttendance,
        success: false
      });
    }

    // Validate location exists and user has access
    if (locationId) {
      const location = await Location.findOne({
        _id: locationId,
        organizationId: orgId,
        isActive: true
      });

      if (!location) {
        return res.status(400).json({
          error: 'Invalid location',
          success: false
        });
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Perform security validations
    const validationResult = await validateLocationData({
      latitude,
      longitude,
      accuracy,
      timestamp: checkInTime
    });

    const attendance = new Attendance({
      employee: userId,
      date: today,
      clockInTime: checkInTime,
      location: {
        locationId,
        locationName,
        latitude,
        longitude,
        accuracy,
        geofenceTriggered: true,
        ...validationResult.locationValidation
      },
      notes,
      status: 'active',
      deviceInfo,
      validationStatus: validationResult.isValid ? 'validated' : 'suspicious',
      validationReason: validationResult.reason
    });

    await attendance.save();

    res.status(201).json({
      attendance: {
        id: attendance._id,
        checkInTime: attendance.clockInTime,
        location: attendance.location,
        validationStatus: attendance.validationStatus
      },
      success: true,
      message: `Checked in to ${locationName}`
    });
  } catch (error) {
    console.error('Error during geofence check-in:', error);
    res.status(500).json({ error: 'Failed to check in', success: false });
  }
});

// POST /api/employees/attendance/checkout - Geofence-based check-out
router.post('/attendance/checkout', requireAuth, validate(geofenceCheckOutSchema), async (req, res) => {
  try {
    const {
      locationId,
      latitude,
      longitude,
      accuracy,
      timestamp: _timestamp
    } = req.data;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const userId = req.user.id || req.user.userId;
    const _orgId = req.user.organizationId || req.user.company || req.user.site;

    const attendance = await Attendance.findOne({
      employee: userId,
      date: today,
      status: 'active'
    });

    if (!attendance) {
      return res.status(404).json({
        error: 'No active check-in found',
        success: false
      });
    }

    // Update location info for check-out
    if (locationId) {
      attendance.location = {
        ...attendance.location,
        latitude,
        longitude,
        accuracy
      };
    }

    await attendance.clockOut();
    await attendance.populate('employee', 'name email');

    // Notify user if no daily report was created for today (once per day)
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(startOfDay);
      endOfDay.setDate(endOfDay.getDate() + 1);

      const hasReport = await DailyReport.exists({
        createdBy: userId,
        company: req.user.company,
        site: req.user.site,
        date: { $gte: startOfDay, $lt: endOfDay }
      });

      if (!hasReport) {
        const admins = await User.find({
          company: req.user.company,
          site: req.user.site,
          role: 'admin'
        }).select('_id');
        const recipientIds = Array.from(new Set([
          String(userId),
          ...admins.map((admin) => String(admin._id))
        ]));
        const employeeName = attendance.employee?.name || 'User';

        await Promise.all(
          recipientIds.map(async (recipientId) => {
            const alreadyNotified = await Notification.exists({
              recipient: recipientId,
              type: 'daily_report_missing',
              createdAt: { $gte: startOfDay, $lt: endOfDay }
            });
            if (alreadyNotified) return;
            const isSelf = String(recipientId) === String(userId);
            await NotificationPreferences.sendNotificationIfAllowed(recipientId, {
              recipient: recipientId,
              sender: userId,
              title: 'Daily report missing',
              message: isSelf
                ? 'You checked out without submitting a daily report for today.'
                : `${employeeName} checked out without submitting a daily report for today.`,
              type: 'daily_report_missing',
              priority: 'high',
              data: {
                date: startOfDay.toISOString().slice(0, 10),
                employeeId: String(userId)
              }
            });
          })
        );
      }
    } catch (notifyError) {
      console.error('Failed to send daily report reminder:', notifyError);
    }

    res.json({
      attendance: {
        id: attendance._id,
        checkInTime: attendance.clockInTime,
        checkOutTime: attendance.clockOutTime,
        totalHours: attendance.totalHours,
        location: attendance.location
      },
      success: true,
      message: 'Checked out successfully'
    });
  } catch (error) {
    console.error('Error during geofence check-out:', error);
    res.status(500).json({ error: 'Failed to check out', success: false });
  }
});

// GET /api/employees/attendance/current - Get current attendance status
router.get('/attendance/current', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;

    const attendance = await Attendance.findOne({
      employee: userId,
      status: 'active'
    }).populate('employee', 'name email');

    if (!attendance) {
      return res.json({
        isCheckedIn: false,
        currentAttendance: null,
        success: true
      });
    }

    res.json({
      isCheckedIn: true,
      currentAttendance: {
        id: attendance._id,
        checkInTime: attendance.clockInTime,
        location: attendance.location,
        elapsedTime: Date.now() - attendance.clockInTime.getTime(),
        validationStatus: attendance.validationStatus
      },
      success: true
    });
  } catch (error) {
    console.error('Error fetching current attendance:', error);
    res.status(500).json({ error: 'Failed to fetch current attendance', success: false });
  }
});

// GET /api/employees/active-locations - Get all active employees with their clock-in locations (for map view)
router.get('/active-locations', requireAuth, async (req, res) => {
  try {
    const orgId = req.user.organizationId || req.user.company || req.user.site;
    
    // Get all active attendance records with location data
    // Note: The employee field in Attendance actually stores User IDs, not Employee IDs
    const activeAttendances = await Attendance.find({
      status: 'active',
      'location.latitude': { $exists: true, $ne: null },
      'location.longitude': { $exists: true, $ne: null }
    })
      .select('employee clockInTime location')
      .lean();

    // Get unique user IDs from attendances
    const userIds = [...new Set(activeAttendances
      .map(a => a.employee)
      .filter(Boolean)
      .map(id => id.toString())
    )];

    // Fetch user data for all users
    const User = require('../models/User');
    const users = await User.find({ _id: { $in: userIds } })
      .select('name email role')
      .lean();

    // Create a map of user ID to user data
    const userMap = new Map(users.map(u => [u._id.toString(), u]));

    // Filter and map attendance records to location data
    const employeeLocations = activeAttendances
      .filter(attendance => {
        // Must have location data and valid employee/user reference
        return attendance.location?.latitude && 
               attendance.location?.longitude &&
               attendance.employee;
      })
      .map(attendance => {
        const userId = attendance.employee?.toString() || attendance.employee?._id?.toString();
        const user = userId ? userMap.get(userId) : null;
        
        return {
          employeeId: userId || null,
          employeeName: user?.name || 'Unknown',
          employeeRole: user?.role || 'user',
          latitude: attendance.location.latitude,
          longitude: attendance.location.longitude,
          locationName: attendance.location.locationName || 'Unknown Location',
          checkInTime: attendance.clockInTime,
          elapsedTime: Date.now() - new Date(attendance.clockInTime).getTime()
        };
      })
      .filter(loc => loc.employeeId !== null); // Remove any with invalid user IDs

    res.json({
      locations: employeeLocations,
      count: employeeLocations.length,
      success: true
    });
  } catch (error) {
    console.error('Error fetching active employee locations:', error);
    res.status(500).json({ 
      error: 'Failed to fetch active employee locations', 
      success: false,
      details: error.message 
    });
  }
});

// Enhanced location validation function
async function validateLocationData({ latitude, longitude, accuracy, speed, altitude, heading, deviceInfo }) {
  const validation = {
    isValid: true,
    reason: 'Location validated',
    locationValidation: {
      isMockLocation: false,
      accuracy,
      speed: speed || 0,
      altitude: altitude || 0,
      heading: heading || 0
    }
  };

  // Validate coordinates are reasonable
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    validation.isValid = false;
    validation.reason = 'Invalid coordinates';
    validation.locationValidation.isMockLocation = true;
    return validation;
  }

  // Enhanced accuracy checks
  if (!accuracy || accuracy < 0) {
    validation.isValid = false;
    validation.reason = 'Invalid GPS accuracy';
    return validation;
  }

  if (accuracy > 100) { // More than 100 meters accuracy
    validation.isValid = false;
    validation.reason = 'Poor GPS accuracy';
    return validation;
  }

  // Speed validation (impossible speeds > 100 km/h = ~27.8 m/s)
  if (speed && speed > 27.8) {
    validation.isValid = false;
    validation.reason = 'Impossible speed detected';
    validation.locationValidation.isMockLocation = true;
    return validation;
  }

  // Altitude validation (reasonable range -100 to 10000 meters)
  if (altitude && (altitude < -100 || altitude > 10000)) {
    validation.isValid = false;
    validation.reason = 'Invalid altitude';
    validation.locationValidation.isMockLocation = true;
    return validation;
  }

  // Mock location detection patterns (Android-specific)
  if (deviceInfo?.deviceType === 'android') {
    // Check for suspicious coordinate patterns
    const coordSum = Math.abs(latitude) + Math.abs(longitude);
    if (coordSum === 0) {
      validation.locationValidation.isMockLocation = true;
      validation.reason = 'Suspicious coordinates detected';
      validation.isValid = false;
      return validation;
    }

    // Check for exact coordinate matches that are commonly spoofed
    const commonSpoofCoords = [
      [0, 0], [37.4219983, -122.084], [40.7128, -74.0060] // Common fake locations
    ];

    for (const [lat, lon] of commonSpoofCoords) {
      if (Math.abs(latitude - lat) < 0.0001 && Math.abs(longitude - lon) < 0.0001) {
        validation.locationValidation.isMockLocation = true;
        validation.reason = 'Common mock location detected';
        validation.isValid = false;
        return validation;
      }
    }
  }

  // Check for rapid successive location changes (would be validated against previous attendance)
  // This is a basic implementation - could be enhanced with historical data

  return validation;
}

module.exports = router;
