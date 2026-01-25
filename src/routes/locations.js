const express = require('express');
const router = express.Router();
const Location = require('../models/Location');
const Attendance = require('../models/Attendance');
const { authenticateToken, requireAdmin, requireActiveSite } = require('../middleware/auth');
const { validate, z } = require('../middleware/validation');

const idParamsSchema = z.object({
  id: z.string().min(1)
});

const lonLatSchema = z.tuple([z.number(), z.number()]);

const locationCreateSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  coordinates: z.array(lonLatSchema).optional(),
  type: z.enum(['polygon', 'circle']).optional(),
  radius: z.union([z.number(), z.string()]).optional(),
  center: lonLatSchema.optional()
});

const locationUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().optional(),
  coordinates: z.array(lonLatSchema).optional(),
  type: z.enum(['polygon', 'circle']).optional(),
  radius: z.union([z.number(), z.string()]).optional(),
  center: lonLatSchema.optional(),
  isActive: z.union([z.boolean(), z.string()]).optional()
});

const attendanceHistoryQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  locationId: z.string().optional()
});

// Get all locations for the organization (Admin only, includes inactive)
router.get('/', authenticateToken, requireActiveSite, requireAdmin, async (req, res) => {
  try {
    const orgId = req.user.organizationId || req.user.company || req.user.site;
    const locations = await Location.find({
      organizationId: orgId
    })
      .select('name coordinates address type radius center isActive createdAt updatedAt')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    // Format for frontend consumption
    const formattedLocations = locations.map(location => ({
      id: location._id,
      name: location.name,
      address: location.address,
      coordinates: location.coordinates,
      type: location.type,
      radius: location.radius,
      center: location.center,
      isActive: location.isActive,
      createdAt: location.createdAt,
      updatedAt: location.updatedAt,
      createdBy: location.createdBy ? {
        name: location.createdBy.name,
        email: location.createdBy.email
      } : null
    }));

    res.json({ locations: formattedLocations, success: true });
  } catch (error) {
    console.error('Error fetching locations:', error);
    res.status(500).json({ error: 'Failed to fetch locations', success: false });
  }
});

// Get all geofences for the organization
router.get('/geofences', authenticateToken, requireActiveSite, async (req, res) => {
  try {
    const orgId = req.user.organizationId || req.user.company || req.user.site;
    const locations = await Location.find({
      organizationId: orgId,
      isActive: true
    }).select('name coordinates address type radius center');

    // Format for frontend consumption
    const geofences = locations.map(location => ({
      id: location._id,
      name: location.name,
      address: location.address,
      coordinates: location.coordinates,
      type: location.type,
      radius: location.radius,
      center: location.center
    }));

    res.json({ geofences, success: true });
  } catch (error) {
    console.error('Error fetching geofences:', error);
    res.status(500).json({ error: 'Failed to fetch geofences', success: false });
  }
});

// Create a new location/geofence (Admin only)
router.post('/', authenticateToken, requireActiveSite, requireAdmin, validate(locationCreateSchema), async (req, res) => {
  try {
    const { name, address, coordinates, type = 'polygon', radius, center } = req.data;
    const orgId = req.user.organizationId || req.user.company || req.user.site;
    const createdBy = req.user.id;

    if (!orgId || !createdBy) {
      return res.status(400).json({ error: 'Missing organization or user context', success: false });
    }

    // Validate polygon coordinates and size
    if (type === 'polygon') {
      if (!coordinates || coordinates.length < 3) {
        return res.status(400).json({
          error: 'Polygon requires at least 3 coordinate points',
          success: false
        });
      }

      // Validate polygon size (minimum 10m², maximum 1km²)
      const area = calculatePolygonArea(coordinates);
      if (area < 10) {
        return res.status(400).json({
          error: 'Polygon area too small (minimum 10m²)',
          success: false
        });
      }
      if (area > 1000000) {
        return res.status(400).json({
          error: 'Polygon area too large (maximum 1km²)',
          success: false
        });
      }

      // Validate coordinate bounds
      for (const coord of coordinates) {
        if (coord[0] < -180 || coord[0] > 180 || coord[1] < -90 || coord[1] > 90) {
          return res.status(400).json({
            error: 'Invalid coordinate bounds',
            success: false
          });
        }
      }
    }

    // Validate circle parameters and size
    if (type === 'circle') {
      if (!center || !radius) {
        return res.status(400).json({
          error: 'Circle requires center coordinates and radius',
          success: false
        });
      }

      // Validate circle size (minimum 5m radius, maximum 500m radius)
      if (radius < 5) {
        return res.status(400).json({
          error: 'Circle radius too small (minimum 5m)',
          success: false
        });
      }
      if (radius > 500) {
        return res.status(400).json({
          error: 'Circle radius too large (maximum 500m)',
          success: false
        });
      }
    }

    const coordsToSave = type === 'circle' ? [] : coordinates;

    const location = new Location({
      name,
      address,
      coordinates: coordsToSave,
      type,
      radius,
      center,
      createdBy,
      organizationId: orgId
    });

    await location.save();

    res.status(201).json({
      location: {
        id: location._id,
        name: location.name,
        address: location.address,
        coordinates: location.coordinates,
        type: location.type,
        radius: location.radius,
        center: location.center
      },
      success: true,
      message: 'Location created successfully'
    });
  } catch (error) {
    console.error('Error creating location:', error);
    res.status(500).json({ error: 'Failed to create location', success: false });
  }
});

