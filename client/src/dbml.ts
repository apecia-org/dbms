import { exporter, importer, Parser } from '@dbml/core';
import type { ColumnSetting, DbmlColumn, DbmlDocumentModel, DbmlRecordSet, DbmlRef, DbmlTable } from './types';

const sampleDbml = `Project ecommerce {
  database_type: 'PostgreSQL'
  Note: 'Editable DBML project'
}

Table users [headercolor: #4F46E5] {
  id int [pk, increment]
  email varchar(255) [not null, unique]
  name varchar(255)
  created_at timestamp [default: \`now()\`]
  Note: 'Application users'
}

Table orders [headercolor: #059669] {
  id int [pk, increment]
  user_id int [not null]
  total decimal(12,2) [not null, default: 0]
  status order_status [not null]
  created_at timestamp [default: \`now()\`]
}

Enum order_status {
  pending
  paid
  cancelled
}

Ref: orders.user_id > users.id
`;

export const defaultDbml = sampleDbml;

export function validateDbml(dbml: string): string | null {
  try {
    const parser = new Parser();
    parser.parse(dbml, 'dbmlv2');
    return null;
  } catch (error) {
    return formatParseError(error);
  }
}

export function parseDbmlSchemaCache(dbml: string): unknown | null {
  const error = validateDbml(dbml);
  return error ? null : parseDbmlToModel(dbml);
}

export type ExportFormat = 'dbml' | 'postgres' | 'mysql' | 'mariadb' | 'mssql' | 'oracle' | 'json';

export function exportDbml(dbml: string, format: ExportFormat): string {
  return exporter.export(dbml, format === 'mariadb' ? 'mysql' : format);
}

export type ImportFormat = 'dbml' | 'postgres' | 'postgresLegacy' | 'mysql' | 'mysqlLegacy' | 'mariadb' | 'mssql' | 'mssqlLegacy' | 'snowflake' | 'schemarb' | 'json';

export function importToDbml(input: string, format: ImportFormat): string {
  const normalized = input.trim();
  if (!normalized) throw new Error('Import input is empty.');

  if (format === 'dbml') {
    const error = validateDbml(normalized);
    if (error) throw new Error(error);
    return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
  }

  if (format === 'json') {
    try {
      JSON.parse(normalized);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Invalid JSON input.');
    }
  }

  const sdkFormat = format === 'mariadb' ? 'mysql' : format;
  return importer.import(normalized, sdkFormat);
}

export function parseDbmlToModel(dbml: string): DbmlDocumentModel {
  try {
    const db = new Parser().parse(dbml, 'dbmlv2') as unknown as ParsedDatabase;
    return modelFromDatabase(db, dbml);
  } catch {
    return modelFromRegex(dbml);
  }
}

type ParsedDatabase = {
  name?: string;
  databaseType?: string;
  note?: string;
  export(): ExportedDatabase;
};

export function modelToDbml(model: DbmlDocumentModel): string {
  const sections: string[] = [];

  if (model.project?.name) {
    const lines = [`Project ${quoteIdent(model.project.name)} {`];
    if (model.project.databaseType) lines.push(`  database_type: '${escapeSingle(model.project.databaseType)}'`);
    if (model.project.note) lines.push(indentNote('  Note: ', model.project.note));
    lines.push('}');
    sections.push(lines.join('\n'));
  }

  for (const table of model.tables) {
    const qualified = table.schema ? `${quoteIdent(table.schema)}.${quoteIdent(table.name)}` : quoteIdent(table.name);
    const alias = table.alias ? ` as ${quoteIdent(table.alias)}` : '';
    const settings = table.headerColor ? ` [headercolor: ${table.headerColor}]` : '';
    const lines = [`Table ${qualified}${alias}${settings} {`];
    for (const column of table.columns) {
      const settingsText = formatSettings(column.settings);
      lines.push(`  ${quoteIdent(column.name)} ${column.type || 'varchar'}${settingsText}`);
    }
    if (table.note) lines.push(indentNote('  Note: ', table.note));
    lines.push('}');
    sections.push(lines.join('\n'));
  }

  for (const item of model.enums) {
    const name = item.schema ? `${quoteIdent(item.schema)}.${quoteIdent(item.name)}` : quoteIdent(item.name);
    const lines = [`Enum ${name} {`, ...item.values.map((value) => `  ${quoteIdent(value)}`), '}'];
    sections.push(lines.join('\n'));
  }

  for (const ref of model.refs) {
    sections.push(`Ref: ${quoteIdent(ref.fromTable)}.${quoteIdent(ref.fromColumn)} ${ref.relation} ${quoteIdent(ref.toTable)}.${quoteIdent(ref.toColumn)}`);
  }

  sections.push(...model.extras);
  return `${sections.filter(Boolean).join('\n\n')}\n`;
}

