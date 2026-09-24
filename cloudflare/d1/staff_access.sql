-- WellSupport staff identity for Cloudflare Access + D1.
-- Passwords are not stored or verified by WellSupport.
-- Cloudflare Access authenticates the email before requests reach the dashboard.

CREATE TABLE IF NOT EXISTS staff_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'support'
    CHECK (role IN ('support', 'editor', 'publisher', 'admin')),
  active INTEGER NOT NULL DEFAULT 1
    CHECK (active IN (0, 1)),
  access_subject TEXT UNIQUE,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_users_email_ci
  ON staff_users(lower(email));

-- Example:
-- INSERT INTO staff_users (email, display_name, role)
-- VALUES ('staff@wellcollegeglobal.com', 'Staff Name', 'admin');
--
-- If an older staff_users table still contains password_hash, it can remain
-- during migration. WellSupport no longer reads or validates that column.
