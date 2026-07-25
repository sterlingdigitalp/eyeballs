use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::path::Path;

const MIGRATION_001: &str = include_str!("../migrations/001_initial.sql");

pub struct Database {
    connection: Connection,
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let connection = Connection::open(path).context("open application database")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection
            .execute_batch(MIGRATION_001)
            .context("run schema migration 001")?;
        Ok(Self { connection })
    }

    pub fn put_json(&self, bucket: &str, key: &str, value: &Value) -> Result<()> {
        let serialized = serde_json::to_string(value)?;
        self.connection.execute(
            "INSERT INTO json_records (bucket, record_key, value_json, updated_at)
             VALUES (?1, ?2, ?3, unixepoch())
             ON CONFLICT(bucket, record_key) DO UPDATE
             SET value_json = excluded.value_json, updated_at = excluded.updated_at",
            params![bucket, key, serialized],
        )?;
        Ok(())
    }

    pub fn get_json(&self, bucket: &str, key: &str) -> Result<Option<Value>> {
        let value: Option<String> = self
            .connection
            .query_row(
                "SELECT value_json FROM json_records WHERE bucket = ?1 AND record_key = ?2",
                params![bucket, key],
                |row| row.get(0),
            )
            .optional()?;
        value
            .map(|serialized| serde_json::from_str(&serialized).context("decode stored JSON"))
            .transpose()
    }

    pub fn list_json(&self, bucket: &str) -> Result<Vec<Value>> {
        let mut statement = self.connection.prepare(
            "SELECT value_json FROM json_records WHERE bucket = ?1 ORDER BY updated_at DESC, record_key",
        )?;
        let rows = statement.query_map([bucket], |row| row.get::<_, String>(0))?;
        rows.map(|row| {
            let serialized = row?;
            serde_json::from_str(&serialized).context("decode stored JSON")
        })
        .collect()
    }

    pub fn health(&self) -> Result<&'static str> {
        self.connection
            .query_row("PRAGMA quick_check", [], |row| row.get::<_, String>(0))?;
        Ok("ok")
    }
}

#[cfg(test)]
mod tests {
    use super::Database;
    use serde_json::json;

    #[test]
    fn migrates_and_round_trips_json() {
        let database = Database::open(":memory:").unwrap();
        database
            .put_json("profiles", "one", &json!({"name": "MacBook Practice"}))
            .unwrap();
        assert_eq!(
            database.get_json("profiles", "one").unwrap(),
            Some(json!({"name": "MacBook Practice"}))
        );
        assert_eq!(database.list_json("profiles").unwrap().len(), 1);
        assert_eq!(database.health().unwrap(), "ok");
    }
}
