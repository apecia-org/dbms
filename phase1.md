# Phase 1 — Version History & Saving

> **Why first:** Everything else depends on this. Diff, comparison, history — none of it works without stored versions.

## 1.1 Update Your SQLite Schema

Right now you likely have a single `schemas` table. Add versioning on top:

```sql
-- Rename or keep your existing table as the "project" concept
CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL DEFAULT 'Untitled schema',
  slug        TEXT UNIQUE,              -- for future public URLs
  db_type     TEXT DEFAULT 'PostgreSQL',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Each save = a new version row. Never overwrite.
CREATE TABLE IF NOT EXISTS versions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER NOT NULL REFERENCES projects(id),
  version_number INTEGER NOT NULL,       -- auto-increment per project
  label          TEXT,                   -- e.g. "Version 12" or custom tag
  dbml_content   TEXT NOT NULL,          -- raw DBML string
  parsed_schema  TEXT,                   -- JSON string of parsed AST (cache)
  note           TEXT,                   -- optional commit message
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_versions_project ON versions(project_id, version_number DESC);
```

## 1.2 Save Logic — Always Create a New Version

```javascript
// api/versions.js (or your backend handler)

async function saveVersion(projectId, dbmlContent, label = null) {
  // Get the next version number for this project
  const last = await db.get(
    `SELECT MAX(version_number) as max FROM versions WHERE project_id = ?`,
    [projectId]
  );
  const nextVersion = (last?.max ?? 0) + 1;

  // Parse and cache the schema
  let parsedSchema = null;
  try {
    const { Parser } = await import('@dbml/core');
    const parsed = Parser.parse(dbmlContent, 'dbml');
    parsedSchema = JSON.stringify(parsed);
  } catch (e) {
    // Save raw DBML even if parse fails — let UI show the error
  }

  await db.run(
    `INSERT INTO versions (project_id, version_number, label, dbml_content, parsed_schema)
     VALUES (?, ?, ?, ?, ?)`,
    [projectId, nextVersion, label ?? `Version ${nextVersion}`, dbmlContent, parsedSchema]
  );

  // Update project's updated_at
  await db.run(
    `UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [projectId]
  );

  return nextVersion;
}
```

## 1.3 Version Picker UI

Add this to your top toolbar, replacing the current "Unsaved schema" dropdown:

```jsx
function VersionPicker({ versions, currentVersion, onChange }) {
  return (
    <select
      value={currentVersion?.id}
      onChange={e => onChange(versions.find(v => v.id == e.target.value))}
      className="border rounded px-3 py-1.5 text-sm"
    >
      {versions.map(v => (
        <option key={v.id} value={v.id}>
          #{v.version_number} {v.label}
        </option>
      ))}
    </select>
  );
}
```

**What clicking a version does:** loads that version's `dbml_content` into the editor, read-only if not latest, and updates the ER diagram.

## 1.4 Save Button Behaviour Change

Change your save button from "overwrite" to "create new version":

```jsx
async function handleSave() {
  const note = prompt('Version note (optional):') ?? '';
  await saveVersion(currentProjectId, dbmlContent, note || null);
  await refreshVersionList(); // reload the version picker
  setStatus('Saved as new version ✓');
}
```
