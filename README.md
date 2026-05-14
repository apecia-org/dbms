# DBML UI Editor

> A modern, self-hostable **DBML** editor that lets you design databases visually **and** in code — with a Rust backend fast enough to disappear and a React UI made to enjoy.

<p align="center">
  <a href="https://github.com/apecia-org/dbms/stargazers"><img src="https://img.shields.io/github/stars/apecia-org/dbms?style=for-the-badge&logo=github&color=ffca28" alt="Stars"></a>
  <a href="https://github.com/apecia-org/dbms/network/members"><img src="https://img.shields.io/github/forks/apecia-org/dbms?style=for-the-badge&logo=github&color=4c8bf5" alt="Forks"></a>
  <a href="https://github.com/apecia-org/dbms/issues"><img src="https://img.shields.io/github/issues/apecia-org/dbms?style=for-the-badge&color=db4437" alt="Issues"></a>
  <a href="https://github.com/apecia-org/dbms/pulls"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=for-the-badge" alt="PRs Welcome"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/free_forever-✓-success?style=for-the-badge" alt="Free Forever">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Vite-6-646cff?logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/Rust-edition_2024-dea584?logo=rust&logoColor=white" alt="Rust">
  <img src="https://img.shields.io/badge/Axum-0.8-7b3fe4" alt="Axum">
  <img src="https://img.shields.io/badge/SQLx-0.8-336791?logo=postgresql&logoColor=white" alt="SQLx">
  <img src="https://img.shields.io/badge/SQLite-•_Postgres_•_MariaDB-003b57?logo=sqlite&logoColor=white" alt="Databases">
</p>

<p align="center">
  <b>Design it. Diagram it. Ship it.</b><br/>
  Built for developers who treat schemas as code — <b>free forever, MIT licensed</b>.
</p>

<p align="center">
  <img src="./image.png" alt="DBML UI Editor screenshot" width="900">
</p>

---

## Why DBML UI Editor?

Most schema designers force you to pick a side: pretty diagrams **or** code‑as‑truth. This one gives you both, side by side, with zero lock‑in.

- **Two‑way editing** — type DBML and the diagram updates; drag tables and the code follows.
- **Tiny, fast backend** — a single Rust binary (Axum + SQLx) you can drop on any VPS.
- **Pluggable storage** — pick SQLite for hobby projects, Postgres for prod, MariaDB if that's your shop.
- **Optional auth** — runs open in dev, snaps onto Keycloak in production via JWT.
- **No SaaS, no telemetry** — your schemas stay yours.
- **Free forever** — MIT licensed, self-hosted, no paywalls, no "team plan" upsells.

If that resonates, please **leave a star** — it helps more people discover the project.

## Features

- DBML text editor powered by `@dbml/core`
- Interactive diagram view (React Flow / `@xyflow/react`)
- Live sync between code and diagram
- Export your schema (DBML / SQL)
- Persist projects to **SQLite**, **Postgres**, or **MariaDB/MySQL**
- Role‑based access control with **Keycloak** (`readonly`, `editor`)
- CORS‑aware Rust API ready for any frontend
- Single‑command local dev — no Docker required

## Project layout

```
client/  →  React + Vite + TypeScript + React Flow + @dbml/core
server/  →  Rust + Axum + SQLx (SQLite / Postgres / MySQL)
```

## Quick start

```sh
git clone https://github.com/apecia-org/dbms.git
cd dbms
cp .env.example .env
npm install
npm run server:dev     # Rust API on  http://127.0.0.1:8080
npm run dev            # React UI on  http://localhost:5173
```

That's it — open the UI and start designing.

## Configuration

Drop these into `.env`:

```env
STORAGE_PROVIDER=sqlite
DATABASE_URL=sqlite://./data/dbml-editor.sqlite
SERVER_HOST=127.0.0.1
SERVER_PORT=8080
CORS_ORIGIN=http://localhost:5173
```

| Variable           | Default                              | Description                                          |
| ------------------ | ------------------------------------ | ---------------------------------------------------- |
| `STORAGE_PROVIDER` | `sqlite`                             | `sqlite`, `postgres`, or `mariadb`                   |
| `DATABASE_URL`     | `sqlite://./data/dbml-editor.sqlite` | Connection string for the chosen provider            |
| `SERVER_HOST`      | `127.0.0.1`                          | Bind address for the Axum server                     |
| `SERVER_PORT`      | `8080`                               | Bind port                                            |
| `CORS_ORIGIN`      | `http://localhost:5173`              | Allowed frontend origin                              |

Switch databases by changing two lines:

```env
STORAGE_PROVIDER=postgres
DATABASE_URL=postgres://user:pass@localhost:5432/dbml
```

```env
STORAGE_PROVIDER=mariadb
DATABASE_URL=mysql://user:pass@localhost:3306/dbml
```

### Optional: Keycloak auth

```env
KEYCLOAK_ISSUER=https://keycloak.example.com/realms/dbml
KEYCLOAK_CLIENT_ID=dbml-ui-editor
KEYCLOAK_AUDIENCE=dbml-ui-editor
```

Map your realm roles to `readonly` or `editor`. Mutating routes require `editor`. Leave these unset and the app boots in open dev mode.

## Tech stack

| Layer    | Tools                                                                 |
| -------- | --------------------------------------------------------------------- |
| Frontend | React 19, TypeScript, Vite, React Flow (`@xyflow/react`), `@dbml/core`, `lucide-react` |
| Backend  | Rust (edition 2024), Axum, Tokio, SQLx, JWT (`jsonwebtoken`)          |
| Storage  | SQLite • PostgreSQL • MariaDB / MySQL                                 |
| Auth     | Optional Keycloak (OIDC / JWT)                                        |

## Roadmap

Building toward a full dbdocs.io‑class documentation tool, one phase at a time. See [`dbml-app-roadmap.md`](./dbml-app-roadmap.md) for the deep dive.

| Phase | What it ships | Status |
| ----- | ------------- | ------ |
| **1** | **Version history & saving** — every save is a new immutable version, labelled and timestamped | ✅ Done |
| **2** | **Wiki / documentation view** — Project / Table / column notes rendered as shareable docs (powered by `@dbml/core`) | ✅ Done |
| 3 | Left sidebar table tree — fast navigation across schemas | ⏳ Planned |
| 4 | Version comparison & diff — the killer feature for teams | ⏳ Planned |
| 5 | Search — instant fuzzy search across tables, columns, notes | ⏳ Planned |
| 6 | Public sharing & URLs — read‑only links for external stakeholders | ⏳ Planned |

Got a feature in mind? [Open an issue](https://github.com/apecia-org/dbms/issues/new) — feedback shapes the roadmap.

## Contributing

PRs are very welcome. The codebase is small, deliberately simple, and friendly to first‑time contributors.

1. Fork the repo
2. `npm install && npm run server:dev` + `npm run dev`
3. Make your change with a focused commit
4. Open a PR

If you're not sure where to start, check the [issues labeled `good first issue`](https://github.com/apecia-org/dbms/labels/good%20first%20issue).

## Show your support

If this project saves you time, **the cheapest way to say thanks is a star** — it genuinely helps the project grow and motivates further work.

<p align="center">
  <a href="https://github.com/apecia-org/dbms">
    <img src="https://img.shields.io/github/stars/apecia-org/dbms?style=social" alt="Star on GitHub">
  </a>
</p>

## License

[MIT](./LICENSE) — **free forever**. Use it personally, use it commercially, fork it, ship it. Just don't blame us.
