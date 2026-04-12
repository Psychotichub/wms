const express = require('express');
const router = express.Router();
const Todo = require('../models/Todo');
const Employee = require('../models/Employee');
const Notification = require('../models/Notification');
const NotificationPreferences = require('../models/NotificationPreferences');
const { authenticateToken, requireActiveSite } = require('../middleware/auth');
const { validate, z } = require('../middleware/validation');
const { parsePageLimit } = require('../utils/pagination');

const requireAuth = [authenticateToken, requireActiveSite];

const idParamsSchema = z.object({
  id: z.string().min(1)
});

const todoCreateSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  reminder: z.object({
    enabled: z.boolean().optional(),
    date: z.string().datetime().optional()
  }).optional()
});

const todoUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  completed: z.boolean().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  reminder: z.object({
    enabled: z.boolean().optional(),
    date: z.string().datetime().optional()
  }).optional()
});

// GET /api/todos - Get all todos for current user
router.get('/', requireAuth, async (req, res) => {
  const userId = req.user.id;

  // Get employee record for this user
  // Try to find by user ID first, then by email if user exists
  let employee = await Employee.findOne({ user: userId });

  // If employee not found, try to get user and find by email
  if (!employee) {
    const User = require('../models/User');
    const user = await User.findById(userId);
    if (user && user.email) {
      employee = await Employee.findOne({ email: user.email.toLowerCase() });
      // If found by email, link the user to the employee
      if (employee && !employee.user) {
        employee.user = userId;
        await employee.save();
      }
    }
  }

  if (!employee) {
    // Return empty array instead of 404 - user can still create todos
    return res.json({ todos: [] });
  }

  const { completed, priority, category, search } = req.query;
  const query = { user: userId };

  if (completed !== undefined) {
    query.completed = completed === 'true';
  }

  if (priority) {
    query.priority = priority;
  }

  if (category) {
    query.category = category;
  }

  if (search && String(search).trim()) {
    const term = String(search).trim();
    const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [
      { title: rx },
      { description: rx },
      { tags: rx }
    ];
  }

  const { page, limit, skip } = parsePageLimit(req.query, { defaultLimit: 200, maxLimit: 500 });
  const [todos, total] = await Promise.all([
    Todo.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Todo.countDocuments(query)
  ]);

  res.json({
    todos,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 0 }
  });
});

// GET /api/todos/:id - Get single todo
router.get('/:id', requireAuth, validate(idParamsSchema, { source: 'params' }), async (req, res) => {
  const userId = req.user.id;
  const todo = await Todo.findOne({ _id: req.params.id, user: userId });

  if (!todo) {
    return res.status(404).json({ error: 'Todo not found' });
  }

  res.json({ todo });
});

// POST /api/todos - Create new todo
router.post('/', requireAuth, validate(todoCreateSchema), async (req, res) => {
  const userId = req.user.id;

  // Get employee record for this user
  // Try to find by user ID first, then by email if user exists
  let employee = await Employee.findOne({ user: userId });

  // If employee not found, try to get user and find by email
  if (!employee) {
    const User = require('../models/User');
    const user = await User.findById(userId);
    if (user && user.email) {
      employee = await Employee.findOne({ email: user.email.toLowerCase() });
      // If found by email, link the user to the employee
      if (employee && !employee.user) {
        employee.user = userId;
        await employee.save();
      }
    }
  }

  // If still no employee, create a basic one for todos (or return error)
  if (!employee) {
    const User = require('../models/User');
    const user = await User.findById(userId);
    if (user) {
      // Create a basic employee record for this user
      employee = await Employee.create({
        name: user.name || 'User',
        email: user.email || `user-${userId}@system.local`,
        role: 'worker',
        user: userId,
        isActive: true
      });
    } else {
      return res.status(404).json({ error: 'User not found' });
    }
  }

  const { title, description, priority, category, tags, reminder } = req.data;

  const todoData = {
    title,
    description,
    priority: priority || 'medium',
    category,
    tags: tags || [],
    user: userId,
    employee: employee._id
  };

  // Handle reminder
  if (reminder && reminder.enabled && reminder.date) {
    todoData.reminder = {
      enabled: true,
      date: new Date(reminder.date),
      notified: false
    };
  }

  const todo = new Todo(todoData);
  await todo.save();

  res.status(201).json({
    todo,
    message: 'Todo created successfully'
  });
});

// PUT /api/todos/:id - Update todo
router.put('/:id', requireAuth, validate(idParamsSchema, { source: 'params' }), validate(todoUpdateSchema), async (req, res) => {
  const userId = req.user.id;
  const todo = await Todo.findOne({ _id: req.params.id, user: userId });

  if (!todo) {
    return res.status(404).json({ error: 'Todo not found' });
  }

  // Prevent editing todos that were completed more than 1 week ago
  if (todo.completed && todo.completedAt) {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    if (todo.completedAt < oneWeekAgo) {
      return res.status(403).json({
        error: 'Cannot edit todo. It was completed more than 1 week ago.',
        completedAt: todo.completedAt
      });
    }
  }

  const { title, description, completed, priority, category, tags, reminder } = req.data;

  if (title !== undefined) todo.title = title;
  if (description !== undefined) todo.description = description;
  if (priority !== undefined) todo.priority = priority;
  if (category !== undefined) todo.category = category;
  if (tags !== undefined) todo.tags = tags;

  // Handle completion
  if (completed !== undefined) {
    if (completed && !todo.completed) {
      todo.completed = true;
      todo.completedAt = new Date();
    } else if (!completed && todo.completed) {
      todo.completed = false;
      todo.completedAt = undefined;
    }
  }

  // Handle reminder update
  if (reminder !== undefined) {
    if (reminder.enabled && reminder.date) {
      todo.reminder = {
        enabled: true,
        date: new Date(reminder.date),
        notified: false
      };
    } else {
      todo.reminder = {
        enabled: false,
        date: undefined,
        notified: false
      };
    }
  }

  await todo.save();

  res.json({
    todo,
    message: 'Todo updated successfully'
  });
});

// DELETE /api/todos/:id - Delete todo
router.delete('/:id', requireAuth, validate(idParamsSchema, { source: 'params' }), async (req, res) => {
  const userId = req.user.id;
  const todo = await Todo.findOne({ _id: req.params.id, user: userId });

  if (!todo) {
    return res.status(404).json({ error: 'Todo not found' });
  }

  // Prevent deleting todos that were completed more than 1 week ago
  if (todo.completed && todo.completedAt) {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    if (todo.completedAt < oneWeekAgo) {
      return res.status(403).json({
        error: 'Cannot delete todo. It was completed more than 1 week ago.',
        completedAt: todo.completedAt
      });
    }
  }

  await Todo.findByIdAndDelete(req.params.id);
  res.json({ message: 'Todo deleted successfully' });
});

// POST /api/todos/:id/complete - Toggle completion
router.post('/:id/complete', requireAuth, validate(idParamsSchema, { source: 'params' }), async (req, res) => {
  const userId = req.user.id;
  const todo = await Todo.findOne({ _id: req.params.id, user: userId });

  if (!todo) {
    return res.status(404).json({ error: 'Todo not found' });
  }

  if (todo.completed) {
    todo.completed = false;
    todo.completedAt = undefined;
  } else {
    todo.completed = true;
    todo.completedAt = new Date();
  }

  await todo.save();

  res.json({
    todo,
    message: `Todo ${todo.completed ? 'completed' : 'uncompleted'} successfully`
  });
});

module.exports = router;
