export type Role = 'readonly' | 'editor';

export type ColumnSetting = {
  key: string;
  value?: string;
};

export type DbmlColumn = {
  id: string;
  name: string;
  type: string;
  settings: ColumnSetting[];
  note?: string;
};

export type DbmlTable = {
  id: string;
  schema?: string;
  name: string;
  alias?: string;
  note?: string;
  headerColor?: string;
  columns: DbmlColumn[];
  x: number;
  y: number;
};

export type DbmlRef = {
  id: string;
  fromTable: string;
  fromColumn: string;
  relation: '<' | '>' | '-' | '<>';
  toTable: string;
  toColumn: string;
};

export type DbmlEnum = {
  id: string;
  schema?: string;
  name: string;
  values: string[];
};

export type DbmlProject = {
  name?: string;
  databaseType?: string;
  note?: string;
};

export type DbmlDocumentModel = {
  project?: DbmlProject;
  tables: DbmlTable[];
  refs: DbmlRef[];
  enums: DbmlEnum[];
  extras: string[];
};

export type SavedDocument = {
  id: string;
  name: string;
  dbml: string;
  layoutJson: unknown;
  version: number;
  createdAt: string;
  updatedAt: string;
};
