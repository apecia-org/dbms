# DBML UI Editor

React + Rust web editor for DBML with text editing, diagram editing, export, save, optional Keycloak RBAC, and pluggable database persistence.

## Stack

- Frontend: Vite, React, TypeScript, Monaco, React Flow, `@dbml/core`.
- Backend: Rust, Axum, SQLx.
- Storage: SQLite by default, with Postgres and MariaDB/MySQL selected by `.env`.
- Auth: Optional Keycloak JWT validation. Without Keycloak env vars, local development runs as an editor.

## Run

```sh
cp .env.example .env
npm install
npm run server:dev
npm run dev
```

Frontend: `http://localhost:5173`

Backend: `http://127.0.0.1:8080`

## Environment

```env
STORAGE_PROVIDER=sqlite
DATABASE_URL=sqlite://./data/dbml-editor.sqlite
SERVER_HOST=127.0.0.1
SERVER_PORT=8080
CORS_ORIGIN=http://localhost:5173
```

Set `STORAGE_PROVIDER=postgres` with a `postgres://...` URL, or `STORAGE_PROVIDER=mariadb` with a `mysql://...` URL.

To enable Keycloak:

```env
KEYCLOAK_ISSUER=https://keycloak.example.com/realms/dbml
KEYCLOAK_CLIENT_ID=dbml-ui-editor
KEYCLOAK_AUDIENCE=dbml-ui-editor
```

Keycloak roles are mapped to `readonly` and `editor`. Mutating routes require `editor`.
