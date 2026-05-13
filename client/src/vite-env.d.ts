/// <reference types="vite/client" />

declare module '@dbml/core' {
  export const importer: {
    import(
      input: string,
      format: 'dbml' | 'mysql' | 'mysqlLegacy' | 'postgres' | 'postgresLegacy' | 'json' | 'mssql' | 'mssqlLegacy' | 'snowflake' | 'schemarb',
    ): string;
    generateDbml(schemaJson: unknown): string;
  };

  export const exporter: {
    export(input: string, format: 'mysql' | 'postgres' | 'oracle' | 'dbml' | 'mssql' | 'json', options?: unknown): string;
  };

  export class Parser {
    parse(
      input: string,
      format: 'dbml' | 'dbmlv2' | 'mysql' | 'mysqlLegacy' | 'postgres' | 'postgresLegacy' | 'mssql' | 'mssqlLegacy' | 'snowflake' | 'schemarb' | 'json',
    ): unknown;
  }
}