export function updateTablePosition(model: DbmlDocumentModel, tableId: string, x: number, y: number): DbmlDocumentModel {
  return {
    ...model,
    tables: model.tables.map((table) => (table.id === tableId ? { ...table, x, y } : table)),
  };
}

export function addTable(model: DbmlDocumentModel): DbmlDocumentModel {
  const index = model.tables.length + 1;
  const table: DbmlTable = {
    id: `table_${crypto.randomUUID()}`,
    name: `new_table_${index}`,
    columns: [{ id: `column_${crypto.randomUUID()}`, name: 'id', type: 'int', settings: [{ key: 'pk' }] }],
    x: 120 + index * 24,
    y: 120 + index * 24,
  };
  return { ...model, tables: [...model.tables, table] };
}

export function updateTable(model: DbmlDocumentModel, tableId: string, patch: Partial<DbmlTable>): DbmlDocumentModel {
  const previous = model.tables.find((table) => table.id === tableId);
  const nextName = patch.name ?? previous?.name;
  const nextAlias = patch.alias ?? previous?.alias;
  const previousNames = [previous?.name, previous?.alias].filter(Boolean);
  return {
    ...model,
    tables: model.tables.map((table) => (table.id === tableId ? { ...table, ...patch } : table)),
    refs: previous
      ? model.refs.map((ref) => ({
          ...ref,
          fromTable: previousNames.includes(ref.fromTable) ? nextAlias || nextName || ref.fromTable : ref.fromTable,
          toTable: previousNames.includes(ref.toTable) ? nextAlias || nextName || ref.toTable : ref.toTable,
        }))
      : model.refs,
  };
}

export function deleteTable(model: DbmlDocumentModel, tableId: string): DbmlDocumentModel {
  const table = model.tables.find((item) => item.id === tableId);
  if (!table) return model;
  return {
    ...model,
    tables: model.tables.filter((item) => item.id !== tableId),
    refs: model.refs.filter((ref) => ref.fromTable !== table.name && ref.toTable !== table.name && ref.fromTable !== table.alias && ref.toTable !== table.alias),
  };
}

export function updateColumn(model: DbmlDocumentModel, tableId: string, columnId: string, patch: Partial<DbmlColumn>): DbmlDocumentModel {
  const table = model.tables.find((item) => item.id === tableId);
  const column = table?.columns.find((item) => item.id === columnId);
  const nextName = patch.name ?? column?.name;
  const tableNames = [table?.name, table?.alias].filter(Boolean);
  return {
    ...model,
    tables: model.tables.map((table) =>
      table.id === tableId
        ? {
            ...table,
            columns: table.columns.map((column) => (column.id === columnId ? { ...column, ...patch } : column)),
          }
        : table,
    ),
    refs:
      table && column && nextName
        ? model.refs.map((ref) => ({
            ...ref,
            fromColumn: tableNames.includes(ref.fromTable) && ref.fromColumn === column.name ? nextName : ref.fromColumn,
            toColumn: tableNames.includes(ref.toTable) && ref.toColumn === column.name ? nextName : ref.toColumn,
          }))
        : model.refs,
  };
}

