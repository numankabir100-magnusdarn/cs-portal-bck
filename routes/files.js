const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { uploadToDrive, deleteFromDrive } = require('../utils/drive');
const supabase = require('../utils/supabase');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const os = require('os');

const uploadDir = path.join(os.tmpdir(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ─── UPLOAD ──────────────────────────────────────────────────

router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  const { subject, folder, section, semester } = req.body;
  const file = req.file;

  if (!file) return res.status(400).json({ error: 'No file provided' });
  if (!subject || !folder) {
    if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
    return res.status(400).json({ error: 'Subject and folder are required' });
  }

  try {
    const { url, fileId } = await uploadToDrive(file, semester || 1, subject, folder);

    const status = (req.user.role === 'admin' || req.user.role === 'teacher')
      ? 'approved' : 'pending';

    const { data, error } = await supabase
      .from('files')
      .insert([{
        name: file.originalname,
        subject,
        folder,
        section: section || 'course',
        semester: parseInt(semester) || 1,
        drive_url: url,
        drive_file_id: fileId,
        file_size: file.size,
        mime_type: file.mimetype,
        uploaded_by: req.user.id,
        status,
      }])
      .select('*')
      .single();

    if (error) throw error;

    const msg = status === 'approved'
      ? 'File uploaded and published!'
      : 'File uploaded! Awaiting admin approval.';

    res.status(201).json({ message: msg, file: data });
  } catch (err) {
    console.error('Upload error:', err.message);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

// ─── LIST FILES ──────────────────────────────────────────────

router.get('/', requireAuth, async (req, res) => {
  const { subject, folder, section, semester, status } = req.query;

  try {
    let query = supabase
      .from('files')
      .select('*, uploader:users!uploaded_by(full_name, email)')
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false });

    if (subject)  query = query.eq('subject', subject);
    if (folder)   query = query.eq('folder', folder);
    if (section)  query = query.eq('section', section);
    if (semester) query = query.eq('semester', parseInt(semester));

    if (status) {
      query = query.eq('status', status);
    } else if (req.user.role === 'student') {
      query = query.or(`status.eq.approved,and(status.eq.pending,uploaded_by.eq.${req.user.id})`);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('List files error:', err.message);
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

// ─── STATS ───────────────────────────────────────────────────

router.get('/stats', requireAuth, async (req, res) => {
  const { semester } = req.query;

  try {
    let query = supabase.from('files').select('subject, status, section');
    if (semester) query = query.eq('semester', parseInt(semester));

    const { data: allFiles, error } = await query;
    if (error) throw error;

    const total   = allFiles.filter(f => f.status === 'approved').length;
    const pending = allFiles.filter(f => f.status === 'pending').length;
    const exam    = allFiles.filter(f => f.status === 'approved' && f.section === 'exam').length;

    const bySubject = {};
    allFiles.forEach(f => {
      if (f.status === 'approved') {
        bySubject[f.subject] = (bySubject[f.subject] || 0) + 1;
      }
    });

    res.json({ total, pending, exam, bySubject });
  } catch (err) {
    console.error('Stats error:', err.message);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ─── UPDATE STATUS (admin) ───────────────────────────────────

router.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be approved or rejected' });
  }

  try {
    const { data, error } = await supabase
      .from('files')
      .update({ status })
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    if (status === 'rejected' && data.drive_file_id) {
      await deleteFromDrive(data.drive_file_id).catch(() => {});
    }

    res.json({ message: `File ${status}`, file: data });
  } catch (err) {
    console.error('Update file status error:', err.message);
    res.status(500).json({ error: 'Failed to update file' });
  }
});

// ─── RENAME FILE (admin) ─────────────────────────────────────

router.patch('/:id/rename', requireAuth, requireAdmin, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });

  try {
    const { data, error } = await supabase
      .from('files')
      .update({ name: name.trim() })
      .eq('id', req.params.id)
      .select('*')
      .single();

    if (error) throw error;
    res.json({ message: 'File renamed', file: data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to rename file' });
  }
});

// ─── PIN/UNPIN FILE (admin) ──────────────────────────────────

router.patch('/:id/pin', requireAuth, requireAdmin, async (req, res) => {
  const { pinned } = req.body;

  try {
    const { data, error } = await supabase
      .from('files')
      .update({ pinned: !!pinned })
      .eq('id', req.params.id)
      .select('*')
      .single();

    if (error) throw error;
    res.json({ message: pinned ? 'File pinned' : 'File unpinned', file: data });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update pin status' });
  }
});

// ─── DELETE FILE (admin) ─────────────────────────────────────

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data: file, error: fetchErr } = await supabase
      .from('files')
      .select('drive_file_id')
      .eq('id', req.params.id)
      .single();

    if (fetchErr) throw fetchErr;

    if (file.drive_file_id) {
      await deleteFromDrive(file.drive_file_id).catch(() => {});
    }

    const { error: delErr } = await supabase.from('files').delete().eq('id', req.params.id);
    if (delErr) throw delErr;

    res.json({ message: 'File deleted' });
  } catch (err) {
    console.error('Delete file error:', err.message);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

module.exports = router;
