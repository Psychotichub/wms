const express = require('express');
const router = express.Router();
const MaterialRequisition = require('../models/MaterialRequisition');
const Employee = require('../models/Employee');
const User = require('../models/User');
const Notification = require('../models/Notification');
const NotificationPreferences = require('../models/NotificationPreferences');
const { authenticateToken, requireActiveSite } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { z } = require('zod');

const requireAuth = [authenticateToken, requireActiveSite];

// ── Validation schemas ──────────────────────────────────────────────────────

const requisitionItemSchema = z.object({
  name: z.string().min(1, 'Item name is required'),
  quantity: z.number().positive('Quantity must be positive'),
  unit: z.string().optional().default('pcs')
});

const createSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  items: z.array(requisitionItemSchema).min(1, 'At least one item is required'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().default('medium'),
  notes: z.string().optional().default('')
});

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  items: z.array(requisitionItemSchema).min(1).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  notes: z.string().optional()
});

const reviewSchema = z.object({
  action: z.enum(['approve', 'reject']),
  note: z.string().min(1, 'A review note is required')
});

const idParamsSchema = z.object({
  id: z.string().min(1)
});

// ── Helper: send notification (silently fails) ──────────────────────────────

async function sendRequisitionNotification({ recipientEmployeeId, senderId, title, message, type, requisitionId, priority }) {
  try {
    const employee = await Employee.findById(recipientEmployeeId);
    if (!employee || !employee.user) return;

    const preferences = await NotificationPreferences.findOne({ user: employee._id }).catch(() => null);

    const data = {
      recipient: employee._id,
      sender: senderId,
      title,
      message,
      type: type || 'requisition_update',
      priority: priority || 'medium',
      relatedEntity: { type: 'requisition', id: requisitionId },
      data: { requisitionId: requisitionId.toString() }
    };

    if (preferences?.pushToken) data.pushToken = preferences.pushToken;
    if (preferences?.webPushSubscription) data.webPushSubscription = preferences.webPushSubscription;

    await Notification.createAndSend(data);
  } catch (_) {
    // Don't fail the main operation if notification fails
  }
}

// ── GET /api/requisitions ───────────────────────────────────────────────────

router.get('/', requireAuth, async (req, res) => {
  const { status } = req.query;
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  let limit = parseInt(String(req.query.limit ?? '50'), 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 50;
  limit = Math.min(100, limit);

  const query = {};

  // Non-admin: only see own requisitions
  if (req.user.role !== 'admin') {
    const userId = req.user.id || req.user._id || req.user.userId;
    const employee = await Employee.findOne({ user: userId });
    if (!employee) {
      return res.json({ requisitions: [], total: 0, page: 1, totalPages: 0 });
    }
    query.requestedBy = employee._id;
  } else {
    // Admins see all for their site
    if (req.user.site) {
      query.site = req.user.site;
    }
  }

  if (status) query.status = status;

  const requisitions = await MaterialRequisition.find(query)
    .populate('requestedBy', 'name email role department')
    .populate('reviewedBy', 'name email')
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip((page - 1) * limit)
    .select('-__v');

  const total = await MaterialRequisition.countDocuments(query);

  res.json({
    requisitions,
    total,
    page,
    totalPages: Math.ceil(total / limit)
  });
});

// ── GET /api/requisitions/pending-count ─────────────────────────────────────

router.get('/pending-count', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.json({ count: 0 });
  }

  const query = { status: 'requested' };
  if (req.user.site) query.site = req.user.site;

  const count = await MaterialRequisition.countDocuments(query);
  res.json({ count });
});

// ── GET /api/requisitions/:id ───────────────────────────────────────────────

