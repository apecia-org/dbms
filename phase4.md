# Phase 4 — Version Comparison & Diff

> **The killer feature.** This is what makes dbdocs.io worth using for teams.

## 4.1 Diff Engine

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

## 4.2 Comparison Bar UI

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

## 4.3 Code Diff View

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

## 4.4 Wiring It All Together

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
