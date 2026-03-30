const express = require('express');
const router = express.Router();
const supabase = require('../utils/supabase');
const { requireAuth, requireAdmin } = require('../middleware/auth');

/**
 * POST /api/announcements
 * Anyone authenticated can create. Admin posts auto-approved, others pending.
 */
router.post('/', requireAuth, async (req, res) => {
  const { title, body, category, subject, semester, deadline, priority, pinned } = req.body;

  if (!title) return res.status(400).json({ error: 'Title is required' });

  const status = req.user.role === 'admin' ? 'approved' : 'pending';

  try {
    const { data, error } = await supabase
      .from('announcements')
      .insert([{
        title: title.trim(),
        body: body || null,
        category: category || 'general',
        subject: subject || null,
        semester: semester || 1,
        deadline: deadline || null,
        priority: priority || 'normal',
        pinned: req.user.role === 'admin' ? (pinned || false) : false,
        created_by: req.user.id,
        status,
      }])
      .select('*, author:created_by(full_name, email, role)')
      .single();

    if (error) throw error;

    const msg = status === 'approved'
      ? 'Announcement posted!'
      : 'Announcement submitted for admin approval.';

    res.status(201).json({ message: msg, announcement: data });
  } catch (err) {
    console.error('Create announcement error:', err.message);
    res.status(500).json({ error: 'Failed to create announcement' });
  }
});

/**
 * GET /api/announcements
 * Students see approved only. Admin sees all.
 * ?semester=1&category=exam&status=pending
 */
router.get('/', requireAuth, async (req, res) => {
  const { semester, category, status } = req.query;

  try {
    let query = supabase
      .from('announcements')
      .select('*, author:users!created_by(full_name, email, role)')
      .order('pinned', { ascending: false })
      .order('priority', { ascending: false });

    if (semester) query = query.eq('semester', parseInt(semester));
    if (category) query = query.eq('category', category);

    if (status) {
      query = query.eq('status', status);
    } else if (req.user.role !== 'admin') {
      query = query.eq('status', 'approved');
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('List announcements error:', err.message);
    res.status(500).json({ error: 'Failed to fetch announcements' });
  }
});

/**
 * PATCH /api/announcements/:id — update announcement (admin only)
 */
router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const updates = {};
  const allowed = ['title', 'body', 'category', 'subject', 'semester', 'deadline', 'priority', 'pinned', 'status'];
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  try {
    const { data, error } = await supabase
      .from('announcements')
      .update(updates)
      .eq('id', id)
      .select('*, author:users!created_by(full_name, email, role)')
      .single();

    if (error) throw error;
    res.json({ message: 'Announcement updated', announcement: data });
  } catch (err) {
    console.error('Update announcement error:', err.message);
    res.status(500).json({ error: 'Failed to update announcement' });
  }
});

/**
 * DELETE /api/announcements/:id — admin only
 */
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('announcements').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ message: 'Announcement deleted' });
  } catch (err) {
    console.error('Delete announcement error:', err.message);
    res.status(500).json({ error: 'Failed to delete announcement' });
  }
});

module.exports = router;
