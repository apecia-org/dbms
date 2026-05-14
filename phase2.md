# Phase 2 — Wiki / Documentation View

> **Why second:** This is the core value-add over a plain DBML editor. People share the Wiki link, not the editor.

## 2.1 Add a View Toggle

Add two tabs to your top bar: **Editor** | **Wiki** and later **Code Diff**.

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

## 2.2 Parse the DBML into a Structured Object

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

- `database.schemas[]` -> each schema, like `core` or `product`
- `database.schemas[i].tables[]` -> tables in that schema
- `database.schemas[i].tables[j].fields[]` -> fields with type, pk, not_null, default, note
- `database.refs[]` -> all foreign key references
- `database.enums[]` -> enum definitions

## 2.3 Build the Wiki Page Component

```jsx
function WikiView({ parsedSchema, diff }) {
  if (!parsedSchema) return <div>No schema loaded.</div>;

  return (
    <div className="max-w-4xl mx-auto p-8 font-sans">
      <ProjectHeader schema={parsedSchema} />

      <StatsBar
        tables={parsedSchema.schemas.flatMap(s => s.tables).length}
        fields={parsedSchema.schemas.flatMap(s => s.tables).flatMap(t => t.fields).length}
        updates={diff?.length ?? 0}
      />

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

## 2.4 Table Documentation Component

This is the core of the wiki. It renders each table with its fields:

```jsx
function TableDoc({ table, diff }) {
  const tableChanges = diff?.filter(d => d.table === table.name) ?? [];

  return (
    <div id={`table-${table.name}`} className="mb-10 border rounded-lg overflow-hidden">
      <div className="bg-gray-800 text-white px-4 py-3 flex items-center gap-3">
        <span className="font-mono font-bold">{table.name}</span>
        {tableChanges.length > 0 && (
          <span className="text-xs bg-orange-500 text-white rounded px-2 py-0.5">
            {tableChanges.length} changes
          </span>
        )}
      </div>

      {table.note && (
        <div className="px-4 py-2 bg-gray-50 text-sm text-gray-600 border-b">
          {table.note}
        </div>
      )}

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

## 2.5 Stats Bar

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