export function toggleColumnSetting(model: DbmlDocumentModel, tableId: string, columnId: string, key: string): DbmlDocumentModel {
  const normalized = key.toLowerCase();
  return {
    ...model,
    tables: model.tables.map((table) =>
      table.id === tableId
        ? {
            ...table,
            columns: table.columns.map((column) => {
              if (column.id !== columnId) return column;
              const hasSetting = column.settings.some((setting) => setting.key.toLowerCase() === normalized);
              return {
                ...column,
                settings: hasSetting
                  ? column.settings.filter((setting) => setting.key.toLowerCase() !== normalized)
                  : [...column.settings, { key }],
              };
            }),
          }
        : table,
    ),
  };
}

export function addColumn(model: DbmlDocumentModel, tableId: string): DbmlDocumentModel {
  return {
    ...model,
    tables: model.tables.map((table) =>
      table.id === tableId
        ? {
            ...table,
            columns: [...table.columns, { id: `column_${crypto.randomUUID()}`, name: `column_${table.columns.length + 1}`, type: 'varchar', settings: [] }],
          }
        : table,
    ),
  };
}

export function deleteColumn(model: DbmlDocumentModel, tableId: string, columnId: string): DbmlDocumentModel {
  const table = model.tables.find((item) => item.id === tableId);
  const column = table?.columns.find((item) => item.id === columnId);
  return {
    ...model,
    tables: model.tables.map((table) =>
      table.id === tableId ? { ...table, columns: table.columns.filter((column) => column.id !== columnId) } : table,
    ),
    refs:
      table && column
        ? model.refs.filter(
            (ref) =>
              !((ref.fromTable === table.name || ref.fromTable === table.alias) && ref.fromColumn === column.name) &&
              !((ref.toTable === table.name || ref.toTable === table.alias) && ref.toColumn === column.name),
          )
        : model.refs,
  };
}

export function addRelationship(
  model: DbmlDocumentModel,
  input: {
    fromTableId: string;
    fromColumn: string;
    relation: DbmlRef['relation'];
    toTableId: string;
    toColumn: string;
  },
): DbmlDocumentModel {
  const fromTable = model.tables.find((table) => table.id === input.fromTableId);
  const toTable = model.tables.find((table) => table.id === input.toTableId);
  if (!fromTable || !toTable || !input.fromColumn || !input.toColumn) return model;

  const ref: DbmlRef = {
    id: `ref_${crypto.randomUUID()}`,
    fromTable: fromTable.alias || fromTable.name,
    fromColumn: input.fromColumn,
    relation: input.relation,
    toTable: toTable.alias || toTable.name,
    toColumn: input.toColumn,
  };

  return { ...model, refs: [...model.refs, ref] };
}

export function deleteRelationship(model: DbmlDocumentModel, refId: string): DbmlDocumentModel {
  return { ...model, refs: model.refs.filter((ref) => ref.id !== refId) };
}

// ─── Official-parser path ────────────────────────────────────────────────────

type ExportedField = {
  name: string;
  type: { type_name?: string; args?: string | null } | string | null;
  unique?: boolean;
  pk?: boolean;
  not_null?: boolean;
  note?: string | null;
  dbdefault?: { value: unknown; type: 'string' | 'expression' | 'number' | 'boolean' } | null;
  increment?: boolean;
};

type ExportedTable = {
  name: string;
  alias?: string | null;
  note?: string | null;
  headerColor?: string | null;
  fields: ExportedField[];
};

type ExportedEnum = {
  name: string;
  note?: string | null;
  values: { name: string; note?: string | null }[];
};

type ExportedEndpoint = {
  schemaName?: string | null;
  tableName: string;
  fieldNames: string[];
  relation: '*' | '1' | string;
};

