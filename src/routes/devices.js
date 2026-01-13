const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');

// Get user's bound devices
router.get('/', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('boundDevices requireDeviceBinding maxBoundDevices');

    if (!user) {
      return res.status(404).json({ error: 'User not found', success: false });
    }

    res.json({
      devices: user.boundDevices || [],
      requireDeviceBinding: user.requireDeviceBinding,
      maxBoundDevices: user.maxBoundDevices,
      success: true
    });
  } catch (error) {
    console.error('Error fetching devices:', error);
    res.status(500).json({ error: 'Failed to fetch devices', success: false });
  }
});

// Bind a new device
router.post('/bind', authenticateToken, async (req, res) => {
  try {
    const { deviceId, deviceName, deviceType } = req.body;

    if (!deviceId || !deviceType) {
      return res.status(400).json({
        error: 'Device ID and type are required',
        success: false
      });
    }

    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found', success: false });
    }

    // Check if device is already bound
    const existingDevice = user.boundDevices.find(d => d.deviceId === deviceId && d.isActive);

    if (existingDevice) {
      // Update last used time
      existingDevice.lastUsed = new Date();
      await user.save();

      return res.json({
        message: 'Device already bound, updated timestamp',
        device: existingDevice,
        success: true
      });
    }

    // Check device limit
    const activeDevices = user.boundDevices.filter(d => d.isActive);
    if (activeDevices.length >= user.maxBoundDevices) {
      return res.status(400).json({
        error: `Maximum ${user.maxBoundDevices} devices allowed`,
        success: false
      });
    }

    // Add new device
    const newDevice = {
      deviceId,
      deviceName: deviceName || `${deviceType} device`,
      deviceType,
      lastUsed: new Date(),
      isActive: true
    };

    user.boundDevices.push(newDevice);
    await user.save();

    res.status(201).json({
      message: 'Device bound successfully',
      device: newDevice,
      success: true
    });
  } catch (error) {
    console.error('Error binding device:', error);
    res.status(500).json({ error: 'Failed to bind device', success: false });
  }
});

// Unbind a device
router.post('/unbind/:deviceId', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found', success: false });
    }

    const deviceIndex = user.boundDevices.findIndex(d => d.deviceId === req.params.deviceId);

    if (deviceIndex === -1) {
      return res.status(404).json({ error: 'Device not found', success: false });
    }

    // Mark device as inactive instead of removing
    user.boundDevices[deviceIndex].isActive = false;
    await user.save();

    res.json({
      message: 'Device unbound successfully',
      success: true
    });
  } catch (error) {
    console.error('Error unbinding device:', error);
    res.status(500).json({ error: 'Failed to unbind device', success: false });
  }
});

// Update device name
router.put('/:deviceId', authenticateToken, async (req, res) => {
  try {
    const { deviceName } = req.body;

    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found', success: false });
    }

    const device = user.boundDevices.find(d => d.deviceId === req.params.deviceId);

    if (!device) {
      return res.status(404).json({ error: 'Device not found', success: false });
    }

    device.deviceName = deviceName || device.deviceName;
    device.lastUsed = new Date();
    await user.save();

    res.json({
      message: 'Device updated successfully',
      device,
      success: true
    });
  } catch (error) {
    console.error('Error updating device:', error);
    res.status(500).json({ error: 'Failed to update device', success: false });
  }
});

// Validate device binding (middleware helper)
const validateDeviceBinding = async (userId, deviceId, deviceType) => {
  try {
    const user = await User.findById(userId);

    if (!user || !user.requireDeviceBinding) {
      return { valid: true, reason: 'Device binding not required' };
    }

    const boundDevice = user.boundDevices.find(d =>
      d.deviceId === deviceId && d.isActive
    );

    if (!boundDevice) {
      return {
        valid: false,
        reason: 'Device not bound to this account'
      };
    }

    // Update last used time
    boundDevice.lastUsed = new Date();
    await user.save();

    return { valid: true, device: boundDevice };
  } catch (error) {
    console.error('Error validating device binding:', error);
    return { valid: false, reason: 'Device validation error' };
  }
};

module.exports = {
  router,
  validateDeviceBinding
};
