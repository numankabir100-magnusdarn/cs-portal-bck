const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const supabase = require('../utils/supabase');
const { requireAuth, requireAdmin, signToken } = require('../middleware/auth');

const SALT_ROUNDS = 12;

// ─────────────────────────────────────────────────────────────
// PUBLIC ROUTES
// ─────────────────────────────────────────────────────────────

/**
 * POST /api/auth/signup
 * Creates a new user with status 'pending'.
 * The admin must approve them before they can log in.
 */
router.post('/signup', async (req, res) => {
  const { fullName, email, password } = req.body;

  if (!fullName || !email || !password) {
    return res.status(400).json({ error: 'Full name, email, and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    // Check if email already exists
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS);

    const { data, error } = await supabase
      .from('users')
      .insert([{
        full_name: fullName.trim(),
        email: email.toLowerCase().trim(),
        password: hash,
        role: 'student',
        status: 'pending',
      }])
      .select('id, full_name, email, role, status')
      .single();

    if (error) throw error;

    res.status(201).json({
      message: 'Account created! Please wait for admin approval before logging in.',
      user: data,
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

/**
 * POST /api/auth/login
 * Verifies credentials and returns a JWT.
 * User must be 'approved' to log in.
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Your account is pending admin approval. Please wait.' });
    }
    if (user.status === 'rejected') {
      return res.status(403).json({ error: 'Your registration request was declined.' });
    }

    const token = signToken(user);

    res.json({
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        status: user.status,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * POST /api/auth/request-reset
 * Flags a user's account for a password reset request.
 */
router.post('/request-reset', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const { data: user, error: findError } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (findError || !user) {
      // Return 200 anyway for security (don't reveal if email exists)
      return res.json({ message: 'If an account exists, a request has been sent to the admin.' });
    }

    const { error: updateError } = await supabase
      .from('users')
      .update({ reset_requested: true })
      .eq('id', user.id);

    if (updateError) throw updateError;

    res.json({ message: 'If an account exists, a request has been sent to the admin.' });
  } catch (err) {
    console.error('Request reset error:', err);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// ─────────────────────────────────────────────────────────────
// AUTHENTICATED ROUTES
// ─────────────────────────────────────────────────────────────

/**
 * GET /api/auth/me
 * Returns the current user's profile (used for session restore).
 */
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ─────────────────────────────────────────────────────────────
// ADMIN-ONLY ROUTES
// ─────────────────────────────────────────────────────────────

/**
 * GET /api/auth/users
 * Lists all users. Optional ?status=pending filter.
 */
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  const { status } = req.query;

  try {
    let query = supabase
      .from('users')
      .select('id, full_name, email, role, status, reset_requested, created_at')
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * PATCH /api/auth/users/:id/status
 * Approve or reject a user registration.
 */
router.patch('/users/:id/status', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be approved or rejected' });
  }

  try {
    const { data, error } = await supabase
      .from('users')
      .update({ status })
      .eq('id', id)
      .select('id, full_name, email, role, status')
      .single();

    if (error) throw error;
    res.json({ message: `User ${status}`, user: data });
  } catch (err) {
    console.error('Update user status error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/**
 * PATCH /api/auth/users/:id/role
 * Change a user's role (admin, teacher, student).
 */
router.patch('/users/:id/role', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  if (!['admin', 'teacher', 'student'].includes(role)) {
    return res.status(400).json({ error: 'Role must be admin, teacher, or student' });
  }

  try {
    const { data, error } = await supabase
      .from('users')
      .update({ role })
      .eq('id', id)
      .select('id, full_name, email, role, status')
      .single();

    if (error) throw error;
    res.json({ message: `Role updated to ${role}`, user: data });
  } catch (err) {
    console.error('Update role error:', err);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

/**
 * DELETE /api/auth/users/:id
 * Permanently delete a user account.
 */
router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;

  // Prevent self-deletion
  if (id === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  try {
    const { error } = await supabase.from('users').delete().eq('id', id);
    if (error) throw error;
    res.json({ message: 'User deleted' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

/**
 * POST /api/auth/users/create
 * Admin can directly create an approved user with any role.
 */
router.post('/users/create', requireAuth, requireAdmin, async (req, res) => {
  const { fullName, email, password, role } = req.body;

  if (!fullName || !email || !password) {
    return res.status(400).json({ error: 'Full name, email, and password are required' });
  }

  try {
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Email already exists' });
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS);

    const { data, error } = await supabase
      .from('users')
      .insert([{
        full_name: fullName.trim(),
        email: email.toLowerCase().trim(),
        password: hash,
        role: role || 'student',
        status: 'approved',
      }])
      .select('id, full_name, email, role, status')
      .single();

    if (error) throw error;
    res.status(201).json({ message: 'User created', user: data });
  } catch (err) {
    console.error('Admin create user error:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

/**
 * GET /api/auth/users/:id/inspect
 * Admin can view a user's uploads and activity.
 */
router.get('/users/:id/inspect', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const { data: user, error: uErr } = await supabase
      .from('users')
      .select('id, full_name, email, role, status, created_at')
      .eq('id', id)
      .single();

    if (uErr) throw uErr;

    const { data: files } = await supabase
      .from('files')
      .select('id, name, subject, folder, status, created_at')
      .eq('uploaded_by', id)
      .order('created_at', { ascending: false });

    const { data: announcements } = await supabase
      .from('announcements')
      .select('id, title, category, status, created_at')
      .eq('created_by', id)
      .order('created_at', { ascending: false });

    res.json({ user, files: files || [], announcements: announcements || [] });
  } catch (err) {
    console.error('Inspect user error:', err);
    res.status(500).json({ error: 'Failed to inspect user' });
  }
});

/**
 * POST /api/auth/users/:id/reset-password
 * Admin can reset a user's password. Clears the reset_requested flag.
 */
router.post('/users/:id/reset-password', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const newPassword = Math.random().toString(36).slice(-8); // Generate 8-char random password
  
  try {
    const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    const { data: user, error } = await supabase
      .from('users')
      .update({ password: hash, reset_requested: false })
      .eq('id', id)
      .select('id, full_name, email')
      .single();

    if (error) throw error;
    
    res.json({ 
      message: 'Password reset successful', 
      user, 
      newPassword 
    });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

module.exports = router;
