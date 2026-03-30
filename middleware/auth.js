const jwt = require('jsonwebtoken');
const supabase = require('../utils/supabase');

const JWT_SECRET = process.env.JWT_SECRET || 'cs-portal-secret-key-change-in-production';

/**
 * requireAuth — verifies JWT from Authorization header.
 * Attaches decoded user payload to req.user.
 * Returns 401 if token is missing, invalid, or user not found / not approved.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = header.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Fetch fresh user data to ensure they're still approved
    const { data: user, error } = await supabase
      .from('users')
      .select('id, full_name, email, role, status')
      .eq('id', decoded.id)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (user.status !== 'approved') {
      return res.status(403).json({ error: 'Account not yet approved by admin' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired, please login again' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * requireAdmin — must be used AFTER requireAuth.
 * Checks that the authenticated user has the 'admin' role.
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/**
 * requireTeacherOrAdmin — must be used AFTER requireAuth.
 * Allows teachers and admins through.
 */
function requireTeacherOrAdmin(req, res, next) {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'teacher')) {
    return res.status(403).json({ error: 'Teacher or admin access required' });
  }
  next();
}

/**
 * signToken — creates a JWT for the given user object.
 * Expires in 7 days.
 */
function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

module.exports = { requireAuth, requireAdmin, requireTeacherOrAdmin, signToken, JWT_SECRET };
