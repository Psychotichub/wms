const express = require('express');
const router = express.Router();
const Task = require('../models/Task');
const Employee = require('../models/Employee');
const User = require('../models/User');
const Notification = require('../models/Notification');
const NotificationPreferences = require('../models/NotificationPreferences');
const { authenticateToken, requireActiveSite } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { z } = require('zod');

// Use shared JWT auth middleware
const requireAuth = [authenticateToken, requireActiveSite];

// Validation schemas
const taskCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  assignedTo: z.string(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  dueDate: z.string().optional(),
  location: z.string().optional(),
  site: z.string().optional(),
  category: z.enum(['installation', 'maintenance', 'inspection', 'repair', 'delivery', 'other']).optional(),
  estimatedHours: z.union([z.number(), z.string()]).optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  checklist: z.array(z.object({
    item: z.string(),
    completed: z.boolean().optional()
  })).optional()
});

const taskUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  assignedTo: z.string().optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  dueDate: z.string().optional(),
  location: z.string().optional(),
  site: z.string().optional(),
  category: z.enum(['installation', 'maintenance', 'inspection', 'repair', 'delivery', 'other']).optional(),
  estimatedHours: z.union([z.number(), z.string()]).optional(),
  actualHours: z.union([z.number(), z.string()]).optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  checklist: z.array(z.object({
    item: z.string(),
    completed: z.boolean().optional()
  })).optional()
});

const idParamsSchema = z.object({
  id: z.string().min(1)
});

const taskTransferSchema = z.object({
  newEmployeeId: z.string().min(1),
  transferNote: z.string().min(10, 'Transfer note must be at least 10 characters explaining why the task is being transferred')
});

