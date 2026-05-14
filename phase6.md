# Phase 6 — Public Sharing & URLs

> Makes the tool useful for teams and external stakeholders.

## 6.1 URL Structure to Implement

Use React Router to set up these routes:

```text
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

## 6.2 Add a Slug to Projects

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

## 6.3 Backend API Routes to Add

```text
GET  /api/projects                          → list all projects
GET  /api/projects/:slug                    → get project metadata
GET  /api/projects/:slug/versions           → list all versions
GET  /api/projects/:slug/versions/:num      → get specific version's DBML + parsed schema
POST /api/projects/:slug/versions           → save new version
```

## 6.4 Shareable Link Button

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