type ExportedRef = {
  endpoints: [ExportedEndpoint, ExportedEndpoint];
};

type ExportedSchema = {
  name: string;
  tables: ExportedTable[];
  enums: ExportedEnum[];
  refs: ExportedRef[];
};

type ExportedDatabase = {
  schemas: ExportedSchema[];
  records?: { schemaName?: string | null; tableName: string; columns: string[]; values: { value: unknown }[][] }[];
};

function modelFromDatabase(db: ParsedDatabase, dbml: string): DbmlDocumentModel {
  const exported = db.export();
  const tables: DbmlTable[] = [];
  const refs: DbmlRef[] = [];
  const enums: DbmlDocumentModel['enums'] = [];

  const recordsByTable = new Map<string, DbmlRecordSet>();
  for (const record of exported.records ?? []) {
    const key = record.schemaName && record.schemaName !== 'public' ? `${record.schemaName}.${record.tableName}` : record.tableName;
    recordsByTable.set(key, {
      columns: record.columns,
      rows: record.values.map((row) => row.map((cell) => formatRecordValue(cell?.value))),
      source: 'records',
    });
  }
  // Records authored with the non-standard `records {…}` extension still need regex fallback.
  const inlineRecords = parseExternalRecordsRegex(dbml);

  let index = 0;
  for (const schema of exported.schemas) {
    const schemaName = schema.name === 'public' ? undefined : schema.name;

    for (const table of schema.tables) {
      const qualified = schemaName ? `${schemaName}.${table.name}` : table.name;
      const recordSet =
        recordsByTable.get(qualified) ?? recordsByTable.get(table.name) ?? inlineRecords.get(qualified) ?? inlineRecords.get(table.name);

      tables.push({
        id: tableId(schemaName, table.name),
        schema: schemaName,
        name: table.name,
        alias: table.alias || undefined,
        note: cleanNote(table.note),
        headerColor: table.headerColor || undefined,
        columns: table.fields.map((field) => fieldToColumn(field)),
        records: recordSet,
        x: 80 + (index % 4) * 300,
        y: 80 + Math.floor(index / 4) * 260,
      });
      index += 1;
    }

    for (const enumDef of schema.enums) {
      enums.push({
        id: `enum_${schemaName ?? 'public'}_${enumDef.name}`,
        schema: schemaName,
        name: enumDef.name,
        values: enumDef.values.map((value) => value.name),
      });
    }

    for (const ref of schema.refs) {
      const [from, to] = ref.endpoints;
      const fromTable = qualifiedRefName(from, schemaName);
      const toTable = qualifiedRefName(to, schemaName);
      refs.push({
        id: `ref_${refs.length}_${fromTable}_${toTable}`,
        fromTable,
        fromColumn: from.fieldNames[0] ?? '',
        relation: endpointsToRelation(from.relation, to.relation),
        toTable,
        toColumn: to.fieldNames[0] ?? '',
      });
    }
  }

  return {
    project: db.name || db.databaseType || db.note
      ? { name: db.name || undefined, databaseType: db.databaseType || undefined, note: cleanNote(db.note) }
      : undefined,
    tables,
    refs,
    enums,
    extras: parseExtras(dbml),
  };
}

function fieldToColumn(field: ExportedField): DbmlColumn {
  const settings: ColumnSetting[] = [];
  if (field.pk) settings.push({ key: 'pk' });
  if (field.increment) settings.push({ key: 'increment' });
  if (field.unique) settings.push({ key: 'unique' });
  if (field.not_null) settings.push({ key: 'not null' });
  if (field.dbdefault) settings.push({ key: 'default', value: formatDefault(field.dbdefault) });
  const note = cleanNote(field.note);
  if (note) settings.push({ key: 'note', value: `'${escapeSingle(note)}'` });

  return {
    id: `${field.name}_${crypto.randomUUID()}`,
    name: field.name,
    type: typeName(field.type),
    settings,
    ...(note ? { note } : {}),
  };
}

