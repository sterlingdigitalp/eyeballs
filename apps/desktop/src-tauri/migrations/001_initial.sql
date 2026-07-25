CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);

CREATE TABLE IF NOT EXISTS json_records (
    bucket TEXT NOT NULL,
    record_key TEXT NOT NULL,
    value_json TEXT NOT NULL CHECK(json_valid(value_json)),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (bucket, record_key)
);

CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    occurred_at INTEGER NOT NULL,
    correlation_id TEXT,
    event_type TEXT NOT NULL,
    subject_id TEXT,
    details_json TEXT NOT NULL CHECK(json_valid(details_json))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_correlation ON audit_log(correlation_id, occurred_at);
