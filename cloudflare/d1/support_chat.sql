-- Cloudflare D1 live-support schema used by WellSupport and WellWebsite.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS support_conversations (
  id TEXT PRIMARY KEY,
  visitor_token_hash TEXT NOT NULL UNIQUE,
  realtime_topic TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  page_path TEXT,
  client_ip TEXT,
  visitor_city TEXT,
  visitor_region TEXT,
  visitor_country TEXT,
  visitor_country_code TEXT,
  visitor_timezone TEXT,
  browser_language TEXT,
  user_agent TEXT,
  metadata_expires_at TEXT,
  staff_joined_at TEXT,
  joined_agent_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS support_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('visitor','agent','system')),
  sender_user_id TEXT,
  sender_display_name TEXT,
  sender_avatar_url TEXT,
  client_message_id TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES support_conversations(id) ON DELETE CASCADE,
  UNIQUE (conversation_id, client_message_id)
);

CREATE TABLE IF NOT EXISTS support_conversation_reads (
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (conversation_id, user_id),
  FOREIGN KEY (conversation_id) REFERENCES support_conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS support_conversations_status_updated_idx
  ON support_conversations(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS support_messages_conversation_created_idx
  ON support_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS support_reads_user_idx
  ON support_conversation_reads(user_id, last_read_at DESC);