function typeName(type: ExportedField['type']): string {
  if (!type) return 'varchar';
  if (typeof type === 'string') return type;
  return type.type_name || 'varchar';
}

function formatDefault(def: NonNullable<ExportedField['dbdefault']>): string {
  switch (def.type) {
    case 'string':
      return `'${escapeSingle(String(def.value))}'`;
    case 'expression':
      return `\`${String(def.value)}\``;
    default:
      return String(def.value);
  }
}

function formatRecordValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return String(value);
}

function endpointsToRelation(from: string, to: string): DbmlRef['relation'] {
  if (from === '*' && to === '1') return '>';
  if (from === '1' && to === '*') return '<';
  if (from === '*' && to === '*') return '<>';
  return '-';
}

function qualifiedRefName(endpoint: ExportedEndpoint, fallbackSchema: string | undefined): string {
  const schema = endpoint.schemaName && endpoint.schemaName !== 'public' ? endpoint.schemaName : undefined;
  const effective = schema ?? fallbackSchema;
  return effective ? `${effective}.${endpoint.tableName}` : endpoint.tableName;
}

function cleanNote(note: string | null | undefined): string | undefined {
  if (!note) return undefined;
  const trimmed = note.replace(/\s+$/, '');
  return trimmed || undefined;
}

function formatParseError(error: unknown): string {
  if (!error) return 'Unknown parse error.';
  if (typeof error === 'object' && error !== null) {
    const diags = (error as { diags?: { message?: string; location?: { start?: { line?: number; column?: number } } }[] }).diags;
    if (Array.isArray(diags) && diags.length) {
      return diags
        .map((diag) => {
          const line = diag.location?.start?.line;
          const column = diag.location?.start?.column;
          const where = line ? ` (line ${line}${column ? `, col ${column}` : ''})` : '';
          return `${diag.message ?? 'Parse error'}${where}`;
        })
        .join('\n');
    }
    if ((error as { message?: string }).message) return (error as { message: string }).message;
  }
  return String(error);
}

// ─── Regex fallback (kept lenient for partial / unsupported syntax) ──────────

function modelFromRegex(dbml: string): DbmlDocumentModel {
  return {
    project: parseProjectRegex(dbml),
    tables: parseTablesRegex(dbml),
    refs: parseRefsRegex(dbml),
    enums: parseEnumsRegex(dbml),
    extras: parseExtras(dbml),
  };
}