router.get('/:id', requireAuth, validate(idParamsSchema, { source: 'params' }), async (req, res) => {
  const requisition = await MaterialRequisition.findById(req.params.id)
    .populate('requestedBy', 'name email role department user')
    .populate('reviewedBy', 'name email')
    .populate('statusHistory.changedBy', 'name email');

  if (!requisition) {
    return res.status(404).json({ error: 'Requisition not found' });
  }

  // Non-admin: can only view their own
  if (req.user.role !== 'admin') {
    const userId = req.user.id || req.user._id || req.user.userId;
    const employee = await Employee.findOne({ user: userId });
    if (!employee || requisition.requestedBy._id.toString() !== employee._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }
  }

  res.json({ requisition });
});

// ── POST /api/requisitions ──────────────────────────────────────────────────

router.post('/', requireAuth, validate(createSchema), async (req, res) => {
  try {
    const userId = req.user.id || req.user._id || req.user.userId;
    const employee = await Employee.findOne({ user: userId });
    if (!employee) {
      return res.status(400).json({ error: 'Employee record not found. Only employees can create requisitions.' });
    }

    const { title, items, priority, notes } = req.data;
    const site = req.user.site;

    const requisition = new MaterialRequisition({
      title,
      items,
      priority,
      notes,
      requestedBy: employee._id,
      site,
      statusHistory: [{
        status: 'requested',
        changedBy: userId,
        changedAt: new Date(),
        note: 'Requisition created'
      }]
    });

    await requisition.save();
    await requisition.populate('requestedBy', 'name email role department');

    // Notify all admin users for this site
    try {
      const adminUsers = await User.find({ role: 'admin', isDeleted: { $ne: true } }).select('_id');
      for (const admin of adminUsers) {
        const adminEmployee = await Employee.findOne({ user: admin._id });
        if (adminEmployee) {
          await sendRequisitionNotification({
            recipientEmployeeId: adminEmployee._id,
            senderId: userId,
            title: 'New Material Requisition',
            message: `${employee.name} requested: ${title}`,
            type: 'requisition_created',
            requisitionId: requisition._id,
            priority: priority === 'urgent' ? 'urgent' : priority === 'high' ? 'high' : 'medium'
          });
        }
      }
    } catch (_) { /* notification failures are non-fatal */ }

    res.status(201).json({ requisition, message: 'Requisition created successfully' });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    throw error;
  }
});

// ── PUT /api/requisitions/:id ───────────────────────────────────────────────

router.put('/:id', requireAuth, validate(idParamsSchema, { source: 'params' }), validate(updateSchema), async (req, res) => {
  try {
    const requisition = await MaterialRequisition.findById(req.params.id);
    if (!requisition) {
      return res.status(404).json({ error: 'Requisition not found' });
    }

    // Can only edit while still in 'requested' status
    if (requisition.status !== 'requested') {
      return res.status(400).json({ error: 'Can only edit requisitions that are still pending review' });
    }

    // Only the requester or admin can edit
    const userId = req.user.id || req.user._id || req.user.userId;
    if (req.user.role !== 'admin') {
      const employee = await Employee.findOne({ user: userId });
      if (!employee || requisition.requestedBy.toString() !== employee._id.toString()) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const { title, items, priority, notes } = req.data;
    if (title !== undefined) requisition.title = title;
    if (items !== undefined) requisition.items = items;
    if (priority !== undefined) requisition.priority = priority;
    if (notes !== undefined) requisition.notes = notes;

    await requisition.save();
    await requisition.populate('requestedBy', 'name email role department');
    await requisition.populate('reviewedBy', 'name email');

    res.json({ requisition, message: 'Requisition updated successfully' });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    throw error;
  }
});

// ── PATCH /api/requisitions/:id/review ──────────────────────────────────────

router.patch('/:id/review', requireAuth, validate(idParamsSchema, { source: 'params' }), validate(reviewSchema), async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can review requisitions' });
  }

  const requisition = await MaterialRequisition.findById(req.params.id);
  if (!requisition) {
    return res.status(404).json({ error: 'Requisition not found' });
  }

  if (requisition.status !== 'requested') {
    return res.status(400).json({ error: 'This requisition has already been reviewed' });
  }

  const { action, note } = req.data;
  const userId = req.user.id || req.user._id || req.user.userId;
  const newStatus = action === 'approve' ? 'approved' : 'rejected';

  requisition.status = newStatus;
  requisition.reviewedBy = userId;
  requisition.reviewNote = note;
  requisition.reviewedAt = new Date();

  requisition.statusHistory.push({
    status: newStatus,
    changedBy: userId,
    changedAt: new Date(),
    note
  });

  await requisition.save();
  await requisition.populate('requestedBy', 'name email role department user');
  await requisition.populate('reviewedBy', 'name email');
  await requisition.populate('statusHistory.changedBy', 'name email');

  // Notify the requester
  await sendRequisitionNotification({
    recipientEmployeeId: requisition.requestedBy._id,
    senderId: userId,
    title: newStatus === 'approved' ? 'Requisition Approved' : 'Requisition Rejected',
    message: `Your requisition "${requisition.title}" was ${newStatus}. Note: ${note}`,
    type: newStatus === 'approved' ? 'requisition_approved' : 'requisition_rejected',
    requisitionId: requisition._id,
    priority: 'high'
  });

  res.json({ requisition, message: `Requisition ${newStatus} successfully` });
});

