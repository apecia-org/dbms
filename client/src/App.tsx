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
import { Copy, Download, FileJson, Link2, Plus, Save, Settings, Trash2, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteDocument, getSession, listDocuments, saveDocument, type Session } from './api';
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
  parseDbmlToModel,
  toggleColumnSetting,
  updateColumn,
  updateTable,
  updateTablePosition,
  validateDbml,
} from './dbml';
import type { DbmlColumn, DbmlDocumentModel, DbmlTable, Role, SavedDocument } from './types';

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

export function App() {
  const [role, setRole] = useState<Role>('editor');
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('dbml_auth_token') ?? '');
  const [configToken, setConfigToken] = useState(() => localStorage.getItem('dbml_auth_token') ?? '');
  const [session, setSession] = useState<Session | null>(null);
  const [dbml, setDbml] = useState(defaultDbml);
  const [parseError, setParseError] = useState<string | null>(null);
  const [model, setModel] = useState<DbmlDocumentModel>(() => parseDbmlToModel(defaultDbml));
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<SavedDocument[]>([]);
  const [activeDocument, setActiveDocument] = useState<SavedDocument | null>(null);
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
  const readonly = role === 'readonly';

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
    const next = value ?? '';
    setDbml(next);
    const error = validateDbml(next);
    setParseError(error);
    if (!error) setModel(parseDbmlToModel(next));
  }

  function loadDbmlDocument(nextDbml: string, name: string, document: SavedDocument | null) {
    setActiveDocument(document);
    setDocumentName(name);
    setDbml(nextDbml);
    setParseError(validateDbml(nextDbml));
    setModel(parseDbmlToModel(nextDbml));
    setSelectedRefId(null);
    setSelectedTableId(null);
    setLinkingFrom(null);
  }

  function onNodeDragStop(_: unknown, node: Node) {
    applyModel(updateTablePosition(model, node.id, node.position.x, node.position.y));
  }

  function onNodesChange(changes: NodeChange[]) {
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
    const saved = await saveDocument({
      id: activeDocument?.id,
      name: documentName,
      dbml,
      layoutJson: { tables: model.tables.map(({ id, x, y }) => ({ id, x, y })) },
    }, authToken || undefined);
    setActiveDocument(saved);
    setDocuments(await listDocuments(authToken || undefined));
  }

  function loadDocument(document: SavedDocument) {
    loadDbmlDocument(document.dbml, document.name, document);
  }

  function startNewSchema() {
    loadDbmlDocument(defaultDbml, 'Untitled schema', null);
  }

  async function removeDocument() {
    if (!activeDocument || readonly) return;
    await deleteDocument(activeDocument.id, authToken || undefined);
    setActiveDocument(null);
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
            <span>{parseError ? 'DBML has errors' : 'DBML synced'}</span>
          </div>
        </div>
        <div className="toolbar">
          <select
            className="schema-select"
            value={activeDocument?.id ?? ''}
            onChange={(event) => {
              const document = documents.find((item) => item.id === event.target.value);
              if (document) loadDocument(document);
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
          <input value={documentName} onChange={(event) => setDocumentName(event.target.value)} aria-label="Document name" />
          <button onClick={() => applyModel(addTable(model))} disabled={readonly} title="Add table">
            <Plus size={18} />
          </button>
          <button onClick={startNewSchema} disabled={readonly} title="New schema">
            <FileJson size={18} />
          </button>
          <button onClick={() => setImportOpen(true)} disabled={readonly} title="Import schema">
            <Upload size={18} />
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
        <section className="editor-pane">
          <div className="pane-header">
            <span>DBML Text</span>
            {parseError && <strong>{parseError}</strong>}
          </div>
          <textarea className="dbml-textarea" spellCheck={false} value={dbml} onChange={(event) => onTextChange(event.target.value)} />
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
