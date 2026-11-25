/// <reference types="vite/client" />

declare namespace NodeJS {
  interface ProcessEnv {
    [key: string]: string | undefined;
    DISABLE_HMR?: string;
    PORT?: string;
    NODE_ENV?: string;
    SNS_ALERTS_TOPIC_ARN?: string;
    S3_DOCUMENTS_BUCKET?: string;
    CLOUDWATCH_LOG_GROUP?: string;
  }
}

declare const process: {
  env: NodeJS.ProcessEnv;
};

// Ambient declarations for external modules prior to local node_modules install
declare module 'express' {
  interface Request {
    [key: string]: any;
  }
  interface Response {
    [key: string]: any;
  }
  interface NextFunction {
    (): void;
  }
  interface Application {
    use(...args: any[]): any;
    get(...args: any[]): any;
    post(...args: any[]): any;
    patch(...args: any[]): any;
    delete(...args: any[]): any;
    listen(...args: any[]): any;
  }
  function express(): Application;
  namespace express {
    export function json(options?: any): any;
    export function static(root: string, options?: any): any;
  }
  export default express;
}

declare module 'dotenv' {
  export function config(options?: any): any;
  const dotenv: { config: typeof config };
  export default dotenv;
}

declare module 'vite' {
  export function defineConfig(config: any): any;
  export function createServer(options?: any): Promise<any>;
}

declare module '@tailwindcss/vite' {
  const plugin: () => any;
  export default plugin;
}

declare module '@vitejs/plugin-react' {
  const plugin: (options?: any) => any;
  export default plugin;
}

declare module 'fs' {
  export function existsSync(path: string): boolean;
  export function cpSync(src: string, dest: string, opts?: any): void;
  export function mkdirSync(path: string, opts?: any): void;
  export function readFileSync(path: string, encoding: string): string;
  export function writeFileSync(path: string, data: string, encoding: string): void;
  const fs: {
    existsSync: typeof existsSync;
    cpSync: typeof cpSync;
    mkdirSync: typeof mkdirSync;
    readFileSync: typeof readFileSync;
    writeFileSync: typeof writeFileSync;
  };
  export default fs;
}

declare module 'node:fs' {
  export * from 'fs';
  import fs from 'fs';
  export default fs;
}

declare module 'path' {
  export function resolve(...paths: string[]): string;
  export function dirname(p: string): string;
  export function join(...paths: string[]): string;
  const path: {
    resolve: typeof resolve;
    dirname: typeof dirname;
    join: typeof join;
  };
  export default path;
}

declare module 'node:path' {
  export * from 'path';
  import path from 'path';
  export default path;
}

declare module 'url' {
  export function fileURLToPath(url: string | URL): string;
  const url: {
    fileURLToPath: typeof fileURLToPath;
  };
  export default url;
}

declare module 'node:url' {
  export * from 'url';
  import url from 'url';
  export default url;
}

declare module 'lucide-react' {
  import React from 'react';
  export const ArrowLeftRight: React.ComponentType<any>;
  export const BarChart3: React.ComponentType<any>;
  export const Bell: React.ComponentType<any>;
  export const Calendar: React.ComponentType<any>;
  export const History: React.ComponentType<any>;
  export const LayoutDashboard: React.ComponentType<any>;
  export const Menu: React.ComponentType<any>;
  export const Package: React.ComponentType<any>;
  export const RefreshCw: React.ComponentType<any>;
  export const ShieldPlus: React.ComponentType<any>;
  export const ShoppingCart: React.ComponentType<any>;
  export const X: React.ComponentType<any>;
  export const AlertTriangle: React.ComponentType<any>;
  export const ArrowRight: React.ComponentType<any>;
  export const CheckCircle2: React.ComponentType<any>;
  export const Clock: React.ComponentType<any>;
  export const MapPin: React.ComponentType<any>;
  export const Plus: React.ComponentType<any>;
  export const Search: React.ComponentType<any>;
  export const SlidersHorizontal: React.ComponentType<any>;
  export const FileText: React.ComponentType<any>;
  export const Upload: React.ComponentType<any>;
  export const ArrowDownLeft: React.ComponentType<any>;
  export const ArrowUpRight: React.ComponentType<any>;
  export const Trash2: React.ComponentType<any>;
  export const ChevronLeft: React.ComponentType<any>;
  export const ChevronRight: React.ComponentType<any>;
  export const PackageCheck: React.ComponentType<any>;
  export const Truck: React.ComponentType<any>;
  export const Check: React.ComponentType<any>;
  export const Download: React.ComponentType<any>;
  const icons: Record<string, React.ComponentType<any>>;
  export default icons;
}
