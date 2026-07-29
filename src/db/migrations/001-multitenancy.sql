-- ============================================================================
-- Cycle 1: Multitenancy Migration
-- ============================================================================

-- 1. Create users table (root of all multitenancy)
CREATE TABLE IF NOT EXISTS users (
  user_id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255),
  google_id VARCHAR(255) UNIQUE,
  tier VARCHAR(50) NOT NULL DEFAULT 'FREE'
    CHECK (tier IN ('FREE', 'BASIC', 'PRO', 'ENTERPRISE')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Create subscriptions table (1:1 with users)
CREATE TABLE IF NOT EXISTS subscriptions (
  subscription_id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
  tier VARCHAR(50) NOT NULL DEFAULT 'FREE',
  message_count_this_month INTEGER DEFAULT 0,
  month_reset_date DATE NOT NULL DEFAULT CURRENT_DATE,
  stripe_customer_id VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Create contacts table
CREATE TABLE IF NOT EXISTS contacts (
  contact_id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  phone_number VARCHAR(20) NOT NULL,
  email VARCHAR(255),
  company_name VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT contacts_user_phone_unique UNIQUE (user_id, phone_number)
);

-- 4. Create active_queue table (scheduled messages)
CREATE TABLE IF NOT EXISTS active_queue (
  queue_id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  recipient_phone VARCHAR(20) NOT NULL,
  recipient_name VARCHAR(255),
  message_body TEXT NOT NULL,
  channel VARCHAR(50) NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'gmail')),
  recipient_email VARCHAR(255),
  subject VARCHAR(255),
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Create templates table
CREATE TABLE IF NOT EXISTS templates (
  template_id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT templates_user_name_unique UNIQUE (user_id, name)
);

-- 6. Create monthly_usage table
CREATE TABLE IF NOT EXISTS monthly_usage (
  usage_id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  month DATE NOT NULL,
  message_count INTEGER DEFAULT 0,
  tier_snapshot VARCHAR(50) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT monthly_usage_user_month_unique UNIQUE (user_id, month)
);

-- 7. Create activity_log table
CREATE TABLE IF NOT EXISTS activity_log (
  log_id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. Create api_keys table (for Enterprise tier, Cycle 5)
CREATE TABLE IF NOT EXISTS api_keys (
  api_key_id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  key_hash VARCHAR(255) NOT NULL UNIQUE,
  key_prefix VARCHAR(10),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used_at TIMESTAMP WITH TIME ZONE,
  revoked_at TIMESTAMP WITH TIME ZONE
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_activity_log_user_created ON activity_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_active_queue_user_scheduled ON active_queue(user_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_active_queue_status ON active_queue(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_templates_user ON templates(user_id);
CREATE INDEX IF NOT EXISTS idx_monthly_usage_user_month ON monthly_usage(user_id, month DESC);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- ============================================================================
-- Data Seeding (Initial User for testing)
-- ============================================================================

INSERT INTO users (email, tier)
VALUES ('test@notnow.local', 'BASIC')
ON CONFLICT (email) DO NOTHING;

-- Seed subscription for the default user
INSERT INTO subscriptions (user_id, tier, message_count_this_month, month_reset_date)
SELECT user_id, 'BASIC', 0, CURRENT_DATE
FROM users WHERE email = 'test@notnow.local'
ON CONFLICT (user_id) DO NOTHING;

-- Seed a test contact
INSERT INTO contacts (user_id, name, phone_number, company_name)
SELECT user_id, 'Test Bot', '+972501234567', 'Test Company'
FROM users WHERE email = 'test@notnow.local'
ON CONFLICT (user_id, phone_number) DO NOTHING;