function parseProjectRegex(dbml: string) {
  const match = /Project\s+([^{\s]+)\s*\{([\s\S]*?)\}/i.exec(dbml);
  if (!match) return undefined;
  const body = match[2];
  return {
    name: unquoteIdent(match[1]),
    databaseType: readStringSetting(body, 'database_type'),
    note: readStringSetting(body, 'Note'),
  };
}

function parseTablesRegex(dbml: string): DbmlTable[] {
  const tables: DbmlTable[] = [];
  const externalRecords = parseExternalRecordsRegex(dbml);
  const re = /Table\s+([^{\s]+)(?:\s+as\s+([^{\s\[]+))?\s*(\[[^\]]+\])?\s*\{([\s\S]*?)\}/gi;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = re.exec(dbml))) {
    const [schema, name] = splitQualified(match[1]);
    const body = match[4];
    const settings = match[3] ?? '';
    const tableName = schema ? `${schema}.${name}` : name;
    const columns = parseColumnsRegex(body);
    tables.push({
      id: tableId(schema, name),
      schema,
      name,
      alias: match[2] ? unquoteIdent(match[2]) : undefined,
      note: readStringSetting(body, 'Note'),
      headerColor: /headercolor\s*:\s*([#\w]+)/i.exec(settings)?.[1],
      columns,
      records: parseInlineRecordsRegex(body, columns) ?? externalRecords.get(tableName) ?? externalRecords.get(name),
      x: 80 + (index % 4) * 300,
      y: 80 + Math.floor(index / 4) * 260,
    });
    index += 1;
  }
  return tables;
}

function parseExternalRecordsRegex(dbml: string) {
  const records = new Map<string, DbmlRecordSet>();
  const re = /records\s+([^{\s(]+)\s*\(([^)]*)\)\s*\{([\s\S]*?)\}/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(dbml))) {
    records.set(unquoteIdent(match[1]), {
      columns: parseRecordColumns(match[2]),
      rows: parseRecordRows(match[3]),
      source: 'records',
    });
  }
  return records;
}

function parseInlineRecordsRegex(body: string, columns: DbmlColumn[]): DbmlRecordSet | undefined {
  const explicit = /records\s*\(([^)]*)\)\s*\{([\s\S]*?)\}/i.exec(body);
  if (explicit) {
    return {
      columns: parseRecordColumns(explicit[1]),
      rows: parseRecordRows(explicit[2]),
      source: 'records',
    };
  }

  const implicit = /records\s*\{([\s\S]*?)\}/i.exec(body);
  if (!implicit) return undefined;
  return {
    columns: columns.map((column) => column.name),
    rows: parseRecordRows(implicit[1]),
    source: 'records',
  };
}

function parseRecordColumns(input: string) {
  return splitCsvLike(input).map(unquoteRecordValue).filter(Boolean);
}

function parseRecordRows(input: string) {
  return input
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('//'))
    .map((line) => splitCsvLike(line).map(unquoteRecordValue));
}