// ── PATCH /api/requisitions/:id/dispatch ─────────────────────────────────────

router.patch('/:id/dispatch', requireAuth, validate(idParamsSchema, { source: 'params' }), async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can dispatch requisitions' });
  }

  const requisition = await MaterialRequisition.findById(req.params.id);
  if (!requisition) {
    return res.status(404).json({ error: 'Requisition not found' });
  }

  if (requisition.status !== 'approved') {
    return res.status(400).json({ error: 'Only approved requisitions can be dispatched' });
  }

  const userId = req.user.id || req.user._id || req.user.userId;

  requisition.status = 'dispatched';
  requisition.dispatchedAt = new Date();
  requisition.statusHistory.push({
    status: 'dispatched',
    changedBy: userId,
    changedAt: new Date(),
    note: 'Materials dispatched'
  });

  await requisition.save();
  await requisition.populate('requestedBy', 'name email role department user');
  await requisition.populate('reviewedBy', 'name email');
  await requisition.populate('statusHistory.changedBy', 'name email');

  await sendRequisitionNotification({
    recipientEmployeeId: requisition.requestedBy._id,
    senderId: userId,
    title: 'Materials Dispatched',
    message: `Materials for "${requisition.title}" have been dispatched`,
    type: 'requisition_dispatched',
    requisitionId: requisition._id,
    priority: 'medium'
  });

  res.json({ requisition, message: 'Requisition marked as dispatched' });
});

// ── PATCH /api/requisitions/:id/deliver ──────────────────────────────────────

router.patch('/:id/deliver', requireAuth, validate(idParamsSchema, { source: 'params' }), async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can mark requisitions as delivered' });
  }

  const requisition = await MaterialRequisition.findById(req.params.id);
  if (!requisition) {
    return res.status(404).json({ error: 'Requisition not found' });
  }

  if (requisition.status !== 'dispatched') {
    return res.status(400).json({ error: 'Only dispatched requisitions can be marked as delivered' });
  }

  const userId = req.user.id || req.user._id || req.user.userId;

  requisition.status = 'delivered';
  requisition.deliveredAt = new Date();
  requisition.statusHistory.push({
    status: 'delivered',
    changedBy: userId,
    changedAt: new Date(),
    note: 'Materials delivered'
  });

  await requisition.save();
  await requisition.populate('requestedBy', 'name email role department user');
  await requisition.populate('reviewedBy', 'name email');
  await requisition.populate('statusHistory.changedBy', 'name email');

  await sendRequisitionNotification({
    recipientEmployeeId: requisition.requestedBy._id,
    senderId: userId,
    title: 'Materials Delivered',
    message: `Materials for "${requisition.title}" have been delivered`,
    type: 'requisition_delivered',
    requisitionId: requisition._id,
    priority: 'medium'
  });

  res.json({ requisition, message: 'Requisition marked as delivered' });
});

module.exports = router;
