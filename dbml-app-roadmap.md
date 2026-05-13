# DBML App — Full Implementation Roadmap
> From DBML Editor → Full dbdocs.io Clone

**Current state:** Vite + React frontend, DBML editor with live ER diagram (React Flow), SQLite storage  
**Goal:** A fully-featured database documentation tool with versioning, wiki view, schema diffing, search, and public sharing

---

## Overview: The 6 Phases

| Phase | What You Build | Effort |
|---|---|---|
| 1 | Version history & saving | ~1–2 days |
| 2 | Wiki / documentation view | ~2–3 days |
| 3 | Left sidebar table tree | ~1 day |
| 4 | Version comparison & diff | ~2–3 days |
| 5 | Search | ~1 day |
| 6 | Public sharing & URLs | ~2 days |

---

## Phase 1 — Version History & Saving

> **Why first:** Everything else depends on this. Diff, comparison, history — none of it works without stored versions.

### 1.1 Update Your SQLite Schema

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

### 1.2 Save Logic — Always Create a New Version

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

### 1.3 Version Picker UI

Add this to your top toolbar (replace the current "Unsaved schema" dropdown):

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

**What clicking a version does:** loads that version's `dbml_content` into the editor (read-only if not latest) and updates the ER diagram.

### 1.4 Save Button Behaviour Change

Change your save button from "overwrite" to "create new version":

```jsx
async function handleSave() {
  const note = prompt('Version note (optional):') ?? '';
  await saveVersion(currentProjectId, dbmlContent, note || null);
  await refreshVersionList(); // reload the version picker
  setStatus('Saved as new version ✓');
}
```

---

## Phase 2 — Wiki / Documentation View

> **Why second:** This is the core value-add over a plain DBML editor. People share the Wiki link, not the editor.

### 2.1 Add a View Toggle

Add two tabs to your top bar: **Editor** | **Wiki** (and later **Code Diff**)

```jsx
const [view, setView] = useState('editor'); // 'editor' | 'wiki' | 'diff'

<div className="flex border-b">
  <TabButton active={view === 'editor'} onClick={() => setView('editor')}>
    ✏️ Editor
  </TabButton>
  <TabButton active={view === 'wiki'} onClick={() => setView('wiki')}>
    📖 Wiki
  </TabButton>
  <TabButton active={view === 'diff'} onClick={() => setView('diff')}>
    ⇄ Diff
  </TabButton>
</div>
```

### 2.2 Parse the DBML into a Structured Object

Install the official parser if not already:
```bash
npm install @dbml/core
```

```javascript
import { Parser } from '@dbml/core';

function parseDbml(dbmlString) {
  try {
    const database = Parser.parse(dbmlString, 'dbml');
    return { ok: true, data: database };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
```

The parsed `database` object gives you:
- `database.schemas[]` → each schema (like `core`, `product`)
- `database.schemas[i].tables[]` → tables in that schema
- `database.schemas[i].tables[j].fields[]` → fields with type, pk, not_null, default, note
- `database.refs[]` → all foreign key references
- `database.enums[]` → enum definitions

### 2.3 Build the Wiki Page Component

```jsx
function WikiView({ parsedSchema, diff }) {
  if (!parsedSchema) return <div>No schema loaded.</div>;

  return (
    <div className="max-w-4xl mx-auto p-8 font-sans">

      {/* Project header */}
      <ProjectHeader schema={parsedSchema} />

      {/* Stats bar */}
      <StatsBar
        tables={parsedSchema.schemas.flatMap(s => s.tables).length}
        fields={parsedSchema.schemas.flatMap(s => s.tables).flatMap(t => t.fields).length}
        updates={diff?.length ?? 0}
      />

      {/* Schema sections */}
      {parsedSchema.schemas.map(schema => (
        <SchemaSection key={schema.name} schema={schema} diff={diff} />
      ))}
    </div>
  );
}

function SchemaSection({ schema, diff }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="mb-8">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 text-lg font-semibold mb-3"
      >
        {collapsed ? '▶' : '▼'} Schema {schema.name} ({schema.tables.length})
      </button>

      {!collapsed && schema.tables.map(table => (
        <TableDoc key={table.name} table={table} diff={diff} />
      ))}
    </div>
  );
}
```

### 2.4 Table Documentation Component

This is the core of the wiki — renders each table with its fields:

