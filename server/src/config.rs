use anyhow::{Context, Result};

#[derive(Clone, Debug)]
pub enum StorageProvider {
    Sqlite,
    Postgres,
    MariaDb,
}

#[derive(Clone, Debug)]
pub struct Config {
    pub storage_provider: StorageProvider,
    pub database_url: String,
    pub server_host: String,
    pub server_port: u16,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let storage_provider = match std::env::var("STORAGE_PROVIDER")
            .unwrap_or_else(|_| "sqlite".to_string())
            .as_str()
        {
            "sqlite" => StorageProvider::Sqlite,
            "postgres" | "postgresql" => StorageProvider::Postgres,
            "mariadb" | "mysql" => StorageProvider::MariaDb,
            other => anyhow::bail!("unsupported STORAGE_PROVIDER: {other}"),
        };

        Ok(Self {
            storage_provider,
            database_url: std::env::var("DATABASE_URL")
                .unwrap_or_else(|_| "sqlite://./data/dbml-editor.sqlite".to_string()),
            server_host: std::env::var("SERVER_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
            server_port: std::env::var("SERVER_PORT")
                .unwrap_or_else(|_| "8080".to_string())
                .parse()
                .context("SERVER_PORT must be a number")?,
        })
    }
}
