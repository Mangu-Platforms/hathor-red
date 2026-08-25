-- Migration 009: Security & compliance — audit log, GDPR export, deletion
-- Project Olympus M6 (P0 security sprint). Additive only.

BEGIN;

-- Append-only audit trail for sensitive actions (logins, purchases, catalog
-- changes, privacy requests, admin operations).
CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(60) NOT NULL,
    target_type VARCHAR(40),
    target_id INTEGER,
    detail JSONB NOT NULL DEFAULT '{}',
    ip VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_time ON audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);

-- GDPR data export requests (72h SLA). The export job writes a JSON artifact
-- and mints a download token valid until expires_at.
CREATE TABLE IF NOT EXISTS data_export_requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- pending | processing | ready | failed | expired
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    file_path VARCHAR(500),
    download_token CHAR(64) UNIQUE,
    expires_at TIMESTAMP,
    error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_data_export_requests_user ON data_export_requests(user_id, created_at DESC);

-- Account deletion requests. Purge execution is a policy decision (financial
-- records must be retained) — the request/cancel flow is implemented; the
-- purge worker is the documented follow-up (see docs/olympus).
CREATE TABLE IF NOT EXISTS deletion_requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- pending | canceled | completed
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    reason TEXT,
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deletion_requests_one_pending
    ON deletion_requests(user_id)
    WHERE status = 'pending';

COMMIT;
