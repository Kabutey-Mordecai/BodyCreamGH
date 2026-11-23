-- Table for mobile device push tokens (Firebase Cloud Messaging)
CREATE TABLE IF NOT EXISTS user_devices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES users(id) ON DELETE CASCADE,
  fcm_token      TEXT NOT NULL UNIQUE,
  platform       VARCHAR(20) DEFAULT 'android',
  device_name    VARCHAR(100),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON user_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_user_devices_fcm_token ON user_devices(fcm_token);
