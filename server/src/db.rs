use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{
    MySqlPool, PgPool, Row, SqlitePool, mysql::MySqlPoolOptions, postgres::PgPoolOptions,
    sqlite::SqliteConnectOptions, sqlite::SqlitePoolOptions,
};
use std::str::FromStr;
use uuid::Uuid;

use crate::config::{Config, StorageProvider};
use crate::error::AppError;

#[derive(Clone)]
pub enum Store {
    Sqlite(SqlitePool),
    Postgres(PgPool),
    MySql(MySqlPool),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: Uuid,
    pub name: String,
    pub dbml: String,
    pub layout_json: serde_json::Value,
    pub parsed_schema: Option<serde_json::Value>,
    pub owner_subject: String,
    pub version: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentVersion {
    pub id: Uuid,
    pub document_id: Uuid,
    pub version_number: i64,
    pub label: String,
    pub note: Option<String>,
    pub dbml: String,
    pub layout_json: serde_json::Value,
    pub parsed_schema: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentVersionSummary {
    pub id: Uuid,
    pub document_id: Uuid,
    pub version_number: i64,
    pub label: String,
    pub note: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertDocument {
    pub name: String,
    pub dbml: String,
    #[serde(default)]
    pub layout_json: serde_json::Value,
    #[serde(default)]
    pub parsed_schema: Option<serde_json::Value>,
    #[serde(default)]
    pub note: Option<String>,
}

impl Store {
    pub async fn connect(config: &Config) -> Result<Self> {
        match config.storage_provider {
            StorageProvider::Sqlite => {
                if let Some(path) = config.database_url.strip_prefix("sqlite://") {
                    if let Some(parent) = std::path::Path::new(path).parent() {
                        tokio::fs::create_dir_all(parent).await.ok();
                    }
                }
                let options =
                    SqliteConnectOptions::from_str(&config.database_url)?.create_if_missing(true);
                Ok(Self::Sqlite(
                    SqlitePoolOptions::new()
                        .max_connections(5)
                        .connect_with(options)
                        .await?,
                ))
            }
            StorageProvider::Postgres => Ok(Self::Postgres(
                PgPoolOptions::new()
                    .max_connections(10)
                    .connect(&config.database_url)
                    .await?,
            )),
            StorageProvider::MariaDb => Ok(Self::MySql(
                MySqlPoolOptions::new()
                    .max_connections(10)
                    .connect(&config.database_url)
                    .await?,
            )),
        }
    }

    pub async fn migrate(&self) -> Result<()> {
        match self {
            Store::Sqlite(pool) => {
                sqlx::query(
                    r#"
                    CREATE TABLE IF NOT EXISTS documents (
                      id TEXT PRIMARY KEY,
                      name TEXT NOT NULL,
                      dbml TEXT NOT NULL,
                      layout_json TEXT NOT NULL,
                      parsed_schema TEXT,
                      owner_subject TEXT NOT NULL,
                      version INTEGER NOT NULL,
                      created_at TEXT NOT NULL,
                      updated_at TEXT NOT NULL
                    )
                    "#,
                )
                .execute(pool)
                .await?;
                let _ = sqlx::query("ALTER TABLE documents ADD COLUMN parsed_schema TEXT")
                    .execute(pool)
                    .await;
                sqlx::query(
                    r#"
                    CREATE TABLE IF NOT EXISTS document_versions (
                      id TEXT PRIMARY KEY,
                      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                      version_number INTEGER NOT NULL,
                      label TEXT NOT NULL,
                      note TEXT,
                      dbml TEXT NOT NULL,
                      layout_json TEXT NOT NULL,
                      parsed_schema TEXT,
                      created_at TEXT NOT NULL,
                      UNIQUE(document_id, version_number)
                    )
                    "#,
                )
                .execute(pool)
                .await?;
                sqlx::query("CREATE INDEX IF NOT EXISTS idx_document_versions_document ON document_versions(document_id, version_number DESC)")
                    .execute(pool)
                    .await?;
            }
            Store::Postgres(pool) => {
                sqlx::query(
                    r#"
                    CREATE TABLE IF NOT EXISTS documents (
                      id UUID PRIMARY KEY,
                      name TEXT NOT NULL,
                      dbml TEXT NOT NULL,
                      layout_json JSONB NOT NULL,
                      parsed_schema JSONB,
                      owner_subject TEXT NOT NULL,
                      version BIGINT NOT NULL,
                      created_at TIMESTAMPTZ NOT NULL,
                      updated_at TIMESTAMPTZ NOT NULL
                    )
                    "#,
                )
                .execute(pool)
                .await?;
                sqlx::query("ALTER TABLE documents ADD COLUMN IF NOT EXISTS parsed_schema JSONB")
                    .execute(pool)
                    .await?;
                sqlx::query(
                    r#"
                    CREATE TABLE IF NOT EXISTS document_versions (
                      id UUID PRIMARY KEY,
                      document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                      version_number BIGINT NOT NULL,
                      label TEXT NOT NULL,
                      note TEXT,
                      dbml TEXT NOT NULL,
                      layout_json JSONB NOT NULL,
                      parsed_schema JSONB,
                      created_at TIMESTAMPTZ NOT NULL,
                      UNIQUE(document_id, version_number)
                    )
                    "#,
                )
                .execute(pool)
                .await?;
                sqlx::query("CREATE INDEX IF NOT EXISTS idx_document_versions_document ON document_versions(document_id, version_number DESC)")
                    .execute(pool)
                    .await?;
            }
            Store::MySql(pool) => {
                sqlx::query(
                    r#"
                    CREATE TABLE IF NOT EXISTS documents (
                      id CHAR(36) PRIMARY KEY,
                      name TEXT NOT NULL,
                      dbml LONGTEXT NOT NULL,
                      layout_json JSON NOT NULL,
                      parsed_schema JSON,
                      owner_subject TEXT NOT NULL,
                      version BIGINT NOT NULL,
                      created_at TIMESTAMP(6) NOT NULL,
                      updated_at TIMESTAMP(6) NOT NULL
                    )
                    "#,
                )
                .execute(pool)
                .await?;
                let _ = sqlx::query("ALTER TABLE documents ADD COLUMN parsed_schema JSON")
                    .execute(pool)
                    .await;
                sqlx::query(
                    r#"
                    CREATE TABLE IF NOT EXISTS document_versions (
                      id CHAR(36) PRIMARY KEY,
                      document_id CHAR(36) NOT NULL,
                      version_number BIGINT NOT NULL,
                      label TEXT NOT NULL,
                      note TEXT,
                      dbml LONGTEXT NOT NULL,
                      layout_json JSON NOT NULL,
                      parsed_schema JSON,
                      created_at TIMESTAMP(6) NOT NULL,
                      UNIQUE KEY uq_document_versions_document_version (document_id, version_number),
                      INDEX idx_document_versions_document (document_id, version_number DESC),
                      CONSTRAINT fk_document_versions_document FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
                    )
                    "#,
                )
                .execute(pool)
                .await?;
            }
        }
        Ok(())
    }

    pub async fn list_documents(&self) -> Result<Vec<Document>, AppError> {
        match self {
            Store::Sqlite(pool) => {
                let rows = sqlx::query("SELECT id, name, dbml, layout_json, parsed_schema, owner_subject, version, created_at, updated_at FROM documents ORDER BY updated_at DESC")
                    .fetch_all(pool)
                    .await?;
                rows.into_iter().map(document_from_sqlite).collect()
            }
            Store::Postgres(pool) => {
                let rows = sqlx::query("SELECT id, name, dbml, layout_json, parsed_schema, owner_subject, version, created_at, updated_at FROM documents ORDER BY updated_at DESC")
                    .fetch_all(pool)
                    .await?;
                Ok(rows
                    .into_iter()
                    .map(|row| Document {
                        id: row.get("id"),
                        name: row.get("name"),
                        dbml: row.get("dbml"),
                        layout_json: row.get("layout_json"),
                        parsed_schema: row.get("parsed_schema"),
                        owner_subject: row.get("owner_subject"),
                        version: row.get("version"),
                        created_at: row.get("created_at"),
                        updated_at: row.get("updated_at"),
                    })
                    .collect())
            }
            Store::MySql(pool) => {
                let rows = sqlx::query("SELECT id, name, dbml, layout_json, parsed_schema, owner_subject, version, created_at, updated_at FROM documents ORDER BY updated_at DESC")
                    .fetch_all(pool)
                    .await?;
                rows.into_iter().map(document_from_mysql).collect()
            }
        }
    }

    pub async fn create_document(
        &self,
        input: UpsertDocument,
        owner_subject: &str,
    ) -> Result<Document, AppError> {
        let now = Utc::now();
        let document = Document {
            id: Uuid::new_v4(),
            name: input.name,
            dbml: input.dbml,
            layout_json: input.layout_json,
            parsed_schema: input.parsed_schema,
            owner_subject: owner_subject.to_string(),
            version: 1,
            created_at: now,
            updated_at: now,
        };
        let version_id = Uuid::new_v4();
        let label = "Version 1".to_string();

        match self {
            Store::Sqlite(pool) => {
                sqlx::query("INSERT INTO documents (id, name, dbml, layout_json, parsed_schema, owner_subject, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
                    .bind(document.id.to_string())
                    .bind(&document.name)
                    .bind(&document.dbml)
                    .bind(document.layout_json.to_string())
                    .bind(document.parsed_schema.as_ref().map(serde_json::Value::to_string))
                    .bind(&document.owner_subject)
                    .bind(document.version)
                    .bind(document.created_at.to_rfc3339())
                    .bind(document.updated_at.to_rfc3339())
                    .execute(pool)
                    .await?;
                sqlx::query("INSERT INTO document_versions (id, document_id, version_number, label, note, dbml, layout_json, parsed_schema, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
                    .bind(version_id.to_string())
                    .bind(document.id.to_string())
                    .bind(document.version)
                    .bind(&label)
                    .bind(document_version_note(input.note.as_deref()))
                    .bind(&document.dbml)
                    .bind(document.layout_json.to_string())
                    .bind(document.parsed_schema.as_ref().map(serde_json::Value::to_string))
                    .bind(document.created_at.to_rfc3339())
                    .execute(pool)
                    .await?;
            }
            Store::Postgres(pool) => {
                sqlx::query("INSERT INTO documents (id, name, dbml, layout_json, parsed_schema, owner_subject, version, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)")
                    .bind(document.id)
                    .bind(&document.name)
                    .bind(&document.dbml)
                    .bind(&document.layout_json)
                    .bind(&document.parsed_schema)
                    .bind(&document.owner_subject)
                    .bind(document.version)
                    .bind(document.created_at)
                    .bind(document.updated_at)
                    .execute(pool)
                    .await?;
                sqlx::query("INSERT INTO document_versions (id, document_id, version_number, label, note, dbml, layout_json, parsed_schema, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)")
                    .bind(version_id)
                    .bind(document.id)
                    .bind(document.version)
                    .bind(&label)
                    .bind(document_version_note(input.note.as_deref()))
                    .bind(&document.dbml)
                    .bind(&document.layout_json)
                    .bind(&document.parsed_schema)
                    .bind(document.created_at)
                    .execute(pool)
                    .await?;
            }
            Store::MySql(pool) => {
                sqlx::query("INSERT INTO documents (id, name, dbml, layout_json, parsed_schema, owner_subject, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
                    .bind(document.id.to_string())
                    .bind(&document.name)
                    .bind(&document.dbml)
                    .bind(document.layout_json.to_string())
                    .bind(document.parsed_schema.as_ref().map(serde_json::Value::to_string))
                    .bind(&document.owner_subject)
                    .bind(document.version)
                    .bind(document.created_at.naive_utc())
                    .bind(document.updated_at.naive_utc())
                    .execute(pool)
                    .await?;
                sqlx::query("INSERT INTO document_versions (id, document_id, version_number, label, note, dbml, layout_json, parsed_schema, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
                    .bind(version_id.to_string())
                    .bind(document.id.to_string())
                    .bind(document.version)
                    .bind(&label)
                    .bind(document_version_note(input.note.as_deref()))
                    .bind(&document.dbml)
                    .bind(document.layout_json.to_string())
                    .bind(document.parsed_schema.as_ref().map(serde_json::Value::to_string))
                    .bind(document.created_at.naive_utc())
                    .execute(pool)
                    .await?;
            }
        }

        Ok(document)
    }

    pub async fn update_document(
        &self,
        id: Uuid,
        input: UpsertDocument,
    ) -> Result<Document, AppError> {
        let existing = self.get_document(id).await?;
        let now = Utc::now();
        let next_version = existing.version + 1;
        let version_id = Uuid::new_v4();
        let label = format!("Version {next_version}");
        match self {
            Store::Sqlite(pool) => {
                let mut tx = pool.begin().await?;
                sqlx::query("INSERT INTO document_versions (id, document_id, version_number, label, note, dbml, layout_json, parsed_schema, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
                    .bind(version_id.to_string())
                    .bind(id.to_string())
                    .bind(next_version)
                    .bind(&label)
                    .bind(document_version_note(input.note.as_deref()))
                    .bind(&input.dbml)
                    .bind(input.layout_json.to_string())
                    .bind(input.parsed_schema.as_ref().map(serde_json::Value::to_string))
                    .bind(now.to_rfc3339())
                    .execute(&mut *tx)
                    .await?;
                sqlx::query("UPDATE documents SET name = ?, dbml = ?, layout_json = ?, parsed_schema = ?, version = ?, updated_at = ? WHERE id = ?")
                    .bind(&input.name)
                    .bind(&input.dbml)
                    .bind(input.layout_json.to_string())
                    .bind(input.parsed_schema.as_ref().map(serde_json::Value::to_string))
                    .bind(next_version)
                    .bind(now.to_rfc3339())
                    .bind(id.to_string())
                    .execute(&mut *tx)
                    .await?;
                tx.commit().await?;
            }
            Store::Postgres(pool) => {
                let mut tx = pool.begin().await?;
                sqlx::query("INSERT INTO document_versions (id, document_id, version_number, label, note, dbml, layout_json, parsed_schema, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)")
                    .bind(version_id)
                    .bind(id)
                    .bind(next_version)
                    .bind(&label)
                    .bind(document_version_note(input.note.as_deref()))
                    .bind(&input.dbml)
                    .bind(&input.layout_json)
                    .bind(&input.parsed_schema)
                    .bind(now)
                    .execute(&mut *tx)
                    .await?;
                sqlx::query("UPDATE documents SET name = $1, dbml = $2, layout_json = $3, parsed_schema = $4, version = $5, updated_at = $6 WHERE id = $7")
                    .bind(&input.name)
                    .bind(&input.dbml)
                    .bind(&input.layout_json)
                    .bind(&input.parsed_schema)
                    .bind(next_version)
                    .bind(now)
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
                tx.commit().await?;
            }
            Store::MySql(pool) => {
                let mut tx = pool.begin().await?;
                sqlx::query("INSERT INTO document_versions (id, document_id, version_number, label, note, dbml, layout_json, parsed_schema, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
                    .bind(version_id.to_string())
                    .bind(id.to_string())
                    .bind(next_version)
                    .bind(&label)
                    .bind(document_version_note(input.note.as_deref()))
                    .bind(&input.dbml)
                    .bind(input.layout_json.to_string())
                    .bind(input.parsed_schema.as_ref().map(serde_json::Value::to_string))
                    .bind(now.naive_utc())
                    .execute(&mut *tx)
                    .await?;
                sqlx::query("UPDATE documents SET name = ?, dbml = ?, layout_json = ?, parsed_schema = ?, version = ?, updated_at = ? WHERE id = ?")
                    .bind(&input.name)
                    .bind(&input.dbml)
                    .bind(input.layout_json.to_string())
                    .bind(input.parsed_schema.as_ref().map(serde_json::Value::to_string))
                    .bind(next_version)
                    .bind(now.naive_utc())
                    .bind(id.to_string())
                    .execute(&mut *tx)
                    .await?;
                tx.commit().await?;
            }
        }
        self.get_document(id).await
    }

    pub async fn get_document(&self, id: Uuid) -> Result<Document, AppError> {
        match self {
            Store::Sqlite(pool) => {
                let row = sqlx::query("SELECT id, name, dbml, layout_json, parsed_schema, owner_subject, version, created_at, updated_at FROM documents WHERE id = ?")
                    .bind(id.to_string())
                    .fetch_optional(pool)
                    .await?
                    .ok_or(AppError::NotFound)?;
                document_from_sqlite(row)
            }
            Store::Postgres(pool) => {
                let row = sqlx::query("SELECT id, name, dbml, layout_json, parsed_schema, owner_subject, version, created_at, updated_at FROM documents WHERE id = $1")
                    .bind(id)
                    .fetch_optional(pool)
                    .await?
                    .ok_or(AppError::NotFound)?;
                Ok(Document {
                    id: row.get("id"),
                    name: row.get("name"),
                    dbml: row.get("dbml"),
                    layout_json: row.get("layout_json"),
                    parsed_schema: row.get("parsed_schema"),
                    owner_subject: row.get("owner_subject"),
                    version: row.get("version"),
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                })
            }
            Store::MySql(pool) => {
                let row = sqlx::query("SELECT id, name, dbml, layout_json, parsed_schema, owner_subject, version, created_at, updated_at FROM documents WHERE id = ?")
                    .bind(id.to_string())
                    .fetch_optional(pool)
                    .await?
                    .ok_or(AppError::NotFound)?;
                document_from_mysql(row)
            }
        }
    }

    pub async fn delete_document(&self, id: Uuid) -> Result<(), AppError> {
        match self {
            Store::Sqlite(pool) => {
                sqlx::query("DELETE FROM document_versions WHERE document_id = ?")
                    .bind(id.to_string())
                    .execute(pool)
                    .await?;
                sqlx::query("DELETE FROM documents WHERE id = ?")
                    .bind(id.to_string())
                    .execute(pool)
                    .await?;
            }
            Store::Postgres(pool) => {
                sqlx::query("DELETE FROM document_versions WHERE document_id = $1")
                    .bind(id)
                    .execute(pool)
                    .await?;
                sqlx::query("DELETE FROM documents WHERE id = $1")
                    .bind(id)
                    .execute(pool)
                    .await?;
            }
            Store::MySql(pool) => {
                sqlx::query("DELETE FROM document_versions WHERE document_id = ?")
                    .bind(id.to_string())
                    .execute(pool)
                    .await?;
                sqlx::query("DELETE FROM documents WHERE id = ?")
                    .bind(id.to_string())
                    .execute(pool)
                    .await?;
            }
        }
        Ok(())
    }

    pub async fn list_document_versions(
        &self,
        document_id: Uuid,
    ) -> Result<Vec<DocumentVersionSummary>, AppError> {
        match self {
            Store::Sqlite(pool) => {
                let rows = sqlx::query("SELECT id, document_id, version_number, label, note, created_at FROM document_versions WHERE document_id = ? ORDER BY version_number DESC")
                    .bind(document_id.to_string())
                    .fetch_all(pool)
                    .await?;
                rows.into_iter()
                    .map(document_version_summary_from_sqlite)
                    .collect()
            }
            Store::Postgres(pool) => {
                let rows = sqlx::query("SELECT id, document_id, version_number, label, note, created_at FROM document_versions WHERE document_id = $1 ORDER BY version_number DESC")
                    .bind(document_id)
                    .fetch_all(pool)
                    .await?;
                Ok(rows
                    .into_iter()
                    .map(|row| DocumentVersionSummary {
                        id: row.get("id"),
                        document_id: row.get("document_id"),
                        version_number: row.get("version_number"),
                        label: row.get("label"),
                        note: row.get("note"),
                        created_at: row.get("created_at"),
                    })
                    .collect())
            }
            Store::MySql(pool) => {
                let rows = sqlx::query("SELECT id, document_id, version_number, label, note, created_at FROM document_versions WHERE document_id = ? ORDER BY version_number DESC")
                    .bind(document_id.to_string())
                    .fetch_all(pool)
                    .await?;
                rows.into_iter()
                    .map(document_version_summary_from_mysql)
                    .collect()
            }
        }
    }

    pub async fn get_document_version(
        &self,
        document_id: Uuid,
        version_number: i64,
    ) -> Result<DocumentVersion, AppError> {
        match self {
            Store::Sqlite(pool) => {
                let row = sqlx::query("SELECT id, document_id, version_number, label, note, dbml, layout_json, parsed_schema, created_at FROM document_versions WHERE document_id = ? AND version_number = ?")
                    .bind(document_id.to_string())
                    .bind(version_number)
                    .fetch_optional(pool)
                    .await?
                    .ok_or(AppError::NotFound)?;
                document_version_from_sqlite(row)
            }
            Store::Postgres(pool) => {
                let row = sqlx::query("SELECT id, document_id, version_number, label, note, dbml, layout_json, parsed_schema, created_at FROM document_versions WHERE document_id = $1 AND version_number = $2")
                    .bind(document_id)
                    .bind(version_number)
                    .fetch_optional(pool)
                    .await?
                    .ok_or(AppError::NotFound)?;
                Ok(DocumentVersion {
                    id: row.get("id"),
                    document_id: row.get("document_id"),
                    version_number: row.get("version_number"),
                    label: row.get("label"),
                    note: row.get("note"),
                    dbml: row.get("dbml"),
                    layout_json: row.get("layout_json"),
                    parsed_schema: row.get("parsed_schema"),
                    created_at: row.get("created_at"),
                })
            }
            Store::MySql(pool) => {
                let row = sqlx::query("SELECT id, document_id, version_number, label, note, dbml, layout_json, parsed_schema, created_at FROM document_versions WHERE document_id = ? AND version_number = ?")
                    .bind(document_id.to_string())
                    .bind(version_number)
                    .fetch_optional(pool)
                    .await?
                    .ok_or(AppError::NotFound)?;
                document_version_from_mysql(row)
            }
        }
    }
}

fn document_from_sqlite(row: sqlx::sqlite::SqliteRow) -> Result<Document, AppError> {
    let id: String = row.get("id");
    let layout_json: String = row.get("layout_json");
    let parsed_schema: Option<String> = row.get("parsed_schema");
    let created_at: String = row.get("created_at");
    let updated_at: String = row.get("updated_at");
    Ok(Document {
        id: Uuid::parse_str(&id).map_err(|error| AppError::BadRequest(error.to_string()))?,
        name: row.get("name"),
        dbml: row.get("dbml"),
        layout_json: serde_json::from_str(&layout_json).unwrap_or(serde_json::Value::Null),
        parsed_schema: parsed_schema
            .as_deref()
            .and_then(|value| serde_json::from_str(value).ok()),
        owner_subject: row.get("owner_subject"),
        version: row.get("version"),
        created_at: DateTime::parse_from_rfc3339(&created_at)
            .map_err(|error| AppError::BadRequest(error.to_string()))?
            .with_timezone(&Utc),
        updated_at: DateTime::parse_from_rfc3339(&updated_at)
            .map_err(|error| AppError::BadRequest(error.to_string()))?
            .with_timezone(&Utc),
    })
}

fn document_from_mysql(row: sqlx::mysql::MySqlRow) -> Result<Document, AppError> {
    let id: String = row.get("id");
    let layout_json: String = row.get("layout_json");
    let parsed_schema: Option<String> = row.get("parsed_schema");
    let created_at: chrono::NaiveDateTime = row.get("created_at");
    let updated_at: chrono::NaiveDateTime = row.get("updated_at");
    Ok(Document {
        id: Uuid::parse_str(&id).map_err(|error| AppError::BadRequest(error.to_string()))?,
        name: row.get("name"),
        dbml: row.get("dbml"),
        layout_json: serde_json::from_str(&layout_json).unwrap_or(serde_json::Value::Null),
        parsed_schema: parsed_schema
            .as_deref()
            .and_then(|value| serde_json::from_str(value).ok()),
        owner_subject: row.get("owner_subject"),
        version: row.get("version"),
        created_at: DateTime::from_naive_utc_and_offset(created_at, Utc),
        updated_at: DateTime::from_naive_utc_and_offset(updated_at, Utc),
    })
}

fn document_version_note(note: Option<&str>) -> Option<String> {
    note.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn document_version_summary_from_sqlite(
    row: sqlx::sqlite::SqliteRow,
) -> Result<DocumentVersionSummary, AppError> {
    let id: String = row.get("id");
    let document_id: String = row.get("document_id");
    let created_at: String = row.get("created_at");
    Ok(DocumentVersionSummary {
        id: Uuid::parse_str(&id).map_err(|error| AppError::BadRequest(error.to_string()))?,
        document_id: Uuid::parse_str(&document_id)
            .map_err(|error| AppError::BadRequest(error.to_string()))?,
        version_number: row.get("version_number"),
        label: row.get("label"),
        note: row.get("note"),
        created_at: DateTime::parse_from_rfc3339(&created_at)
            .map_err(|error| AppError::BadRequest(error.to_string()))?
            .with_timezone(&Utc),
    })
}

fn document_version_from_sqlite(row: sqlx::sqlite::SqliteRow) -> Result<DocumentVersion, AppError> {
    let id: String = row.get("id");
    let document_id: String = row.get("document_id");
    let layout_json: String = row.get("layout_json");
    let parsed_schema: Option<String> = row.get("parsed_schema");
    let created_at: String = row.get("created_at");
    Ok(DocumentVersion {
        id: Uuid::parse_str(&id).map_err(|error| AppError::BadRequest(error.to_string()))?,
        document_id: Uuid::parse_str(&document_id)
            .map_err(|error| AppError::BadRequest(error.to_string()))?,
        version_number: row.get("version_number"),
        label: row.get("label"),
        note: row.get("note"),
        dbml: row.get("dbml"),
        layout_json: serde_json::from_str(&layout_json).unwrap_or(serde_json::Value::Null),
        parsed_schema: parsed_schema
            .as_deref()
            .and_then(|value| serde_json::from_str(value).ok()),
        created_at: DateTime::parse_from_rfc3339(&created_at)
            .map_err(|error| AppError::BadRequest(error.to_string()))?
            .with_timezone(&Utc),
    })
}

fn document_version_summary_from_mysql(
    row: sqlx::mysql::MySqlRow,
) -> Result<DocumentVersionSummary, AppError> {
    let id: String = row.get("id");
    let document_id: String = row.get("document_id");
    let created_at: chrono::NaiveDateTime = row.get("created_at");
    Ok(DocumentVersionSummary {
        id: Uuid::parse_str(&id).map_err(|error| AppError::BadRequest(error.to_string()))?,
        document_id: Uuid::parse_str(&document_id)
            .map_err(|error| AppError::BadRequest(error.to_string()))?,
        version_number: row.get("version_number"),
        label: row.get("label"),
        note: row.get("note"),
        created_at: DateTime::from_naive_utc_and_offset(created_at, Utc),
    })
}

fn document_version_from_mysql(row: sqlx::mysql::MySqlRow) -> Result<DocumentVersion, AppError> {
    let id: String = row.get("id");
    let document_id: String = row.get("document_id");
    let layout_json: String = row.get("layout_json");
    let parsed_schema: Option<String> = row.get("parsed_schema");
    let created_at: chrono::NaiveDateTime = row.get("created_at");
    Ok(DocumentVersion {
        id: Uuid::parse_str(&id).map_err(|error| AppError::BadRequest(error.to_string()))?,
        document_id: Uuid::parse_str(&document_id)
            .map_err(|error| AppError::BadRequest(error.to_string()))?,
        version_number: row.get("version_number"),
        label: row.get("label"),
        note: row.get("note"),
        dbml: row.get("dbml"),
        layout_json: serde_json::from_str(&layout_json).unwrap_or(serde_json::Value::Null),
        parsed_schema: parsed_schema
            .as_deref()
            .and_then(|value| serde_json::from_str(value).ok()),
        created_at: DateTime::from_naive_utc_and_offset(created_at, Utc),
    })
}