// Update a location (Admin only)
router.put(
  '/:id',
  authenticateToken,
  requireActiveSite,
  requireAdmin,
  validate(idParamsSchema, { source: 'params' }),
  validate(locationUpdateSchema),
  async (req, res) => {
  try {
    const { name, address, coordinates, type, radius, center, isActive } = req.data;

    const orgId = req.user.organizationId || req.user.company || req.user.site;
    const coordsToSave = type === 'circle' ? [] : coordinates;

    const location = await Location.findOneAndUpdate(
      { _id: req.params.id, organizationId: orgId },
      {
        name,
        address,
        coordinates: coordsToSave,
        type,
        radius,
        center,
        isActive
      },
      { new: true }
    );

    if (!location) {
      return res.status(404).json({ error: 'Location not found', success: false });
    }

    res.json({
      location: {
        id: location._id,
        name: location.name,
        address: location.address,
        coordinates: location.coordinates,
        type: location.type,
        radius: location.radius,
        center: location.center,
        isActive: location.isActive
      },
      success: true,
      message: 'Location updated successfully'
    });
  } catch (error) {
    console.error('Error updating location:', error);
    res.status(500).json({ error: 'Failed to update location', success: false });
  }
});

// Delete a location (Admin only)
router.delete('/:id', authenticateToken, requireActiveSite, requireAdmin, validate(idParamsSchema, { source: 'params' }), async (req, res) => {
  try {
    const orgId = req.user.organizationId || req.user.company || req.user.site;
    const location = await Location.findOneAndUpdate(
      { _id: req.params.id, organizationId: orgId },
      { isActive: false },
      { new: true }
    );

    if (!location) {
      return res.status(404).json({ error: 'Location not found', success: false });
    }

    res.json({
      success: true,
      message: 'Location deactivated successfully'
    });
  } catch (error) {
    console.error('Error deleting location:', error);
    res.status(500).json({ error: 'Failed to delete location', success: false });
  }
});

// Get attendance history for current user with location info
router.get('/attendance/history', authenticateToken, requireActiveSite, validate(attendanceHistoryQuerySchema, { source: 'query' }), async (req, res) => {
  try {
    const { startDate, endDate, locationId } = req.data;

    let query = {
      employee: req.user.userId
    };

    if (startDate && endDate) {
      query.date = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    if (locationId) {
      query['location.locationId'] = locationId;
    }

    const attendanceRecords = await Attendance.find(query)
      .populate('location.locationId', 'name address')
      .sort({ date: -1, clockInTime: -1 })
      .limit(100);

    const formattedRecords = attendanceRecords.map(record => ({
      id: record._id,
      date: record.date,
      clockInTime: record.clockInTime,
      clockOutTime: record.clockOutTime,
      totalHours: record.totalHours,
      location: {
        name: record.location?.locationName || record.location?.locationId?.name,
        address: record.location?.address || record.location?.locationId?.address,
        latitude: record.location?.latitude,
        longitude: record.location?.longitude,
        geofenceTriggered: record.location?.geofenceTriggered
      },
      status: record.status,
      notes: record.notes
    }));

    res.json({
      records: formattedRecords,
      success: true
    });
  } catch (error) {
    console.error('Error fetching attendance history:', error);
    res.status(500).json({ error: 'Failed to fetch attendance history', success: false });
  }
});

// Check if user is currently checked in at any location
router.get('/attendance/current', authenticateToken, requireActiveSite, async (req, res) => {
  try {
    const currentAttendance = await Attendance.findOne({
      employee: req.user.userId,
      status: 'active'
    }).populate('location.locationId', 'name address');

    if (!currentAttendance) {
      return res.json({
        isCheckedIn: false,
        currentAttendance: null,
        success: true
      });
    }

    res.json({
      isCheckedIn: true,
      currentAttendance: {
        id: currentAttendance._id,
        checkInTime: currentAttendance.clockInTime,
        location: {
          name: currentAttendance.location?.locationName || currentAttendance.location?.locationId?.name,
          address: currentAttendance.location?.address || currentAttendance.location?.locationId?.address,
          latitude: currentAttendance.location?.latitude,
          longitude: currentAttendance.location?.longitude
        }
      },
      success: true
    });
  } catch (error) {
    console.error('Error checking current attendance:', error);
    res.status(500).json({ error: 'Failed to check current attendance', success: false });
  }
});

// Calculate polygon area using shoelace formula (approximate for small areas)
function calculatePolygonArea(coordinates) {
  if (coordinates.length < 3) return 0;

  let area = 0;
  const n = coordinates.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    // Convert to meters (rough approximation)
    const lat1 = coordinates[i][1] * Math.PI / 180;
    const lon1 = coordinates[i][0] * Math.PI / 180;
    const lat2 = coordinates[j][1] * Math.PI / 180;
    const lon2 = coordinates[j][0] * Math.PI / 180;

    area += lon1 * Math.sin(lat2) - lon2 * Math.sin(lat1);
  }

  area = Math.abs(area) * 6371000 * 6371000 / 2; // Earth's radius squared
  return Math.abs(area);
}

module.exports = router;