// GET /api/tasks - Get all tasks (filtered by user role)
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status, priority, assignedTo, page = 1, limit = 50 } = req.query;
    const query = {};

    // If user is not admin, only show tasks assigned to their employee record
    if (req.user.role !== 'admin') {
      // Find employee record linked to this user
      const userId = req.user.id || req.user._id || req.user.userId;
      const employee = await Employee.findOne({ user: userId });
      if (!employee) {
        return res.json({ tasks: [], total: 0, page: 1, totalPages: 0 });
      }
      query.assignedTo = employee._id;
    } else if (assignedTo) {
      // Admin can filter by assignedTo
      query.assignedTo = assignedTo;
    }

    // Apply filters
    if (status) query.status = status;
    if (priority) query.priority = priority;

    // Site filtering for multi-site support (only for admins viewing all tasks)
    // Non-admin users see all tasks assigned to them regardless of site
    if (req.user.role === 'admin' && req.user.site) {
      query.site = req.user.site;
    }

    const tasks = await Task.find(query)
      .populate('assignedTo', 'name email role department')
      .populate('assignedBy', 'name email')
      .populate('location', 'name address')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('-__v');

    const total = await Task.countDocuments(query);

    res.json({
      tasks,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// GET /api/tasks/:id - Get single task
router.get('/:id', requireAuth, validate(idParamsSchema, { source: 'params' }), async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
      .populate('assignedTo', 'name email role department user')
      .populate('assignedBy', 'name email')
      .populate('location', 'name address')
      .populate('relatedMaterials.material', 'name unit');

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Check if user has permission to view this task
    // Admins can view all tasks
    // Employees can view tasks if:
    //   - Currently assigned to them, OR
    //   - They appear in the assignment history (were previously assigned)
    if (req.user.role !== 'admin') {
      const userId = req.user.id || req.user._id || req.user.userId;
      const employee = await Employee.findOne({ user: userId });
      if (!employee) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const isCurrentlyAssigned = task.assignedTo._id.toString() === employee._id.toString();
      
      // Check assignment history (before population, so we check ObjectId directly)
      let wasPreviouslyAssigned = false;
      if (task.assignmentHistory && task.assignmentHistory.length > 0) {
        wasPreviouslyAssigned = task.assignmentHistory.some(entry => {
          const assignedToId = entry.assignedTo?._id ? entry.assignedTo._id.toString() : entry.assignedTo?.toString();
          return assignedToId === employee._id.toString();
        });
      }
      
      if (!isCurrentlyAssigned && !wasPreviouslyAssigned) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Populate assignment history
    if (task.assignmentHistory && task.assignmentHistory.length > 0) {
      await task.populate('assignmentHistory.assignedTo', 'name email role department');
      await task.populate('assignmentHistory.transferredBy', 'name email role');
      await task.populate('assignmentHistory.assignedBy', 'name email');
    }

    res.json({ task });
  } catch (error) {
    console.error('Error fetching task:', error);
    res.status(500).json({ error: 'Failed to fetch task' });
  }
});

// POST /api/tasks - Create new task (admin only)
router.post('/', requireAuth, validate(taskCreateSchema), async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can create tasks' });
    }

    const {
      title,
      description,
      assignedTo,
      priority = 'medium',
      dueDate,
      location,
      site,
      category = 'other',
      estimatedHours,
      notes,
      tags,
      checklist
    } = req.data;

    // Verify employee exists
    const employee = await Employee.findById(assignedTo);
    if (!employee) {
      return res.status(400).json({ error: 'Employee not found' });
    }

    // Use site from request or default to user's site
    const taskSite = site || req.user.site;

    const assignedByUserId = req.user.id || req.user._id || req.user.userId;
    
    const task = new Task({
      title,
      description,
      assignedTo,
      assignedBy: assignedByUserId,
      priority,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      location,
      site: taskSite,
      category,
      estimatedHours: estimatedHours ? parseFloat(estimatedHours) : undefined,
      notes,
      tags: tags || [],
      checklist: checklist || [],
      // Add initial assignment to history
      assignmentHistory: [{
        assignedTo,
        assignedBy: assignedByUserId,
        assignedAt: new Date(),
        status: 'pending'
      }]
    });

    await task.save();

    // Populate for response
    await task.populate('assignedTo', 'name email role department user');
    await task.populate('assignedBy', 'name email');
    if (task.location) {
      await task.populate('location', 'name address');
    }

    // Send notification to assigned employee if they have a user account
    // This creates both in-app notification and sends push notification
    if (employee.user) {
      try {
        // Get notification preferences for push token and web push subscription
        const preferences = await NotificationPreferences.findOne({ user: employee._id }).catch(() => null);
        
        // Prepare notification data
        const notificationData = {
          recipient: employee._id,
          sender: req.user.id || req.user._id || req.user.userId,
          title: 'New Task Assigned',
          message: `You have been assigned a new task: ${title}`,
          type: 'task_assigned',
          priority: priority === 'urgent' ? 'urgent' : priority === 'high' ? 'high' : 'medium',
          relatedEntity: {
            type: 'task',
            id: task._id
          },
          data: {
            taskId: task._id.toString(),
            taskTitle: title,
            dueDate: dueDate
          }
        };

        // Add push token if available (from NotificationPreferences)
        if (preferences?.pushToken) {
          notificationData.pushToken = preferences.pushToken;
        }

        // Add web push subscription if available
        if (preferences?.webPushSubscription) {
          notificationData.webPushSubscription = preferences.webPushSubscription;
        }

        // Create and send notification (both in-app and push)
        // This saves the notification to database (in-app) and sends push notification if token is available
        await Notification.createAndSend(notificationData);
      } catch (notifError) {
        console.error('Error sending task assignment notification:', notifError);
        // Don't fail task creation if notification fails
      }
    }

    res.status(201).json({
      task,
      message: 'Task created and assigned successfully'
    });
  } catch (error) {
    console.error('Error creating task:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// PUT /api/tasks/:id - Update task
router.put('/:id', requireAuth, validate(idParamsSchema, { source: 'params' }), validate(taskUpdateSchema), async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Prevent editing completed tasks (for everyone including admins)
    if (task.status === 'completed') {
      return res.status(400).json({ error: 'Cannot edit completed tasks' });
    }

    // Check permissions
    if (req.user.role !== 'admin') {
      const userId = req.user.id || req.user._id || req.user.userId;
      const employee = await Employee.findOne({ user: userId });
      if (!employee || task.assignedTo.toString() !== employee._id.toString()) {
        return res.status(403).json({ error: 'Access denied' });
      }
      // Non-admins can only update status and notes
      const allowedFields = ['status', 'notes', 'actualHours', 'checklist'];
      const updateData = {};
      Object.keys(req.data).forEach(key => {
        if (allowedFields.includes(key)) {
          updateData[key] = req.data[key];
        }
      });
      Object.assign(req.data, updateData);
    }

    const {
      title,
      description,
      assignedTo,
      status,
      priority,
      dueDate,
      location,
      site,
      category,
      estimatedHours,
      actualHours,
      notes,
      tags,
      checklist
    } = req.data;

    // Update fields
    if (title !== undefined) task.title = title;
    if (description !== undefined) task.description = description;
    if (assignedTo !== undefined && assignedTo !== task.assignedTo.toString()) {
      const newEmployee = await Employee.findById(assignedTo);
      if (!newEmployee) {
        return res.status(400).json({ error: 'Employee not found' });
      }
      
      // Track assignment change in history
      const userId = req.user.id || req.user._id || req.user.userId;
      const currentEmployee = await Employee.findOne({ user: userId });
      
      // Add to assignment history
      if (!task.assignmentHistory) {
        task.assignmentHistory = [];
      }
      
      task.assignmentHistory.push({
        assignedTo,
        assignedBy: userId,
        transferredBy: currentEmployee?._id || null,
        transferNote: req.data.transferNote || 'Task reassigned by admin',
        assignedAt: new Date(),
        status: task.status
      });
      
      task.assignedTo = assignedTo;
      
      // Send notification to new assigned employee
      if (newEmployee.user) {
        try {
          const preferences = await NotificationPreferences.findOne({ user: newEmployee._id }).catch(() => null);
          
          const notificationData = {
            recipient: newEmployee._id,
            sender: userId,
            title: 'Task Transferred to You',
            message: `A task has been transferred to you: ${task.title}`,
            type: 'task_assigned',
            priority: task.priority === 'urgent' ? 'urgent' : task.priority === 'high' ? 'high' : 'medium',
            relatedEntity: {
              type: 'task',
              id: task._id
            },
            data: {
              taskId: task._id.toString(),
              taskTitle: task.title
            }
          };
          
          if (preferences?.pushToken) {
            notificationData.pushToken = preferences.pushToken;
          }
          if (preferences?.webPushSubscription) {
            notificationData.webPushSubscription = preferences.webPushSubscription;
          }
          
          await Notification.createAndSend(notificationData);
        } catch (notifError) {
          console.error('Error sending task transfer notification:', notifError);
        }
      }
    }
    if (status !== undefined) {
      // Only the assigned employee can start a task (change status to 'in_progress')
      // Even admins and task creators cannot start tasks - only the assigned employee
      if (status === 'in_progress' && task.status === 'pending') {
        const userId = req.user.id || req.user._id || req.user.userId;
        const employee = await Employee.findOne({ user: userId });
        if (!employee || task.assignedTo.toString() !== employee._id.toString()) {
          return res.status(403).json({ 
            error: 'Only the assigned employee can start this task' 
          });
        }
      }
      
      const previousStatus = task.status;
      task.status = status;
      if (status === 'completed' && !task.completedAt) {
        task.completedAt = new Date();
      }
      
      // Update status in the latest assignment history entry if it exists
      if (task.assignmentHistory && task.assignmentHistory.length > 0) {
        const latestEntry = task.assignmentHistory[task.assignmentHistory.length - 1];
        latestEntry.status = status;
      }
    }
    if (priority !== undefined) task.priority = priority;
    if (dueDate !== undefined) task.dueDate = dueDate ? new Date(dueDate) : null;
    if (location !== undefined) task.location = location;
    if (site !== undefined) task.site = site;
    if (category !== undefined) task.category = category;
    if (estimatedHours !== undefined) task.estimatedHours = estimatedHours ? parseFloat(estimatedHours) : null;
    if (actualHours !== undefined) task.actualHours = actualHours ? parseFloat(actualHours) : null;
    if (notes !== undefined) task.notes = notes;
    if (tags !== undefined) task.tags = tags;
    if (checklist !== undefined) {
      task.checklist = checklist.map(item => ({
        item: item.item,
        completed: item.completed || false,
        completedAt: item.completed && !item.completedAt ? new Date() : item.completedAt
      }));
    }

    await task.save();

    // Populate for response
    await task.populate('assignedTo', 'name email role department user');
    await task.populate('assignedBy', 'name email');
    if (task.assignmentHistory && task.assignmentHistory.length > 0) {
      await task.populate('assignmentHistory.assignedTo', 'name email role department');
      await task.populate('assignmentHistory.transferredBy', 'name email role');
      await task.populate('assignmentHistory.assignedBy', 'name email');
    }
    if (task.location) {
      await task.populate('location', 'name address');
    }

    // Send notification if status changed to completed
    // Notify the task creator (assignedBy) that their assigned task was completed
    // This creates both in-app notification and sends push notification
    if (status === 'completed' && task.assignedBy) {
      try {
        // Find the User who created the task
        const taskCreator = await User.findById(task.assignedBy);
        if (taskCreator) {
          // Find the Employee record linked to this User (if exists)
          const creatorEmployee = await Employee.findOne({ user: taskCreator._id });
          if (creatorEmployee) {
            // Get notification preferences for push token and web push subscription
            const preferences = await NotificationPreferences.findOne({ user: creatorEmployee._id }).catch(() => null);
            
            // Prepare notification data
            const notificationData = {
              recipient: creatorEmployee._id,
              sender: req.user.id || req.user._id || req.user.userId,
              title: 'Task Completed',
              message: `Task "${task.title}" has been marked as completed by ${task.assignedTo?.name || 'employee'}`,
              type: 'task_completed',
              priority: 'medium',
              relatedEntity: {
                type: 'task',
                id: task._id
              },
              data: {
                taskId: task._id.toString(),
                taskTitle: task.title,
                completedBy: task.assignedTo?.name || 'employee'
              }
            };

            // Add push token if available (from NotificationPreferences)
            if (preferences?.pushToken) {
              notificationData.pushToken = preferences.pushToken;
            }

            // Add web push subscription if available
            if (preferences?.webPushSubscription) {
              notificationData.webPushSubscription = preferences.webPushSubscription;
            }

            // Create and send notification (both in-app and push)
            await Notification.createAndSend(notificationData);
          }
        }
      } catch (notifError) {
        console.error('Error sending task completion notification:', notifError);
        // Don't fail task update if notification fails
      }
    }

    res.json({
      task,
      message: 'Task updated successfully'
    });
  } catch (error) {
    console.error('Error updating task:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// POST /api/tasks/:id/transfer - Transfer task to another employee
router.post('/:id/transfer', requireAuth, validate(idParamsSchema, { source: 'params' }), validate(taskTransferSchema), async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Prevent transferring completed tasks
    if (task.status === 'completed' || task.status === 'cancelled') {
      return res.status(400).json({ error: 'Cannot transfer completed or cancelled tasks' });
    }

    const { newEmployeeId, transferNote } = req.data;
    const userId = req.user.id || req.user._id || req.user.userId;
    
    // Verify new employee exists
    const newEmployee = await Employee.findById(newEmployeeId);
    if (!newEmployee) {
      return res.status(400).json({ error: 'Employee not found' });
    }

    // Check if user is the assigned employee (only assigned employee can transfer)
    let transferringEmployee = null;
    if (req.user.role !== 'admin') {
      transferringEmployee = await Employee.findOne({ user: userId });
      if (!transferringEmployee || task.assignedTo.toString() !== transferringEmployee._id.toString()) {
        return res.status(403).json({ 
          error: 'Only the assigned employee can transfer this task' 
        });
      }
    } else {
      // For admins, get the current assigned employee to check role rules
      transferringEmployee = await Employee.findById(task.assignedTo);
    }

    // Don't allow transferring to the same employee
    if (task.assignedTo.toString() === newEmployeeId) {
      return res.status(400).json({ error: 'Task is already assigned to this employee' });
    }

    // Enforce role-based transfer rules:
    // - Workers can only transfer to workers
    // - Supervisors can only transfer to supervisors
    // - Managers can only transfer to managers
    // - Admins can transfer to anyone
    if (transferringEmployee && req.user.role !== 'admin') {
      const currentRole = transferringEmployee.role;
      const newRole = newEmployee.role;
      
      if (currentRole === 'worker' && newRole !== 'worker') {
        return res.status(403).json({ 
          error: 'Workers can only transfer tasks to other workers' 
        });
      }
      if (currentRole === 'supervisor' && newRole !== 'supervisor') {
        return res.status(403).json({ 
          error: 'Supervisors can only transfer tasks to other supervisors' 
        });
      }
      if (currentRole === 'manager' && newRole !== 'manager') {
        return res.status(403).json({ 
          error: 'Managers can only transfer tasks to other managers' 
        });
      }
    }

    const previousEmployeeId = task.assignedTo;
    
    // Add to assignment history
    if (!task.assignmentHistory) {
      task.assignmentHistory = [];
    }
    
    task.assignmentHistory.push({
      assignedTo: newEmployeeId,
      assignedBy: userId,
      transferredBy: transferringEmployee?._id || null,
      transferNote: transferNote,
      assignedAt: new Date(),
      status: task.status
    });

    // Update assignment
    task.assignedTo = newEmployeeId;
    
    // Reset status to pending when transferred (new employee needs to start it)
    if (task.status === 'in_progress') {
      task.status = 'pending';
    }

    await task.save();

    // Populate for response
    await task.populate('assignedTo', 'name email role department user');
    await task.populate('assignedBy', 'name email');
    if (task.assignmentHistory && task.assignmentHistory.length > 0) {
      await task.populate('assignmentHistory.assignedTo', 'name email');
      await task.populate('assignmentHistory.transferredBy', 'name email');
      await task.populate('assignmentHistory.assignedBy', 'name email');
    }
    if (task.location) {
      await task.populate('location', 'name address');
    }

    // Send notification to new assigned employee
    if (newEmployee.user) {
      try {
        const preferences = await NotificationPreferences.findOne({ user: newEmployee._id }).catch(() => null);
        
        const notificationData = {
          recipient: newEmployee._id,
          sender: userId,
          title: 'Task Transferred to You',
          message: `A task has been transferred to you: ${task.title}. Reason: ${transferNote}`,
          type: 'task_assigned',
          priority: task.priority === 'urgent' ? 'urgent' : task.priority === 'high' ? 'high' : 'medium',
          relatedEntity: {
            type: 'task',
            id: task._id
          },
          data: {
            taskId: task._id.toString(),
            taskTitle: task.title,
            transferNote: transferNote
          }
        };
        
        if (preferences?.pushToken) {
          notificationData.pushToken = preferences.pushToken;
        }
        if (preferences?.webPushSubscription) {
          notificationData.webPushSubscription = preferences.webPushSubscription;
        }
        
        await Notification.createAndSend(notificationData);
      } catch (notifError) {
        console.error('Error sending task transfer notification:', notifError);
      }
    }

    res.json({
      task,
      message: 'Task transferred successfully'
    });
  } catch (error) {
    console.error('Error transferring task:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to transfer task' });
  }
});

// DELETE /api/tasks/:id - Delete task (DISABLED - tasks cannot be deleted)
// router.delete('/:id', requireAuth, validate(idParamsSchema, { source: 'params' }), async (req, res) => {
//   try {
//     if (req.user.role !== 'admin') {
//       return res.status(403).json({ error: 'Only admins can delete tasks' });
//     }

//     const task = await Task.findByIdAndDelete(req.params.id);
//     if (!task) {
//       return res.status(404).json({ error: 'Task not found' });
//     }

//     res.json({ message: 'Task deleted successfully' });
//   } catch (error) {
//     console.error('Error deleting task:', error);
//     res.status(500).json({ error: 'Failed to delete task' });
//   }
// });

module.exports = router;