```jsx
function TableDoc({ table, diff }) {
  const tableChanges = diff?.filter(d => d.table === table.name) ?? [];

  return (
    <div id={`table-${table.name}`} className="mb-10 border rounded-lg overflow-hidden">

      {/* Table header */}
      <div className="bg-gray-800 text-white px-4 py-3 flex items-center gap-3">
        <span className="font-mono font-bold">{table.name}</span>
        {tableChanges.length > 0 && (
          <span className="text-xs bg-orange-500 text-white rounded px-2 py-0.5">
            {tableChanges.length} changes
          </span>
        )}
      </div>

      {/* Table note / description */}
      {table.note && (
        <div className="px-4 py-2 bg-gray-50 text-sm text-gray-600 border-b">
          {table.note}
        </div>
      )}

      {/* Fields table */}
      <table className="w-full text-sm">
        <thead className="bg-gray-100 text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-2 text-left">Name</th>
            <th className="px-4 py-2 text-left">Type</th>
            <th className="px-4 py-2 text-left">Settings</th>
            <th className="px-4 py-2 text-left">References</th>
            <th className="px-4 py-2 text-left">Notes</th>
          </tr>
        </thead>
        <tbody>
          {table.fields.map(field => {
            const change = tableChanges.find(c => c.field === field.name);
            return (
              <FieldRow
                key={field.name}
                field={field}
                change={change}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FieldRow({ field, change }) {
  const isChanged = !!change;

  return (
    <>
      <tr className={isChanged ? 'bg-amber-50' : 'border-t hover:bg-gray-50'}>
        <td className="px-4 py-2 font-mono font-medium">
          {field.name}
          {field.pk && <span className="ml-1 text-xs bg-blue-100 text-blue-700 rounded px-1">PK</span>}
        </td>
        <td className="px-4 py-2 font-mono text-purple-700">{field.type?.type_name}</td>
        <td className="px-4 py-2">
          <FieldSettings field={field} />
        </td>
        <td className="px-4 py-2 text-blue-600 font-mono text-xs">
          {field.dbRefs?.map(ref => ref.endpoints.map(e => `${e.tableName}.${e.fieldNames[0]}`).join(' → ')).join(', ')}
        </td>
        <td className="px-4 py-2 text-gray-500 text-xs">{field.note}</td>
      </tr>

      {/* Before row for changed fields */}
      {isChanged && change.before && (
        <tr className="bg-amber-50 text-gray-400 text-xs italic">
          <td className="px-4 py-1 pl-8" colSpan={5}>
            before → {JSON.stringify(change.before)}
          </td>
        </tr>
      )}
    </>
  );
}

function FieldSettings({ field }) {
  const tags = [];
  if (field.not_null) tags.push({ label: 'not_null', color: 'red' });
  if (field.increment) tags.push({ label: 'increment', color: 'green' });
  if (field.unique) tags.push({ label: 'unique', color: 'purple' });
  if (field.default) tags.push({ label: `default: ${field.default.value}`, color: 'gray' });

  return (
    <div className="flex flex-wrap gap-1">
      {tags.map(tag => (
        <span key={tag.label}
          className={`text-xs rounded px-1.5 py-0.5 bg-${tag.color}-100 text-${tag.color}-700`}>
          {tag.label}
        </span>
      ))}
    </div>
  );
}
```

### 2.5 Stats Bar

```jsx
function StatsBar({ tables, fields, updates }) {
  return (
    <div className="flex gap-8 p-6 border rounded-lg my-6">
      <Stat icon="🗂️" value={tables} label="Tables" />
      <Stat icon="📋" value={fields} label="Fields" />
      <Stat icon="🔄" value={updates} label="Updates" />
    </div>
  );
}

function Stat({ icon, value, label }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-2xl">{icon}</span>
      <div>
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-sm text-gray-500">{label}</div>
      </div>
    </div>
  );
}
```

---

## Phase 3 — Left Sidebar Table Tree

> **Why third:** Makes navigation fast once the wiki view has content to navigate to.

### 3.1 Sidebar Component

