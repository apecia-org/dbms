import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import { BookOpen, Code2, Copy, Database, Download, FileJson, Link2, Plus, Save, Settings, Trash2, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { deleteDocument, getDocumentVersion, getSession, listDocuments, listDocumentVersions, saveDocument, type Session } from './api';
import {
  addColumn,
  addRelationship,
  addTable,
  defaultDbml,
  deleteColumn,
  deleteRelationship,
  deleteTable,
  exportDbml,
  type ExportFormat,
  importToDbml,
  type ImportFormat,
  modelToDbml,
  parseDbmlSchemaCache,
  parseDbmlToModel,
  toggleColumnSetting,
  updateColumn,
  updateTable,
  updateTablePosition,
  validateDbml,
} from './dbml';
import type { DbmlColumn, DbmlDocumentModel, DbmlTable, DocumentVersionSummary, Role, SavedDocument, WikiMetadata } from './types';

type TableNodeData = {
  table: DbmlTable;
  readonly: boolean;
  selected: boolean;
  linkingFrom: LinkStart | null;
  onTableChange: (tableId: string, patch: Partial<DbmlTable>) => void;
  onDeleteTable: (tableId: string) => void;
  onAddColumn: (tableId: string) => void;
  onColumnChange: (tableId: string, columnId: string, patch: Partial<DbmlColumn>) => void;
  onToggleColumnSetting: (tableId: string, columnId: string, key: string) => void;
  onDeleteColumn: (tableId: string, columnId: string) => void;
  onColumnLinkClick: (tableId: string, columnId: string) => void;
};

type LinkStart = {
  tableId: string;
  columnId: string;
};

const nodeTypes = {
  table: TableNode,
};

const emptyWikiMetadata: WikiMetadata = {
  readme: '',
  schemaNotes: {},
};

export function App() {
  const [role, setRole] = useState<Role>('editor');
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('dbml_auth_token') ?? '');
  const [configToken, setConfigToken] = useState(() => localStorage.getItem('dbml_auth_token') ?? '');
  const [session, setSession] = useState<Session | null>(null);
  const [dbml, setDbml] = useState(defaultDbml);
  const [view, setView] = useState<'editor' | 'wiki'>('editor');
  const [docsOpen, setDocsOpen] = useState(false);
  const [wikiMetadata, setWikiMetadata] = useState<WikiMetadata>(emptyWikiMetadata);
  const [parseError, setParseError] = useState<string | null>(null);
  const [model, setModel] = useState<DbmlDocumentModel>(() => parseDbmlToModel(defaultDbml));
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<SavedDocument[]>([]);
  const [activeDocument, setActiveDocument] = useState<SavedDocument | null>(null);
  const [versions, setVersions] = useState<DocumentVersionSummary[]>([]);
  const [activeVersionNumber, setActiveVersionNumber] = useState<number | null>(null);
  const [documentName, setDocumentName] = useState('Untitled schema');
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('dbml');
  const [exportText, setExportText] = useState('');
  const [exportError, setExportError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const [selectedRefId, setSelectedRefId] = useState<string | null>(null);
  const [visualNodes, setVisualNodes] = useState<Node[]>([]);
  const [linkingFrom, setLinkingFrom] = useState<LinkStart | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importFormat, setImportFormat] = useState<ImportFormat>('dbml');
  const [importName, setImportName] = useState('Imported schema');
  const [importInput, setImportInput] = useState('');
  const [importPreview, setImportPreview] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const isHistoricalVersion = Boolean(activeDocument && activeVersionNumber && activeVersionNumber !== activeDocument.version);
  const readonly = role === 'readonly' || isHistoricalVersion;

  useEffect(() => {
    getSession(authToken || undefined)
      .then((session) => {
        setSession(session);
        setRole(session.role === 'editor' ? 'editor' : 'readonly');
      })
      .catch(() => {
        setSession(null);
        setRole('readonly');
      });
    listDocuments(authToken || undefined).then(setDocuments).catch(() => setDocuments([]));
  }, [authToken]);

  const applyModel = useCallback((next: DbmlDocumentModel) => {
    const nextDbml = modelToDbml(next);
    setModel(next);
    setDbml(nextDbml);
    setParseError(validateDbml(nextDbml));
  }, []);

  const modelNodes = useMemo<Node[]>(
    () =>
      model.tables.map((table) => ({
        id: table.id,
        type: 'table',
        position: { x: table.x, y: table.y },
        data: {
          table,
          readonly,
          selected: selectedTableId === table.id,
          linkingFrom,
          onTableChange: (tableId: string, patch: Partial<DbmlTable>) => applyModel(updateTable(model, tableId, patch)),
          onDeleteTable: (tableId: string) => {
            applyModel(deleteTable(model, tableId));
            setSelectedTableId(null);
          },
          onAddColumn: (tableId: string) => applyModel(addColumn(model, tableId)),
          onColumnChange: (tableId: string, columnId: string, patch: Partial<DbmlColumn>) => applyModel(updateColumn(model, tableId, columnId, patch)),
          onToggleColumnSetting: (tableId: string, columnId: string, key: string) => applyModel(toggleColumnSetting(model, tableId, columnId, key)),
          onDeleteColumn: (tableId: string, columnId: string) => applyModel(deleteColumn(model, tableId, columnId)),
          onColumnLinkClick: handleColumnLinkClick,
        },
      })),
    [applyModel, linkingFrom, model, readonly, selectedTableId],
  );

  useEffect(() => {
    setVisualNodes(modelNodes);
  }, [modelNodes]);

  const edges = useMemo<Edge[]>(
    () =>
      model.refs.map((ref) => {
        const source = tableForRef(model, ref.fromTable);
        const target = tableForRef(model, ref.toTable);
        return {
          id: ref.id,
          source: source?.id ?? tableIdForRef(model, ref.fromTable),
          target: target?.id ?? tableIdForRef(model, ref.toTable),
          sourceHandle: source ? columnHandleId(source, ref.fromColumn, 'source') : undefined,
          targetHandle: target ? columnHandleId(target, ref.toColumn, 'target') : undefined,
          label: `${ref.fromColumn} ${ref.relation} ${ref.toColumn}`,
          type: 'smoothstep',
          className: selectedRefId === ref.id ? 'relationship-edge relationship-edge--selected' : 'relationship-edge',
        };
      }),
    [model, selectedRefId],
  );

  function onTextChange(value: string | undefined) {
    if (readonly) return;
    const next = value ?? '';
    setDbml(next);
    setParseError(validateDbml(next));
    setModel(parseDbmlToModel(next));
  }

  function loadDbmlDocument(
    nextDbml: string,
    name: string,
    document: SavedDocument | null,
    versionNumber = document?.version ?? null,
    metadata = normalizeWikiMetadata(document?.wikiMetadata),
  ) {
    setActiveDocument(document);
    setActiveVersionNumber(versionNumber);
    if (!document) setVersions([]);
    setWikiMetadata(metadata);
    setDocumentName(name);
    setDbml(nextDbml);
    setParseError(validateDbml(nextDbml));
    setModel(parseDbmlToModel(nextDbml));
    setSelectedRefId(null);
    setSelectedTableId(null);
    setLinkingFrom(null);
  }

  function onNodeDragStop(_: unknown, node: Node) {
    if (readonly) return;
    applyModel(updateTablePosition(model, node.id, node.position.x, node.position.y));
  }

  function onNodesChange(changes: NodeChange[]) {
    if (readonly) return;
    setVisualNodes((current) => applyNodeChanges(changes, current));
  }

  function handleColumnLinkClick(tableId: string, columnId: string) {
    if (readonly) return;
    if (!linkingFrom) {
      setLinkingFrom({ tableId, columnId });
      return;
    }

    if (linkingFrom.tableId === tableId && linkingFrom.columnId === columnId) {
      setLinkingFrom(null);
      return;
    }

    const sourceTable = model.tables.find((table) => table.id === linkingFrom.tableId);
    const targetTable = model.tables.find((table) => table.id === tableId);
    const sourceColumn = sourceTable?.columns.find((column) => column.id === linkingFrom.columnId);
    const targetColumn = targetTable?.columns.find((column) => column.id === columnId);
    if (!sourceTable || !targetTable || !sourceColumn || !targetColumn) {
      setLinkingFrom(null);
      return;
    }

    applyModel(
      addRelationship(model, {
        fromTableId: sourceTable.id,
        fromColumn: sourceColumn.name,
        relation: '>',
        toTableId: targetTable.id,
        toColumn: targetColumn.name,
      }),
    );
    setLinkingFrom(null);
  }

  function onConnect(connection: Connection) {
    if (readonly || !connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) return;
    const sourceColumnId = parseColumnHandle(connection.sourceHandle);
    const targetColumnId = parseColumnHandle(connection.targetHandle);
    const sourceTable = model.tables.find((table) => table.id === connection.source);
    const targetTable = model.tables.find((table) => table.id === connection.target);
    const sourceColumn = sourceTable?.columns.find((column) => column.id === sourceColumnId);
    const targetColumn = targetTable?.columns.find((column) => column.id === targetColumnId);
    if (!sourceTable || !targetTable || !sourceColumn || !targetColumn) return;

    applyModel(
      addRelationship(model, {
        fromTableId: sourceTable.id,
        fromColumn: sourceColumn.name,
        relation: '>',
        toTableId: targetTable.id,
        toColumn: targetColumn.name,
      }),
    );
  }

  async function onSave() {
    if (readonly) return;
    const note = window.prompt('Version note (optional):') ?? '';
    const saved = await saveDocument({
      id: activeDocument?.id,
      name: documentName,
      dbml,
      layoutJson: { tables: model.tables.map(({ id, x, y }) => ({ id, x, y })) },
      parsedSchema: parseDbmlSchemaCache(dbml),
      wikiMetadata,
      note,
    }, authToken || undefined);
    setActiveDocument(saved);
    setActiveVersionNumber(saved.version);
    const [nextDocuments, nextVersions] = await Promise.all([
      listDocuments(authToken || undefined),
      listDocumentVersions(saved.id, authToken || undefined),
    ]);
    setDocuments(nextDocuments);
    setVersions(nextVersions);
  }

  async function loadDocument(document: SavedDocument) {
    loadDbmlDocument(document.dbml, document.name, document, document.version);
    setVersions(await listDocumentVersions(document.id, authToken || undefined));
  }

  async function loadVersion(versionNumber: number) {
    if (!activeDocument) return;
    if (versionNumber === activeDocument.version) {
      loadDbmlDocument(activeDocument.dbml, activeDocument.name, activeDocument, activeDocument.version, normalizeWikiMetadata(activeDocument.wikiMetadata));
      return;
    }
    const version = await getDocumentVersion(activeDocument.id, versionNumber, authToken || undefined);
    loadDbmlDocument(version.dbml, activeDocument.name, activeDocument, version.versionNumber, normalizeWikiMetadata(version.wikiMetadata));
  }

  function startNewSchema() {
    loadDbmlDocument(defaultDbml, 'Untitled schema', null);
  }

  async function removeDocument() {
    if (!activeDocument || readonly) return;
    await deleteDocument(activeDocument.id, authToken || undefined);
    setActiveDocument(null);
    setActiveVersionNumber(null);
    setVersions([]);
    setDocuments(await listDocuments(authToken || undefined));
  }

  function generateExport(format: ExportFormat = exportFormat) {
    try {
      const nextExport = format === 'dbml' ? dbml : exportDbml(dbml, format);
      setExportText(nextExport);
      setExportError(null);
      return nextExport;
    } catch (error) {
      setExportText('');
      setExportError(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  function openExportDrawer() {
    setExportOpen(true);
    setCopyStatus('');
    generateExport(exportFormat);
  }

  async function copyExport() {
    const content = exportText || generateExport();
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopyStatus('Copied');
  }

  function downloadExport() {
    const content = exportText || generateExport();
    if (!content) return;
    const blob = new Blob([content], { type: exportFormat === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8' });
    downloadBlob(blob, `${safeFileName(documentName || 'schema')}.${exportExtension(exportFormat)}`);
  }

  function convertImport(input = importInput, format = importFormat) {
    try {
      const nextDbml = importToDbml(input, format);
      setImportPreview(nextDbml);
      setImportError(null);
      return nextDbml;
    } catch (error) {
      setImportPreview('');
      setImportError(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  async function onImportFile(file: File | null) {
    if (!file) return;
    const content = await file.text();
    setImportInput(content);
    setImportName(file.name.replace(/\.[^.]+$/, '') || 'Imported schema');
    convertImport(content, importFormat);
  }

  function applyImport(asNew: boolean) {
    if (readonly) return;
    const nextDbml = importPreview || convertImport();
    if (!nextDbml) return;
    loadDbmlDocument(nextDbml, importName || 'Imported schema', asNew ? null : activeDocument);
    setImportOpen(false);
  }

  function applyConfigToken() {
    const nextToken = configToken.trim();
    if (nextToken) {
      localStorage.setItem('dbml_auth_token', nextToken);
    } else {
      localStorage.removeItem('dbml_auth_token');
    }
    setAuthToken(nextToken);
  }

  function clearConfigToken() {
    localStorage.removeItem('dbml_auth_token');
    setConfigToken('');
    setAuthToken('');
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <FileJson size={24} />
          <div>
            <h1>DBML UI Editor</h1>
            <span>{isHistoricalVersion ? `Viewing v${activeVersionNumber}` : parseError ? 'DBML has errors' : 'DBML synced'}</span>
          </div>
        </div>
        <div className="toolbar">
          <select
            className="schema-select"
            value={activeDocument?.id ?? ''}
            onChange={(event) => {
              const document = documents.find((item) => item.id === event.target.value);
              if (document) void loadDocument(document);
            }}
            aria-label="Load schema"
          >
            <option value="">Unsaved schema</option>
            {documents.map((document) => (
              <option key={document.id} value={document.id}>
                {document.name} v{document.version}
              </option>
            ))}
          </select>
          <select
            className="schema-select"
            value={activeVersionNumber ?? ''}
            onChange={(event) => void loadVersion(Number(event.target.value))}
            disabled={!activeDocument || versions.length === 0}
            aria-label="Load version"
          >
            <option value="">No versions</option>
            {versions.map((version) => (
              <option key={version.id} value={version.versionNumber}>
                #{version.versionNumber} {version.label}{version.note ? ` — ${version.note}` : ''}
              </option>
            ))}
          </select>
          <input value={documentName} onChange={(event) => setDocumentName(event.target.value)} disabled={readonly} aria-label="Document name" />
          <div className="view-tabs" role="tablist" aria-label="Workspace view">
            <button className={view === 'editor' ? 'is-active' : ''} onClick={() => setView('editor')} role="tab" aria-selected={view === 'editor'} title="Editor view">
              <Code2 size={16} />
              Editor
            </button>
            <button className={view === 'wiki' ? 'is-active' : ''} onClick={() => setView('wiki')} role="tab" aria-selected={view === 'wiki'} title="Wiki view">
              <BookOpen size={16} />
              Wiki
            </button>
          </div>
          <button onClick={() => applyModel(addTable(model))} disabled={readonly} title="Add table">
            <Plus size={18} />
          </button>
          <button onClick={startNewSchema} disabled={readonly} title="New schema">
            <FileJson size={18} />
          </button>
          <button onClick={() => setImportOpen(true)} disabled={readonly} title="Import schema">
            <Upload size={18} />
          </button>
          <button onClick={() => setDocsOpen((open) => !open)} disabled={readonly} title="Documentation">
            <BookOpen size={18} />
          </button>
          <button onClick={onSave} disabled={readonly} title="Save">
            <Save size={18} />
          </button>
          <button onClick={removeDocument} disabled={readonly || !activeDocument} title="Delete">
            <Trash2 size={18} />
          </button>
          <button onClick={openExportDrawer} title="Export">
            <Download size={18} />
          </button>
          <button onClick={() => setConfigOpen((open) => !open)} title="Config">
            <Settings size={18} />
          </button>
        </div>
      </header>

      <main className="workspace">
        {configOpen && (
          <div className="config-popover">
            <div className="pane-header">
              <span>Config</span>
              <button onClick={() => setConfigOpen(false)} title="Close config">
                <X size={16} />
              </button>
            </div>
            <div className="config-body">
              <div className="session-card">
                <span>Session</span>
                <strong>{session?.role === 'editor' ? 'editor' : session?.role === 'read-only' ? 'readonly' : authToken ? 'unavailable' : 'local editor'}</strong>
                <small>{session?.subject ?? (authToken ? 'Token not accepted or API unavailable' : 'No Keycloak token configured')}</small>
              </div>
              <label>
                Keycloak token
                <textarea
                  value={configToken}
                  onChange={(event) => setConfigToken(event.target.value)}
                  placeholder="Paste bearer token when Keycloak is enabled"
                />
              </label>
              <div className="config-actions">
                <button onClick={applyConfigToken}>Apply</button>
                <button onClick={clearConfigToken}>Clear token</button>
              </div>
            </div>
          </div>
        )}
        {docsOpen && (
          <DocumentationDrawer
            model={model}
            metadata={wikiMetadata}
            onChange={setWikiMetadata}
            onClose={() => setDocsOpen(false)}
          />
        )}
        {view === 'editor' ? (
          <>
            <section className="editor-pane">
              <div className="pane-header">
                <span>DBML Text</span>
                {parseError && <strong>{parseError}</strong>}
              </div>
              <textarea className="dbml-textarea" spellCheck={false} value={dbml} onChange={(event) => onTextChange(event.target.value)} readOnly={readonly} />
            </section>

            <section className="diagram-pane">
              <div className="pane-header">
                <span>Diagram</span>
                {linkingFrom && (
                  <div className="link-mode">
                    <span>Linking from {linkLabel(model, linkingFrom)}</span>
                    <button onClick={() => setLinkingFrom(null)}>Cancel</button>
                  </div>
                )}
              </div>
              <ReactFlow
                nodes={visualNodes}
                edges={edges}
                fitView
                nodeTypes={nodeTypes}
                onConnect={onConnect}
                onNodesChange={onNodesChange}
                onNodeClick={(_, node) => setSelectedTableId(node.id)}
                onEdgeClick={(_, edge) => setSelectedRefId(edge.id)}
                onPaneClick={() => setSelectedRefId(null)}
                onNodeDragStop={onNodeDragStop}
                nodesDraggable={!readonly}
                nodesConnectable={!readonly}
              >
                <Background />
                <Controls />
                <MiniMap pannable zoomable />
              </ReactFlow>
              {selectedRefId && (
                <div className="edge-toolbar">
                  <span>{model.refs.find((ref) => ref.id === selectedRefId)?.fromColumn} relationship</span>
                  <button
                    onClick={() => {
                      applyModel(deleteRelationship(model, selectedRefId));
                      setSelectedRefId(null);
                    }}
                    disabled={readonly}
                    title="Delete relationship"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </section>
          </>
        ) : (
          <WikiView
            model={model}
            document={activeDocument}
            versions={versions}
            documentName={documentName}
            metadata={wikiMetadata}
            parseError={parseError}
          />
        )}

        {exportOpen && (
          <aside className="export-drawer">
            <div className="pane-header">
              <span>Export</span>
              <button onClick={() => setExportOpen(false)} title="Close export">
                <X size={16} />
              </button>
            </div>
            <div className="export-body">
              <label>
                Format
                <select
                  value={exportFormat}
                  onChange={(event) => {
                    const nextFormat = event.target.value as ExportFormat;
                    setExportFormat(nextFormat);
                    setCopyStatus('');
                    generateExport(nextFormat);
                  }}
                >
                  <option value="dbml">DBML</option>
                  <option value="postgres">PostgreSQL</option>
                  <option value="mysql">MySQL</option>
                  <option value="mariadb">MariaDB (MySQL compatible)</option>
                  <option value="mssql">MSSQL</option>
                  <option value="oracle">Oracle</option>
                  <option value="json">JSON</option>
                </select>
              </label>
              <div className="export-actions">
                <button onClick={copyExport} disabled={!exportText && Boolean(exportError)}>
                  <Copy size={15} />
                  Copy
                </button>
                <button onClick={downloadExport} disabled={!exportText && Boolean(exportError)}>
                  <Download size={15} />
                  Download
                </button>
                {copyStatus && <span>{copyStatus}</span>}
              </div>
              {exportError && <div className="export-error">{exportError}</div>}
              <pre>{exportText || 'Choose a format to preview export output.'}</pre>
            </div>
          </aside>
        )}
        {importOpen && (
          <aside className="import-drawer">
            <div className="pane-header">
              <span>Import Schema</span>
              <button onClick={() => setImportOpen(false)} title="Close import">
                <X size={16} />
              </button>
            </div>
            <div className="import-body">
              <label>
                Name
                <input value={importName} onChange={(event) => setImportName(event.target.value)} />
              </label>
              <label>
                Format
                <select
                  value={importFormat}
                  onChange={(event) => {
                    const nextFormat = event.target.value as ImportFormat;
                    setImportFormat(nextFormat);
                    if (importInput) convertImport(importInput, nextFormat);
                  }}
                >
                  <option value="dbml">DBML</option>
                  <option value="postgres">PostgreSQL</option>
                  <option value="postgresLegacy">PostgreSQL Legacy</option>
                  <option value="mysql">MySQL</option>
                  <option value="mysqlLegacy">MySQL Legacy</option>
                  <option value="mariadb">MariaDB (MySQL compatible)</option>
                  <option value="mssql">MSSQL</option>
                  <option value="mssqlLegacy">MSSQL Legacy</option>
                  <option value="snowflake">Snowflake</option>
                  <option value="schemarb">Schema.rb</option>
                  <option value="json">JSON</option>
                </select>
              </label>
              {isLegacyImportFormat(importFormat) && <div className="import-warning">Legacy parser mode is for compatibility with older SQL parser behavior.</div>}
              <label>
                File
                <input type="file" onChange={(event) => onImportFile(event.target.files?.[0] ?? null)} />
              </label>
              <label className="import-text">
                Input
                <textarea
                  value={importInput}
                  onChange={(event) => {
                    setImportInput(event.target.value);
                    convertImport(event.target.value, importFormat);
                  }}
                  placeholder="Paste DBML, SQL DDL, or JSON here"
                />
              </label>
              {importError && <div className="import-error">{importError}</div>}
              <div className="import-actions">
                <button onClick={() => convertImport()} disabled={!importInput}>
                  Preview
                </button>
                <button onClick={() => applyImport(true)} disabled={readonly || (!importPreview && !importInput)}>
                  Import as new
                </button>
                <button onClick={() => applyImport(false)} disabled={readonly || (!importPreview && !importInput)}>
                  Replace current
                </button>
              </div>
              <pre>{importPreview || 'Converted DBML preview will appear here.'}</pre>
            </div>
          </aside>
        )}
      </main>
    </div>
  );
}

function DocumentationDrawer({
  model,
  metadata,
  onChange,
  onClose,
}: {
  model: DbmlDocumentModel;
  metadata: WikiMetadata;
  onChange: (metadata: WikiMetadata) => void;
  onClose: () => void;
}) {
  const schemas = useMemo(() => schemaNamesForModel(model), [model]);
  return (
    <aside className="documentation-drawer">
      <div className="pane-header">
        <span>Documentation</span>
        <button onClick={onClose} title="Close documentation">
          <X size={16} />
        </button>
      </div>
      <div className="documentation-body">
        <label>
          Project README
          <textarea
            value={metadata.readme}
            onChange={(event) => onChange({ ...metadata, readme: event.target.value })}
            placeholder="Write a Markdown overview for this database."
          />
        </label>
        {schemas.map((schema) => (
          <label key={schema}>
            Schema note: {schema}
            <textarea
              value={metadata.schemaNotes[schema] ?? ''}
              onChange={(event) =>
                onChange({
                  ...metadata,
                  schemaNotes: { ...metadata.schemaNotes, [schema]: event.target.value },
                })
              }
              placeholder={`Describe the ${schema} schema.`}
            />
          </label>
        ))}
      </div>
    </aside>
  );
}

function WikiView({
  model,
  document,
  versions,
  documentName,
  metadata,
  parseError,
}: {
  model: DbmlDocumentModel;
  document: SavedDocument | null;
  versions: DocumentVersionSummary[];
  documentName: string;
  metadata: WikiMetadata;
  parseError: string | null;
}) {
  const schemas = useMemo(() => groupTablesBySchema(model.tables), [model.tables]);
  const referenceMap = useMemo(() => buildReferenceMap(model), [model]);
  const fieldCount = model.tables.reduce((sum, table) => sum + table.columns.length, 0);
  const displayName = model.project?.name || documentName || 'Untitled schema';
  const readme = metadata.readme.trim() || model.project?.note;

  if (parseError && model.tables.length === 0) {
    return (
      <section className="wiki-view">
        <div className="wiki-error">
          <strong>Wiki unavailable while DBML has errors</strong>
          <span>{parseError}</span>
        </div>
      </section>
    );
  }

  return (
    <section className="wiki-view">
      <div className="wiki-shell">
        {parseError && (
          <div className="wiki-error wiki-error--inline" role="alert">
            <strong>Showing last successful parse</strong>
            <span>{parseError}</span>
          </div>
        )}
        <header className="wiki-hero">
          <div className="wiki-title">
            <Database size={24} />
            <div>
              <h2>{displayName}</h2>
              <span>{model.project?.databaseType ?? 'DBML schema documentation'}</span>
            </div>
          </div>
          <div className="wiki-metadata-grid">
            <MetaItem label="Creator" value={document?.ownerSubject ?? 'Unsaved'} />
            <MetaItem label="Database" value={model.project?.databaseType ?? 'Not specified'} />
            <MetaItem label="Created" value={formatDateTime(document?.createdAt)} />
            <MetaItem label="Modified" value={formatDateTime(document?.updatedAt)} />
            <MetaItem label="Version" value={document ? `v${document.version}` : 'Draft'} />
          </div>
          {readme && <MarkdownNote value={readme} />}
        </header>

        <div className="wiki-stats" aria-label="Schema statistics">
          <Stat value={model.tables.length} label="Tables" />
          <Stat value={fieldCount} label="Fields" />
          <Stat value={model.enums.length} label="Enums" />
          <Stat value={model.refs.length} label="Refs" />
        </div>

        {versions.length > 0 && <RecentActivity versions={versions} owner={document?.ownerSubject ?? 'Unknown'} />}

        {model.tables.length === 0 ? (
          <div className="empty-state wiki-empty">No tables found in this schema.</div>
        ) : (
          schemas.map(([schema, tables]) => (
            <SchemaSection key={schema} schema={schema} tables={tables} note={metadata.schemaNotes[schema]} referenceMap={referenceMap} />
          ))
        )}

        {model.enums.length > 0 && <EnumDocs enums={model.enums} />}
        {model.refs.length > 0 && <RelationshipDocs refs={model.refs} />}
      </div>
    </section>
  );
}

function SchemaSection({
  schema,
  tables,
  note,
  referenceMap,
}: {
  schema: string;
  tables: DbmlTable[];
  note?: string;
  referenceMap: Map<string, string[]>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section className="wiki-section">
      <button className="wiki-section-toggle" onClick={() => setCollapsed((value) => !value)}>
        <span>{collapsed ? 'Show' : 'Hide'}</span>
        <strong>{schema}</strong>
        <small>{tables.length} tables</small>
      </button>
      {note?.trim() && <MarkdownNote value={note} />}
      {!collapsed && (
        <div className="table-doc-list">
          {tables.map((table) => (
            <TableDoc key={table.id} table={table} referenceMap={referenceMap} />
          ))}
        </div>
      )}
    </section>
  );
}

function TableDoc({ table, referenceMap }: { table: DbmlTable; referenceMap: Map<string, string[]> }) {
  const qualifiedName = table.schema ? `${table.schema}.${table.name}` : table.name;
  const preview = table.records
    ? { label: 'Sample data', columns: table.records.columns, rows: table.records.rows }
    : { label: 'Generated preview', columns: table.columns.map((column) => column.name), rows: generateMockRows(table) };
  return (
    <article className="table-doc" id={`table-${table.id}`}>
      <header className="table-doc-header" style={{ borderColor: table.headerColor ?? undefined }}>
        <div>
          <h3>{qualifiedName}</h3>
          {table.alias && <span>alias {table.alias}</span>}
        </div>
        <small>{table.columns.length} fields</small>
      </header>
      {table.note && <MarkdownNote value={table.note} />}
      <div className="table-doc-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Settings</th>
              <th>References</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {table.columns.map((column) => (
              <FieldRow key={column.id} table={table} column={column} references={referenceMap.get(referenceKey(table, column.name)) ?? []} />
            ))}
          </tbody>
        </table>
      </div>
      <TablePreview label={preview.label} columns={preview.columns} rows={preview.rows} />
    </article>
  );
}

function TablePreview({ label, columns, rows }: { label: string; columns: string[]; rows: string[][] }) {
  if (!columns.length) return null;
  return (
    <div className="table-preview">
      <div className="table-preview-header">
        <strong>{label}</strong>
        <span>{rows.length} rows</span>
      </div>
      <div className="table-doc-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {columns.map((column, columnIndex) => (
                  <td key={`${index}-${column}`}>
                    <code>{row[columnIndex] ?? ''}</code>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FieldRow({ table, column, references }: { table: DbmlTable; column: DbmlColumn; references: string[] }) {
  const isPrimary = column.settings.some((setting) => ['pk', 'primary key'].includes(setting.key.toLowerCase()));
  return (
    <tr>
      <td>
        <code>{column.name}</code>
        {isPrimary && <span className="field-pill field-pill-primary">PK</span>}
      </td>
      <td>
        <code>{column.type}</code>
      </td>
      <td>
        <FieldSettings settings={column.settings} />
      </td>
      <td>
        {references.length > 0 ? (
          <div className="field-refs">
            {references.map((ref) => (
              <code key={`${table.id}-${column.id}-${ref}`}>{ref}</code>
            ))}
          </div>
        ) : (
          <span className="muted">None</span>
        )}
      </td>
      <td>{column.note ? <MarkdownNote value={column.note} compact /> : <span className="muted">None</span>}</td>
    </tr>
  );
}

function FieldSettings({ settings }: { settings: DbmlColumn['settings'] }) {
  const visible = settings.filter((setting) => setting.key.toLowerCase() !== 'note');
  if (!visible.length) return <span className="muted">None</span>;
  return (
    <div className="field-settings">
      {visible.map((setting) => (
        <span className="field-pill" key={`${setting.key}:${setting.value ?? ''}`}>
          {setting.value ? `${setting.key}: ${setting.value}` : setting.key}
        </span>
      ))}
    </div>
  );
}

function EnumDocs({ enums }: { enums: DbmlDocumentModel['enums'] }) {
  return (
    <section className="wiki-section">
      <h3 className="wiki-section-heading">Enums</h3>
      <div className="enum-grid">
        {enums.map((item) => (
          <article className="enum-doc" key={item.id}>
            <h4>{item.schema ? `${item.schema}.${item.name}` : item.name}</h4>
            <div>
              {item.values.map((value) => (
                <code key={value}>{value}</code>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function RelationshipDocs({ refs }: { refs: DbmlDocumentModel['refs'] }) {
  return (
    <section className="wiki-section">
      <h3 className="wiki-section-heading">Relationships</h3>
      <div className="relationship-list">
        {refs.map((ref) => (
          <code key={ref.id}>
            {ref.fromTable}.{ref.fromColumn} {ref.relation} {ref.toTable}.{ref.toColumn}
          </code>
        ))}
      </div>
    </section>
  );
}

function MarkdownNote({ value, compact = false }: { value: string; compact?: boolean }) {
  return (
    <div className={compact ? 'markdown-note markdown-note-compact' : 'markdown-note'}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="wiki-meta-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RecentActivity({ versions, owner }: { versions: DocumentVersionSummary[]; owner: string }) {
  return (
    <section className="wiki-section">
      <h3 className="wiki-section-heading">Recent activity</h3>
      <div className="activity-list">
        {versions.slice(0, 5).map((version) => (
          <article className="activity-item" key={version.id}>
            <strong>v{version.versionNumber}</strong>
            <span>{version.note || version.label}</span>
            <small>
              {owner} · {formatDateTime(version.createdAt)}
            </small>
          </article>
        ))}
      </div>
    </section>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="wiki-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function TableNode({ data }: NodeProps<Node<TableNodeData, 'table'>>) {
  const { table, readonly } = data;
  return (
    <div className={data.selected ? 'table-node table-node--selected' : 'table-node'}>
      <div className="table-node__title" style={{ background: table.headerColor ?? '#334155' }}>
        <input
          className="nodrag"
          value={table.name}
          disabled={readonly}
          onChange={(event) => data.onTableChange(table.id, { name: event.target.value })}
          aria-label="Table name"
        />
        <div className="table-node__actions nodrag">
          <button onClick={() => data.onAddColumn(table.id)} disabled={readonly} title="Add column">
            <Plus size={13} />
          </button>
          <button onClick={() => data.onDeleteTable(table.id)} disabled={readonly} title="Delete table">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <div className="table-node__meta nodrag">
        <input
          value={table.schema ?? ''}
          disabled={readonly}
          onChange={(event) => data.onTableChange(table.id, { schema: event.target.value || undefined })}
          placeholder="schema"
          aria-label="Schema"
        />
        <input
          value={table.headerColor ?? ''}
          disabled={readonly}
          onChange={(event) => data.onTableChange(table.id, { headerColor: event.target.value || undefined })}
          placeholder="#color"
          aria-label="Header color"
        />
      </div>
      <div className="table-node__columns">
        {table.columns.map((column) => {
          const isPrimary = column.settings.some((setting) => ['pk', 'primary key'].includes(setting.key.toLowerCase()));
          const isLinkSource = data.linkingFrom?.tableId === table.id && data.linkingFrom.columnId === column.id;
          const isLinkTarget = data.linkingFrom && !isLinkSource;
          return (
            <div className={`table-node__column${isLinkSource ? ' table-node__column--link-source' : ''}${isLinkTarget ? ' table-node__column--link-target' : ''}`} key={column.id}>
              <Handle className="column-handle column-handle--target" id={columnHandleId(table, column.name, 'target')} type="target" position={Position.Left} isConnectable={!readonly} />
              <input className="nodrag" value={column.name} disabled={readonly} onChange={(event) => data.onColumnChange(table.id, column.id, { name: event.target.value })} aria-label="Column name" />
              <input className="nodrag" value={column.type} disabled={readonly} onChange={(event) => data.onColumnChange(table.id, column.id, { type: event.target.value })} aria-label="Column type" />
              <button
                className={`nodrag${isPrimary ? ' is-active' : ''}`}
                onClick={() => data.onToggleColumnSetting(table.id, column.id, 'pk')}
                disabled={readonly}
                title="Primary key"
              >
                PK
              </button>
              <button className="nodrag link-column-button" onClick={() => data.onColumnLinkClick(table.id, column.id)} disabled={readonly} title={isLinkSource ? 'Cancel link' : 'Link column'}>
                <Link2 size={12} />
              </button>
              <button className="nodrag" onClick={() => data.onDeleteColumn(table.id, column.id)} disabled={readonly} title="Delete column">
                <Trash2 size={12} />
              </button>
              <Handle className="column-handle column-handle--source" id={columnHandleId(table, column.name, 'source')} type="source" position={Position.Right} isConnectable={!readonly} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function tableIdForRef(model: DbmlDocumentModel, tableName: string) {
  return model.tables.find((table) => table.name === tableName || table.alias === tableName)?.id ?? `table_public_${tableName}`;
}

function tableForRef(model: DbmlDocumentModel, tableName: string) {
  return model.tables.find((table) => table.name === tableName || table.alias === tableName);
}

function columnHandleId(table: DbmlTable, columnName: string, direction: 'source' | 'target') {
  const column = table.columns.find((item) => item.name === columnName);
  return `${direction}:${column?.id ?? columnName}`;
}

function parseColumnHandle(handleId: string) {
  return handleId.split(':').slice(1).join(':');
}

function linkLabel(model: DbmlDocumentModel, linkStart: LinkStart) {
  const table = model.tables.find((item) => item.id === linkStart.tableId);
  const column = table?.columns.find((item) => item.id === linkStart.columnId);
  return `${table?.name ?? 'table'}.${column?.name ?? 'column'}`;
}

function downloadBlob(blob: Blob, fileName: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(href);
}

function exportExtension(format: ExportFormat) {
  if (format === 'dbml') return 'dbml';
  if (format === 'json') return 'json';
  return 'sql';
}

function safeFileName(input: string) {
  return input.trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'schema';
}

function isLegacyImportFormat(format: ImportFormat) {
  return format === 'mysqlLegacy' || format === 'postgresLegacy' || format === 'mssqlLegacy';
}

function groupTablesBySchema(tables: DbmlTable[]): Array<[string, DbmlTable[]]> {
  const groups = new Map<string, DbmlTable[]>();
  for (const table of tables) {
    const schema = table.schema ?? 'public';
    groups.set(schema, [...(groups.get(schema) ?? []), table]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function schemaNamesForModel(model: DbmlDocumentModel) {
  return [...new Set([...model.tables.map((table) => table.schema ?? 'public'), ...model.enums.map((item) => item.schema ?? 'public')])].sort();
}

function normalizeWikiMetadata(input: unknown): WikiMetadata {
  if (!input || typeof input !== 'object') return emptyWikiMetadata;
  const value = input as Partial<WikiMetadata>;
  return {
    readme: typeof value.readme === 'string' ? value.readme : '',
    schemaNotes: value.schemaNotes && typeof value.schemaNotes === 'object' ? value.schemaNotes : {},
  };
}

function formatDateTime(value?: string) {
  if (!value) return 'Not saved';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function generateMockRows(table: DbmlTable) {
  return [1, 2, 3].map((index) => table.columns.map((column) => mockValue(table, column, index)));
}

function mockValue(table: DbmlTable, column: DbmlColumn, index: number) {
  const name = column.name.toLowerCase();
  const type = column.type.toLowerCase();
  if (name === 'id' || name.endsWith('_id')) return String(index);
  if (type.includes('bool')) return index % 2 === 0 ? 'false' : 'true';
  if (type.includes('int') || type.includes('decimal') || type.includes('numeric') || type.includes('float') || type.includes('double')) return String(index * 10);
  if (type.includes('date') || type.includes('time')) return `2026-05-${String(10 + index).padStart(2, '0')}`;
  if (name.includes('email')) return `user${index}@example.com`;
  if (name.includes('status')) return index === 1 ? 'active' : 'pending';
  if (name.includes('name')) return `${table.name} ${index}`;
  return `${column.name}_${index}`;
}

function buildReferenceMap(model: DbmlDocumentModel) {
  const map = new Map<string, string[]>();
  const tableLookup = new Map<string, DbmlTable>();
  for (const table of model.tables) {
    tableLookup.set(table.name, table);
    if (table.alias) tableLookup.set(table.alias, table);
    if (table.schema) tableLookup.set(`${table.schema}.${table.name}`, table);
  }

  for (const ref of model.refs) {
    const fromTable = tableLookup.get(ref.fromTable);
    const toTable = tableLookup.get(ref.toTable);
    const fromName = `${ref.fromTable}.${ref.fromColumn}`;
    const toName = `${ref.toTable}.${ref.toColumn}`;
    addReference(map, fromTable ? referenceKey(fromTable, ref.fromColumn) : `${ref.fromTable}.${ref.fromColumn}`, `to ${toName}`);
    addReference(map, toTable ? referenceKey(toTable, ref.toColumn) : `${ref.toTable}.${ref.toColumn}`, `from ${fromName}`);
  }

  return map;
}

function referenceKey(table: DbmlTable, columnName: string) {
  return `${table.id}.${columnName}`;
}

function addReference(map: Map<string, string[]>, key: string, label: string) {
  map.set(key, [...(map.get(key) ?? []), label]);
}
