// Khai báo kiểu cho giá trị globalSetup cung cấp qua `project.provide` / `inject`.
declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

export {};
