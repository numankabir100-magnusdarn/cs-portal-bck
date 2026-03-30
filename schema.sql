-- ─────────────────────────────────────────────────────────────
-- CS PORTAL — DATABASE SCHEMA v3.0
-- COMSATS University Islamabad · BCS · 8 Semesters
--
-- ⚠️  DROPS old tables. Run in Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS announcements CASCADE;
DROP TABLE IF EXISTS files CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- 1. Users
CREATE TABLE users (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name   text NOT NULL,
  email       text UNIQUE NOT NULL,
  password    text NOT NULL,
  role            text DEFAULT 'student'  CHECK (role   IN ('admin', 'teacher', 'student')),
  status          text DEFAULT 'pending'  CHECK (status IN ('pending', 'approved', 'rejected')),
  reset_requested boolean DEFAULT false,
  created_at      timestamptz DEFAULT now() NOT NULL
);

-- 2. Files (course materials + exam materials)
CREATE TABLE files (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name          text    NOT NULL,
  subject       text    NOT NULL,
  folder        text    NOT NULL,
  section       text    DEFAULT 'course' CHECK (section IN ('course', 'exam')),
  semester      int     DEFAULT 1,
  drive_url     text    NOT NULL,
  drive_file_id text,
  file_size     bigint  DEFAULT 0,
  mime_type     text,
  uploaded_by   uuid    REFERENCES users(id) ON DELETE SET NULL,
  pinned        boolean DEFAULT false,
  status        text    DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at    timestamptz DEFAULT now() NOT NULL
);

-- 3. Announcements
CREATE TABLE announcements (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title       text NOT NULL,
  body        text,
  category    text DEFAULT 'general' CHECK (category IN ('assignment','exam','general','event')),
  subject     text,
  semester    int  DEFAULT 1,
  deadline    timestamptz,
  priority    text DEFAULT 'normal' CHECK (priority IN ('normal','important','urgent')),
  pinned      boolean DEFAULT false,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  status      text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at  timestamptz DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX idx_files_subject   ON files (subject);
CREATE INDEX idx_files_section   ON files (section);
CREATE INDEX idx_files_semester  ON files (semester);
CREATE INDEX idx_files_status    ON files (status);
CREATE INDEX idx_files_search    ON files USING gin (to_tsvector('english', name));
CREATE INDEX idx_users_email     ON users (email);
CREATE INDEX idx_users_status    ON users (status);
CREATE INDEX idx_ann_semester    ON announcements (semester);
CREATE INDEX idx_ann_status      ON announcements (status);
CREATE INDEX idx_ann_deadline    ON announcements (deadline);

-- ─────────────────────────────────────────────────────────────
-- After running: sign up, then make yourself admin:
--   UPDATE users SET role='admin', status='approved'
--   WHERE email='your@email.com';
-- ─────────────────────────────────────────────────────────────
