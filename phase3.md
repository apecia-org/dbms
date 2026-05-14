# Phase 3 — Left Sidebar Table Tree

> **Why third:** Makes navigation fast once the wiki view has content to navigate to.

## 3.1 Sidebar Component

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
      <div className="p-2 border-b">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search tables, fields..."
          className="w-full border rounded px-2 py-1 text-sm"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {parsedSchema?.schemas.map(schema => (
          <div key={schema.name} className="mb-2">
            <button
              onClick={() => setCollapsed(c => ({ ...c, [schema.name]: !c[schema.name] }))}
              className="flex items-center gap-1 text-xs font-bold uppercase text-gray-500 w-full hover:text-gray-800 py-1"
            >
              {collapsed[schema.name] ? '▶' : '▼'} {schema.name}
            </button>

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
                  {changeCount > 0 && (
                    <span className="text-orange-500 text-xs font-bold">*</span>
                  )}

                  <span className="text-gray-400">🗂</span>
                  <span className="flex-1 font-mono text-xs truncate">{table.name}</span>

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

## 3.2 Wire the Sidebar to the Wiki View

When a table is selected in the sidebar, scroll to it in the wiki:

```jsx
function onSelectTable(tableName) {
  setSelectedTable(tableName);
  setView('wiki'); // switch to wiki if in editor
  const el = document.getElementById(`table-${tableName}`);
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
```
