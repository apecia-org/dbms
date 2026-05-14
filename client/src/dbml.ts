import { exporter, importer, Parser } from '@dbml/core';
import type { ColumnSetting, DbmlColumn, DbmlDocumentModel, DbmlRef, DbmlTable } from './types';

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
    return error instanceof Error ? error.message : String(error);
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
  return {
    project: parseProject(dbml),
    tables: parseTables(dbml),
    refs: parseRefs(dbml),
    enums: parseEnums(dbml),
    extras: parseExtras(dbml),
  };
}

export function modelToDbml(model: DbmlDocumentModel): string {
  const sections: string[] = [];

  if (model.project?.name) {
    const lines = [`Project ${quoteIdent(model.project.name)} {`];
    if (model.project.databaseType) lines.push(`  database_type: '${escapeSingle(model.project.databaseType)}'`);
    if (model.project.note) lines.push(`  Note: '${escapeSingle(model.project.note)}'`);
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
    if (table.note) lines.push(`  Note: '${escapeSingle(table.note)}'`);
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

function parseProject(dbml: string) {
  const match = /Project\s+([^{\s]+)\s*\{([\s\S]*?)\}/i.exec(dbml);
  if (!match) return undefined;
  const body = match[2];
  return {
    name: unquoteIdent(match[1]),
    databaseType: readStringSetting(body, 'database_type'),
    note: readStringSetting(body, 'Note'),
  };
}

function parseTables(dbml: string): DbmlTable[] {
  const tables: DbmlTable[] = [];
  const re = /Table\s+([^{\s]+)(?:\s+as\s+([^{\s\[]+))?\s*(\[[^\]]+\])?\s*\{([\s\S]*?)\}/gi;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = re.exec(dbml))) {
    const [schema, name] = splitQualified(match[1]);
    const body = match[4];
    const settings = match[3] ?? '';
    tables.push({
      id: tableId(schema, name),
      schema,
      name,
      alias: match[2] ? unquoteIdent(match[2]) : undefined,
      note: readStringSetting(body, 'Note'),
      headerColor: /headercolor\s*:\s*([#\w]+)/i.exec(settings)?.[1],
      columns: parseColumns(body),
      x: 80 + (index % 4) * 300,
      y: 80 + Math.floor(index / 4) * 260,
    });
    index += 1;
  }
  return tables;
}

function parseColumns(body: string): DbmlColumn[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('//') && !line.startsWith('Note:') && !line.startsWith('indexes') && !line.startsWith('}'))
    .filter((line) => !line.startsWith('~') && !line.includes('{'))
    .map((line) => {
      const match = /^("[^"]+"|[^\s]+)\s+([^\s\[]+)(?:\s*(\[[^\]]+\]))?/.exec(line);
      if (!match) return null;
      const name = unquoteIdent(match[1]);
      const type = match[2];
      const settings = parseSettings(match[3] ?? '');
      return { id: `${name}_${crypto.randomUUID()}`, name, type, settings };
    })
    .filter((column): column is DbmlColumn => Boolean(column));
}

function parseRefs(dbml: string): DbmlRef[] {
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

function parseEnums(dbml: string) {
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
  return content.split(',').map((part) => {
    const [key, ...rest] = part.trim().split(':');
    return { key: key.trim(), value: rest.join(':').trim() || undefined };
  });
}

function formatSettings(settings: ColumnSetting[]) {
  if (!settings.length) return '';
  const body = settings.map((setting) => (setting.value ? `${setting.key}: ${setting.value}` : setting.key)).join(', ');
  return ` [${body}]`;
}

function readStringSetting(body: string, key: string): string | undefined {
  const match = new RegExp(`${key}\\s*:\\s*'([^']*)'`, 'i').exec(body);
  return match?.[1];
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
