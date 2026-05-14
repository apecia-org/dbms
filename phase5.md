# Phase 5 — Search

> Simple but high-value. Users instantly expect to search in any documentation tool.

## 5.1 Client-Side Fuzzy Search with Fuse.js

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

## 5.2 Search Results in Sidebar

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
