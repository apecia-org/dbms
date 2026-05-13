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
    pub owner_subject: String,
    pub version: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertDocument {
    pub name: String,
    pub dbml: String,
    #[serde(default)]
    pub layout_json: serde_json::Value,
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
                      owner_subject TEXT NOT NULL,
                      version INTEGER NOT NULL,
                      created_at TEXT NOT NULL,
                      updated_at TEXT NOT NULL
                    )
                    "#,
                )
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
                      owner_subject TEXT NOT NULL,
                      version BIGINT NOT NULL,
                      created_at TIMESTAMPTZ NOT NULL,
                      updated_at TIMESTAMPTZ NOT NULL
                    )
                    "#,
                )
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
                      owner_subject TEXT NOT NULL,
                      version BIGINT NOT NULL,
                      created_at TIMESTAMP(6) NOT NULL,
                      updated_at TIMESTAMP(6) NOT NULL
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
                let rows = sqlx::query("SELECT id, name, dbml, layout_json, owner_subject, version, created_at, updated_at FROM documents ORDER BY updated_at DESC")
                    .fetch_all(pool)
                    .await?;
                rows.into_iter().map(document_from_sqlite).collect()
            }
            Store::Postgres(pool) => {
                let rows = sqlx::query("SELECT id, name, dbml, layout_json, owner_subject, version, created_at, updated_at FROM documents ORDER BY updated_at DESC")
                    .fetch_all(pool)
                    .await?;
                Ok(rows
                    .into_iter()
                    .map(|row| Document {
                        id: row.get("id"),
                        name: row.get("name"),
                        dbml: row.get("dbml"),
                        layout_json: row.get("layout_json"),
                        owner_subject: row.get("owner_subject"),
                        version: row.get("version"),
                        created_at: row.get("created_at"),
                        updated_at: row.get("updated_at"),
                    })
                    .collect())
            }
            Store::MySql(pool) => {
                let rows = sqlx::query("SELECT id, name, dbml, layout_json, owner_subject, version, created_at, updated_at FROM documents ORDER BY updated_at DESC")
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
            owner_subject: owner_subject.to_string(),
            version: 1,
            created_at: now,
            updated_at: now,
        };

        match self {
            Store::Sqlite(pool) => {
                sqlx::query("INSERT INTO documents (id, name, dbml, layout_json, owner_subject, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
                    .bind(document.id.to_string())
                    .bind(&document.name)
                    .bind(&document.dbml)
                    .bind(document.layout_json.to_string())
                    .bind(&document.owner_subject)
                    .bind(document.version)
                    .bind(document.created_at.to_rfc3339())
                    .bind(document.updated_at.to_rfc3339())
                    .execute(pool)
                    .await?;
            }
            Store::Postgres(pool) => {
                sqlx::query("INSERT INTO documents (id, name, dbml, layout_json, owner_subject, version, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)")
                    .bind(document.id)
                    .bind(&document.name)
                    .bind(&document.dbml)
                    .bind(&document.layout_json)
                    .bind(&document.owner_subject)
                    .bind(document.version)
                    .bind(document.created_at)
                    .bind(document.updated_at)
                    .execute(pool)
                    .await?;
            }
            Store::MySql(pool) => {
                sqlx::query("INSERT INTO documents (id, name, dbml, layout_json, owner_subject, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
                    .bind(document.id.to_string())
                    .bind(&document.name)
                    .bind(&document.dbml)
                    .bind(document.layout_json.to_string())
                    .bind(&document.owner_subject)
                    .bind(document.version)
                    .bind(document.created_at.naive_utc())
                    .bind(document.updated_at.naive_utc())
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
        match self {
            Store::Sqlite(pool) => {
                sqlx::query("UPDATE documents SET name = ?, dbml = ?, layout_json = ?, version = ?, updated_at = ? WHERE id = ?")
                    .bind(&input.name)
                    .bind(&input.dbml)
                    .bind(input.layout_json.to_string())
                    .bind(existing.version + 1)
                    .bind(now.to_rfc3339())
                    .bind(id.to_string())
                    .execute(pool)
                    .await?;
            }
            Store::Postgres(pool) => {
                sqlx::query("UPDATE documents SET name = $1, dbml = $2, layout_json = $3, version = $4, updated_at = $5 WHERE id = $6")
                    .bind(&input.name)
                    .bind(&input.dbml)
                    .bind(&input.layout_json)
                    .bind(existing.version + 1)
                    .bind(now)
                    .bind(id)
                    .execute(pool)
                    .await?;
            }
            Store::MySql(pool) => {
                sqlx::query("UPDATE documents SET name = ?, dbml = ?, layout_json = ?, version = ?, updated_at = ? WHERE id = ?")
                    .bind(&input.name)
                    .bind(&input.dbml)
                    .bind(input.layout_json.to_string())
                    .bind(existing.version + 1)
                    .bind(now.naive_utc())
                    .bind(id.to_string())
                    .execute(pool)
                    .await?;
            }
        }
        self.get_document(id).await
    }

    pub async fn get_document(&self, id: Uuid) -> Result<Document, AppError> {
        match self {
            Store::Sqlite(pool) => {
                let row = sqlx::query("SELECT id, name, dbml, layout_json, owner_subject, version, created_at, updated_at FROM documents WHERE id = ?")
                    .bind(id.to_string())
                    .fetch_optional(pool)
                    .await?
                    .ok_or(AppError::NotFound)?;
                document_from_sqlite(row)
            }
            Store::Postgres(pool) => {
                let row = sqlx::query("SELECT id, name, dbml, layout_json, owner_subject, version, created_at, updated_at FROM documents WHERE id = $1")
                    .bind(id)
                    .fetch_optional(pool)
                    .await?
                    .ok_or(AppError::NotFound)?;
                Ok(Document {
                    id: row.get("id"),
                    name: row.get("name"),
                    dbml: row.get("dbml"),
                    layout_json: row.get("layout_json"),
                    owner_subject: row.get("owner_subject"),
                    version: row.get("version"),
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                })
            }
            Store::MySql(pool) => {
                let row = sqlx::query("SELECT id, name, dbml, layout_json, owner_subject, version, created_at, updated_at FROM documents WHERE id = ?")
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
                sqlx::query("DELETE FROM documents WHERE id = ?")
                    .bind(id.to_string())
                    .execute(pool)
                    .await?;
            }
            Store::Postgres(pool) => {
                sqlx::query("DELETE FROM documents WHERE id = $1")
                    .bind(id)
                    .execute(pool)
                    .await?;
            }
            Store::MySql(pool) => {
                sqlx::query("DELETE FROM documents WHERE id = ?")
                    .bind(id.to_string())
                    .execute(pool)
                    .await?;
            }
        }
        Ok(())
    }
}

fn document_from_sqlite(row: sqlx::sqlite::SqliteRow) -> Result<Document, AppError> {
    let id: String = row.get("id");
    let layout_json: String = row.get("layout_json");
    let created_at: String = row.get("created_at");
    let updated_at: String = row.get("updated_at");
    Ok(Document {
        id: Uuid::parse_str(&id).map_err(|error| AppError::BadRequest(error.to_string()))?,
        name: row.get("name"),
        dbml: row.get("dbml"),
        layout_json: serde_json::from_str(&layout_json).unwrap_or(serde_json::Value::Null),
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
    let created_at: chrono::NaiveDateTime = row.get("created_at");
    let updated_at: chrono::NaiveDateTime = row.get("updated_at");
    Ok(Document {
        id: Uuid::parse_str(&id).map_err(|error| AppError::BadRequest(error.to_string()))?,
        name: row.get("name"),
        dbml: row.get("dbml"),
        layout_json: serde_json::from_str(&layout_json).unwrap_or(serde_json::Value::Null),
        owner_subject: row.get("owner_subject"),
        version: row.get("version"),
        created_at: DateTime::from_naive_utc_and_offset(created_at, Utc),
        updated_at: DateTime::from_naive_utc_and_offset(updated_at, Utc),
    })
}