function splitCsvLike(input: string) {
  const values: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const char of input) {
    if ((char === "'" || char === '"' || char === '`') && (!quote || quote === char)) {
      quote = quote === char ? null : char;
    }
    if (char === ',' && !quote) {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  values.push(current.trim());
  return values;
}

function unquoteRecordValue(input: string) {
  return input.replace(/^(['"`])([\s\S]*)\1$/, '$2');
}

function parseColumnsRegex(body: string): DbmlColumn[] {
  return stripRecordBlocks(body)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('//') && !line.startsWith('Note:') && !line.startsWith('indexes') && !line.startsWith('}'))
    .filter((line) => !line.startsWith('~') && !line.includes('{'))
    .map<DbmlColumn | null>((line) => {
      const match = /^("[^"]+"|[^\s]+)\s+([^\s\[]+)(?:\s*(\[[^\]]+\]))?/.exec(line);
      if (!match) return null;
      const name = unquoteIdent(match[1]);
      const type = match[2];
      const settings = parseSettings(match[3] ?? '');
      const note = settings.find((setting) => setting.key.toLowerCase() === 'note')?.value;
      return { id: `${name}_${crypto.randomUUID()}`, name, type, settings, ...(note ? { note: unquoteSetting(note) } : {}) };
    })
    .filter((column): column is DbmlColumn => Boolean(column));
}

function stripRecordBlocks(input: string) {
  return input.replace(/records\s*(?:\([^)]*\))?\s*\{[\s\S]*?\}/gi, '');
}

function parseRefsRegex(dbml: string): DbmlRef[] {
  const refs: DbmlRef[] = [];
  const standalone = /Ref(?:\s+[^{:]+)?\s*:\s*([^\s.]+)\.([^\s]+)\s*(<>|<|>|-)\s*([^\s.]+)\.([^\s]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = standalone.exec(dbml))) {
    refs.push({
      id: `ref_${refs.length}_${match[1]}_${match[4]}`,
      fromTable: unquoteIdent(match[1]),
      fromColumn: unquoteIdent(match[2]),
      relation: match[3] as DbmlRef['relation'],
      toTable: unquoteIdent(match[4]),
      toColumn: unquoteIdent(match[5]),
    });
  }
  return refs;
}

function parseEnumsRegex(dbml: string) {
  const enums = [];
  const re = /Enum\s+([^{\s]+)\s*\{([\s\S]*?)\}/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(dbml))) {
    const [schema, name] = splitQualified(match[1]);
    const values = match[2]
      .split('\n')
      .map((line) => line.trim().split(/\s+\[/)[0])
      .filter(Boolean)
      .map(unquoteIdent);
    enums.push({ id: `enum_${schema ?? 'public'}_${name}`, schema, name, values });
  }
  return enums;
}

function parseExtras(dbml: string): string[] {
  const stripped = dbml
    .replace(/Project\s+[^{\s]+\s*\{[\s\S]*?\}/gi, '')
    .replace(/Table\s+[^{\s]+(?:\s+as\s+[^{\s\[]+)?\s*(?:\[[^\]]+\])?\s*\{[\s\S]*?\}/gi, '')
    .replace(/Enum\s+[^{\s]+\s*\{[\s\S]*?\}/gi, '')
    .replace(/Ref(?:\s+[^{:]+)?\s*:\s*[^\n]+/gi, '')
    .trim();
  return stripped ? [stripped] : [];
}

function parseSettings(input: string): ColumnSetting[] {
  const content = input.replace(/^\[/, '').replace(/\]$/, '').trim();
  if (!content) return [];
  return splitSettings(content).map((part) => {
    const [key, ...rest] = part.trim().split(':');
    return { key: key.trim(), value: unquoteSetting(rest.join(':').trim()) || undefined };
  });
}

function formatSettings(settings: ColumnSetting[]) {
  if (!settings.length) return '';
  const body = settings.map((setting) => (setting.value ? `${setting.key}: ${setting.value}` : setting.key)).join(', ');
  return ` [${body}]`;
}

function indentNote(prefix: string, value: string): string {
  if (!value.includes('\n')) return `${prefix}'${escapeSingle(value)}'`;
  const indent = ' '.repeat(Math.max(0, prefix.length));
  const body = value
    .split('\n')
    .map((line) => `${indent}${line}`)
    .join('\n');
  return `${prefix}'''\n${body}\n${indent}'''`;
}

function readStringSetting(body: string, key: string): string | undefined {
  const tripleQuoted = new RegExp(`${key}\\s*:\\s*'''([\\s\\S]*?)'''`, 'i').exec(body);
  if (tripleQuoted) return dedentTripleQuoted(tripleQuoted[1]);
  const match = new RegExp(`${key}\\s*:\\s*'([^']*)'`, 'i').exec(body);
  return match?.[1];
}

function dedentTripleQuoted(input: string): string {
  const lines = input.replace(/^\n/, '').replace(/\s+$/, '').split('\n');
  const indents = lines.filter((line) => line.trim()).map((line) => line.match(/^\s*/)?.[0].length ?? 0);
  const minIndent = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(minIndent)).join('\n');
}

function splitQualified(input: string): [string | undefined, string] {
  const value = unquoteIdent(input);
  const parts = value.split('.');
  if (parts.length > 1) return [parts[0], parts.slice(1).join('.')];
  return [undefined, value];
}

function tableId(schema: string | undefined, name: string) {
  return `table_${schema ?? 'public'}_${name}`;
}

function quoteIdent(input: string) {
  return /^[A-Za-z_][\w$]*$/.test(input) ? input : `"${input.replaceAll('"', '\\"')}"`;
}

function unquoteIdent(input: string) {
  return input.replace(/^"/, '').replace(/"$/, '');
}

function escapeSingle(input: string) {
  return input.replaceAll("'", "\\'");
}

function splitSettings(input: string) {
  const settings: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const char of input) {
    if ((char === "'" || char === '"' || char === '`') && (!quote || quote === char)) {
      quote = quote === char ? null : char;
    }
    if (char === ',' && !quote) {
      settings.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) settings.push(current);
  return settings;
}

function unquoteSetting(input: string) {
  return input.replace(/^(['"`])([\s\S]*)\1$/, '$2');
}