```jsx
function Sidebar({ parsedSchema, diff, onSelectTable, selectedTable }) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState({});

  const diffMap = new Map(
    (diff ?? []).map(d => [d.table, (diff ?? []).filter(x => x.table === d.table).length])
  );

  const filterTable = (table) =>
    !search || table.name.toLowerCase().includes(search.toLowerCase()) ||
    table.fields.some(f => f.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <aside className="w-64 border-r h-full overflow-y-auto flex flex-col">

      {/* Search */}
      <div className="p-2 border-b">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search tables, fields..."
          className="w-full border rounded px-2 py-1 text-sm"
        />
      </div>

      {/* Table tree */}
      <div className="flex-1 overflow-y-auto p-2">
        {parsedSchema?.schemas.map(schema => (
          <div key={schema.name} className="mb-2">

            {/* Schema group header */}
            <button
              onClick={() => setCollapsed(c => ({ ...c, [schema.name]: !c[schema.name] }))}
              className="flex items-center gap-1 text-xs font-bold uppercase text-gray-500 w-full hover:text-gray-800 py-1"
            >
              {collapsed[schema.name] ? '▶' : '▼'} {schema.name}
            </button>

            {/* Tables in schema */}
            {!collapsed[schema.name] && schema.tables.filter(filterTable).map(table => {
              const changeCount = diffMap.get(table.name) ?? 0;
              const isSelected = selectedTable === table.name;

              return (
                <button
                  key={table.name}
                  onClick={() => onSelectTable(table.name)}
                  className={`
                    flex items-center gap-2 w-full px-3 py-1.5 text-sm rounded text-left
                    ${isSelected ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-100'}
                  `}
                >
                  {/* Change indicator */}
                  {changeCount > 0 && (
                    <span className="text-orange-500 text-xs font-bold">*</span>
                  )}

                  {/* Table icon */}
                  <span className="text-gray-400">🗂</span>

                  {/* Table name */}
                  <span className="flex-1 font-mono text-xs truncate">{table.name}</span>

                  {/* Change count badge */}
                  {changeCount > 0 && (
                    <span className="text-xs bg-orange-100 text-orange-600 rounded px-1">
                      {changeCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}
```

### 3.2 Wire the Sidebar to the Wiki View

When a table is selected in the sidebar, scroll to it in the wiki:

```jsx
function onSelectTable(tableName) {
  setSelectedTable(tableName);
  setView('wiki'); // switch to wiki if in editor
  const el = document.getElementById(`table-${tableName}`);
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
```

---

## Phase 4 — Version Comparison & Diff

> **The killer feature.** This is what makes dbdocs.io worth using for teams.

### 4.1 Diff Engine

```javascript
// utils/diff.js

export function diffSchemas(schemaV1, schemaV2) {
  const changes = [];

  if (!schemaV1 || !schemaV2) return changes;

  const v1Tables = new Map(
    schemaV1.schemas.flatMap(s => s.tables).map(t => [t.name, t])
  );
  const v2Tables = new Map(
    schemaV2.schemas.flatMap(s => s.tables).map(t => [t.name, t])
  );

  // Added tables
  for (const [name, table] of v2Tables) {
    if (!v1Tables.has(name)) {
      changes.push({ type: 'table_added', table: name });
    }
  }

  // Removed tables
  for (const [name] of v1Tables) {
    if (!v2Tables.has(name)) {
      changes.push({ type: 'table_removed', table: name });
    }
  }

  // Modified tables — compare fields
  for (const [name, v2Table] of v2Tables) {
    if (!v1Tables.has(name)) continue;

    const v1Table = v1Tables.get(name);
    const v1Fields = new Map(v1Table.fields.map(f => [f.name, f]));
    const v2Fields = new Map(v2Table.fields.map(f => [f.name, f]));

    // Added fields
    for (const [fname, field] of v2Fields) {
      if (!v1Fields.has(fname)) {
        changes.push({ type: 'field_added', table: name, field: fname, after: field });
      }
    }

    // Removed fields
    for (const [fname] of v1Fields) {
      if (!v2Fields.has(fname)) {
        changes.push({ type: 'field_removed', table: name, field: fname, before: v1Fields.get(fname) });
      }
    }

    // Modified fields
    for (const [fname, v2Field] of v2Fields) {
      if (!v1Fields.has(fname)) continue;
      const v1Field = v1Fields.get(fname);

      // Compare meaningful properties
      const changed =
        v1Field.type?.type_name !== v2Field.type?.type_name ||
        v1Field.not_null !== v2Field.not_null ||
        v1Field.pk !== v2Field.pk ||
        v1Field.unique !== v2Field.unique ||
        JSON.stringify(v1Field.default) !== JSON.stringify(v2Field.default) ||
        v1Field.note !== v2Field.note;

      if (changed) {
        changes.push({
          type: 'field_modified',
          table: name,
          field: fname,
          before: v1Field,
          after: v2Field
        });
      }
    }
  }

  return changes;
}
```

### 4.2 Comparison Bar UI

Add this to the top of the page when in compare mode:

```jsx
function CompareBar({ versions, compareFrom, compareTo, onChangeFrom, onChangeTo, onClear }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-blue-50 border-b text-sm">
      <span className="text-gray-500">Comparing</span>

      <VersionSelect
        versions={versions}
        value={compareFrom}
        onChange={onChangeFrom}
        label="From"
      />

      <span className="text-gray-400">→</span>

      <VersionSelect
        versions={versions}
        value={compareTo}
        onChange={onChangeTo}
        label="To"
      />

      <button
        onClick={onClear}
        className="ml-2 text-gray-400 hover:text-gray-700 font-bold"
      >
        ✕
      </button>
    </div>
  );
}
```

### 4.3 Code Diff View

Install a diff library:
```bash
npm install react-diff-viewer-continued
```

```jsx
import ReactDiffViewer from 'react-diff-viewer-continued';

function CodeDiffView({ oldDbml, newDbml, oldLabel, newLabel }) {
  return (
    <div className="h-full overflow-auto font-mono text-xs">
      <ReactDiffViewer
        oldValue={oldDbml ?? ''}
        newValue={newDbml ?? ''}
        splitView={true}
        leftTitle={oldLabel}
        rightTitle={newLabel}
        showDiffOnly={false}
        useDarkTheme={false}
        styles={{
          variables: {
            light: {
              diffViewerBackground: '#fff',
              addedBackground: '#e6ffed',
              removedBackground: '#ffeef0',
            }
          }
        }}
      />
    </div>
  );
}
```

### 4.4 Wiring It All Together

```jsx
// In your main App.jsx

const [compareFromVersion, setCompareFromVersion] = useState(null);
const [compareToVersion, setCompareToVersion] = useState(null);

// Compute diff whenever compare versions change
const diff = useMemo(() => {
  if (!compareFromVersion || !compareToVersion) return [];
  const v1 = JSON.parse(compareFromVersion.parsed_schema ?? 'null');
  const v2 = JSON.parse(compareToVersion.parsed_schema ?? 'null');
  return diffSchemas(v1, v2);
}, [compareFromVersion, compareToVersion]);

// Pass diff down to Sidebar and WikiView
```

---

## Phase 5 — Search

> Simple but high-value. Users instantly expect to search in any documentation tool.

### 5.1 Client-Side Fuzzy Search with Fuse.js

```bash
npm install fuse.js
```

```javascript
import Fuse from 'fuse.js';

function buildSearchIndex(parsedSchema) {
  const items = [];

  parsedSchema.schemas.forEach(schema => {
    schema.tables.forEach(table => {
      // Add the table itself
      items.push({
        type: 'table',
        name: table.name,
        schema: schema.name,
        note: table.note ?? '',
        id: `table:${schema.name}.${table.name}`
      });

      // Add each field
      table.fields.forEach(field => {
        items.push({
          type: 'field',
          name: field.name,
          table: table.name,
          schema: schema.name,
          fieldType: field.type?.type_name,
          note: field.note ?? '',
          id: `field:${schema.name}.${table.name}.${field.name}`
        });
      });
    });
  });

  const fuse = new Fuse(items, {
    keys: ['name', 'note', 'fieldType'],
    threshold: 0.3,
    includeMatches: true
  });

  return { fuse, items };
}
```

### 5.2 Search Results in Sidebar

When the search input has a value, replace the normal tree with search results:

```jsx
const searchResults = useMemo(() => {
  if (!search.trim() || !searchIndex) return null;
  return searchIndex.fuse.search(search).slice(0, 20);
}, [search, searchIndex]);

// In the sidebar render:
{searchResults ? (
  <SearchResults results={searchResults} onSelect={onSelectTable} />
) : (
  <TableTree ... />
)}
```

---

## Phase 6 — Public Sharing & URLs

> Makes the tool useful for teams and external stakeholders.

### 6.1 URL Structure to Implement

Use React Router to set up these routes:

```
/                                    → Home / project list
/editor                              → Editor view (current app)
/:projectSlug                        → Latest version wiki (public)
/:projectSlug/v/:versionNumber       → Specific version wiki
/:projectSlug/v/:versionNumber?compare_with=:v2   → Comparison mode
/:projectSlug/v/:versionNumber?view=code           → Code view
/:projectSlug/v/:versionNumber?table=:tableName    → Jump to table
```

Install React Router if not already:
```bash
npm install react-router-dom
```

### 6.2 Add a Slug to Projects

When creating a project, auto-generate a URL-safe slug:

```javascript
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// When saving a project:
const slug = slugify(projectName); // e.g. "ecommerce-db"
```

### 6.3 Backend API Routes to Add

```
GET  /api/projects                          → list all projects
GET  /api/projects/:slug                    → get project metadata
GET  /api/projects/:slug/versions           → list all versions
GET  /api/projects/:slug/versions/:num      → get specific version's DBML + parsed schema
POST /api/projects/:slug/versions           → save new version
```

### 6.4 Shareable Link Button

Add a "Share" button to your toolbar that copies the public URL:

```jsx
function ShareButton({ projectSlug, versionNumber }) {
  const url = `${window.location.origin}/${projectSlug}/v/${versionNumber}`;

  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(url);
        toast('Link copied!');
      }}
      className="flex items-center gap-1 border rounded px-3 py-1.5 text-sm hover:bg-gray-50"
    >
      🔗 Share
    </button>
  );
}
```

---

## Recommended Build Order (Day by Day)

### Week 1

| Day | Task |
|---|---|
| Day 1 | Update SQLite schema (Phase 1.1) + save-as-version logic (Phase 1.2) |
| Day 2 | Version picker dropdown in toolbar (Phase 1.3 & 1.4) |
| Day 3 | Wiki view — parse DBML, project header, stats bar (Phase 2.1–2.3) |
| Day 4 | Table docs component — fields table with settings badges (Phase 2.4) |
| Day 5 | Left sidebar — table tree + schema grouping (Phase 3) |

### Week 2

| Day | Task |
|---|---|
| Day 6 | Diff engine — field-level comparison logic (Phase 4.1) |
| Day 7 | Compare bar UI + amber diff highlighting in wiki (Phase 4.2) |
| Day 8 | Code diff view — side by side DBML diff (Phase 4.3) |
| Day 9 | Search with Fuse.js (Phase 5) |
| Day 10 | React Router + public URLs + share button (Phase 6) |

---

## Key npm Packages to Install

```bash
# DBML parsing (already likely installed)
npm install @dbml/core

# Side-by-side code diff
npm install react-diff-viewer-continued

# Fuzzy search
npm install fuse.js

# Routing
npm install react-router-dom

# Markdown rendering (for table/project Notes)
npm install react-markdown remark-gfm

# Toast notifications (optional but nice)
npm install react-hot-toast
```

---

## Quick Wins You Can Do Right Now (< 1 hour each)

These don't require backend changes and improve the UX immediately:

1. **"DBML synced" → show last saved time** — store `savedAt` in localStorage and show "Saved 2 min ago"
2. **Keyboard shortcut to save** — `Cmd+S` triggers the save handler
3. **Auto-save draft to localStorage** — prevent losing work on accidental refresh
4. **Error display for invalid DBML** — show the parse error message below the editor when `@dbml/core` throws
5. **Table count in the header** — parse the current DBML and show "5 tables · 12 fields" live

---

## Final Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                        App Shell                        │
│  ┌──────────┐  ┌────────────────────────────────────┐   │
│  │ Sidebar  │  │         Main Panel                 │   │
│  │          │  │  ┌─────┬──────┬────────────────┐   │   │
│  │ Search   │  │  │Edit │ Wiki │   Code Diff    │   │   │
│  │ ──────── │  │  └─────┴──────┴────────────────┘   │   │
│  │ Schemas  │  │                                    │   │
│  │  └Tables │  │  [Compare Bar: v11 → v12  ✕]      │   │
│  │   * diff │  │                                    │   │
│  │   badges │  │  ┌─────────────────────────────┐   │   │
│  │          │  │  │  Wiki / Editor / Diff view  │   │   │
│  └──────────┘  │  └─────────────────────────────┘   │   │
└────────────────┴────────────────────────────────────────┘
                              │
                     ┌────────▼────────┐
                     │  SQLite (local) │
                     │  projects       │
                     │  versions       │
                     └─────────────────┘
```

---

*Built on top of: Vite + React + React Flow + SQLite*  
*Target: dbdocs.io feature parity*  
*Written: May 2026*
