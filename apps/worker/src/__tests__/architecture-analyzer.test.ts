import { describe, it, expect } from 'vitest';
import { architectureAnalyzerService } from '../services/architecture-analyzer.js';

describe('ArchitectureAnalyzerService', () => {
  describe('analyzeFiles', () => {
    it('should analyze a simple TypeScript file', () => {
      const files = [
        {
          path: 'src/services/user-service.ts',
          content: `
import { prisma } from '@docsynth/database';
import { createLogger } from '../utils/logger.js';

export class UserService {
  async getUser(id: string) {
    return prisma.user.findUnique({ where: { id } });
  }
}

export function createUserService() {
  return new UserService();
}
`,
        },
      ];

      const result = architectureAnalyzerService.analyzeFiles(files);

      expect(result.modules).toHaveLength(1);
      expect(result.modules[0]?.name).toBe('user-service');
      expect(result.modules[0]?.type).toBe('service');
      expect(result.modules[0]?.exports).toContainEqual(
        expect.objectContaining({ name: 'UserService', kind: 'class' })
      );
      expect(result.modules[0]?.exports).toContainEqual(
        expect.objectContaining({ name: 'createUserService', kind: 'function' })
      );
    });

    it('should extract imports correctly', () => {
      const files = [
        {
          path: 'src/index.ts',
          content: `
import { Hono } from 'hono';
import type { Context } from 'hono';
import * as utils from './utils.js';
import defaultExport from 'some-package';
import { named1, named2 as alias } from '../lib/helpers.js';

export const app = new Hono();
`,
        },
      ];

      const result = architectureAnalyzerService.analyzeFiles(files);
      const imports = result.modules[0]?.imports ?? [];

      expect(imports).toContainEqual(
        expect.objectContaining({
          source: 'hono',
          isPackage: true,
          isRelative: false,
        })
      );
      expect(imports).toContainEqual(
        expect.objectContaining({
          source: './utils.js',
          isRelative: true,
        })
      );
      expect(imports).toContainEqual(
        expect.objectContaining({
          source: '../lib/helpers.js',
          isRelative: true,
        })
      );
    });

    it('should identify different module types', () => {
      const files = [
        { path: 'src/routes/users.ts', content: 'export const handler = () => {}' },
        { path: 'src/services/auth.ts', content: 'export class AuthService {}' },
        { path: 'src/utils/format.ts', content: 'export function format() {}' },
        { path: 'src/models/User.ts', content: 'export interface User {}' },
        { path: 'src/middleware/auth.ts', content: 'export const auth = () => {}' },
        { path: 'src/__tests__/auth.test.ts', content: 'describe("test", () => {})' },
        { path: 'config/app.config.ts', content: 'export const config = {}' },
      ];

      const result = architectureAnalyzerService.analyzeFiles(files);

      const getModuleType = (path: string) =>
        result.modules.find((m) => m.path === path)?.type;

      expect(getModuleType('src/routes/users.ts')).toBe('route');
      expect(getModuleType('src/services/auth.ts')).toBe('service');
      expect(getModuleType('src/utils/format.ts')).toBe('util');
      expect(getModuleType('src/models/User.ts')).toBe('model');
      expect(getModuleType('src/middleware/auth.ts')).toBe('middleware');
      expect(getModuleType('src/__tests__/auth.test.ts')).toBe('test');
      expect(getModuleType('config/app.config.ts')).toBe('config');
    });

    it('should build module relationships from imports', () => {
      const files = [
        {
          path: 'src/routes/api.ts',
          content: `
import { UserService } from '../services/user-service.js';
export const handler = () => {};
`,
        },
        {
          path: 'src/services/user-service.ts',
          content: `
import { formatUser } from '../utils/format.js';
export class UserService {}
`,
        },
        {
          path: 'src/utils/format.ts',
          content: `
export function formatUser() {}
`,
        },
      ];

      const result = architectureAnalyzerService.analyzeFiles(files);

      // Should have some modules
      expect(result.modules.length).toBe(3);
      
      // The api module should have imports from services
      const apiModule = result.modules.find(m => m.name === 'api');
      expect(apiModule?.imports.some(i => i.source.includes('user-service'))).toBe(true);
    });

    it('should identify architecture layers', () => {
      const files = [
        { path: 'src/routes/api.ts', content: 'export const api = () => {}' },
        { path: 'src/services/user.ts', content: 'export class UserService {}' },
        { path: 'src/models/User.ts', content: 'export interface User {}' },
        { path: 'src/utils/helpers.ts', content: 'export function help() {}' },
      ];

      const result = architectureAnalyzerService.analyzeFiles(files);

      expect(result.layers).toContainEqual(
        expect.objectContaining({ name: 'Presentation', level: 0 })
      );
      expect(result.layers).toContainEqual(
        expect.objectContaining({ name: 'Business Logic', level: 1 })
      );
      expect(result.layers).toContainEqual(
        expect.objectContaining({ name: 'Data', level: 2 })
      );
      expect(result.layers).toContainEqual(
        expect.objectContaining({ name: 'Infrastructure', level: 3 })
      );
    });

    it('should calculate summary statistics', () => {
      const files = [
        {
          path: 'src/index.ts',
          content: `
import { Hono } from 'hono';
import { service } from './services/main.js';

export const app = new Hono();
export function start() {}
export class Server {}
`,
        },
        {
          path: 'src/services/main.ts',
          content: `
export class MainService {}
export const instance = new MainService();
`,
        },
      ];

      const result = architectureAnalyzerService.analyzeFiles(files);

      expect(result.summary.totalModules).toBe(2);
      expect(result.summary.totalExports).toBeGreaterThanOrEqual(5);
      expect(result.summary.totalImports).toBeGreaterThanOrEqual(2);
      expect(result.summary.moduleTypes).toHaveProperty('service');
    });
  });

  describe('extractExports', () => {
    it('should extract different export types', () => {
      const files = [
        {
          path: 'src/exports.ts',
          content: `
export const CONSTANT = 'value';
export function myFunction() {}
export async function asyncFunction() {}
export class MyClass {}
export interface MyInterface {}
export type MyType = string;
export enum MyEnum { A, B }
export default class DefaultClass {}
export { helper } from './utils.js';
`,
        },
      ];

      const result = architectureAnalyzerService.analyzeFiles(files);
      const exports = result.modules[0]?.exports ?? [];

      expect(exports).toContainEqual(expect.objectContaining({ name: 'CONSTANT', kind: 'const' }));
      expect(exports).toContainEqual(expect.objectContaining({ name: 'myFunction', kind: 'function' }));
      expect(exports).toContainEqual(expect.objectContaining({ name: 'asyncFunction', kind: 'function', isAsync: true }));
      expect(exports).toContainEqual(expect.objectContaining({ name: 'MyClass', kind: 'class' }));
      expect(exports).toContainEqual(expect.objectContaining({ name: 'MyInterface', kind: 'interface' }));
      expect(exports).toContainEqual(expect.objectContaining({ name: 'MyType', kind: 'type' }));
      expect(exports).toContainEqual(expect.objectContaining({ name: 'MyEnum', kind: 'enum' }));
    });
  });

  describe('generateMermaidDiagram', () => {
    it('should generate valid Mermaid diagram syntax', () => {
      const files = [
        { path: 'src/routes/api.ts', content: 'export const api = () => {}' },
        { path: 'src/services/user.ts', content: 'export class UserService {}' },
      ];

      const graph = architectureAnalyzerService.analyzeFiles(files);
      const diagram = architectureAnalyzerService.generateMermaidDiagram(graph);

      expect(diagram).toContain('flowchart TD');
      expect(diagram).toContain('subgraph');
    });

    it('should sanitize module names for Mermaid IDs', () => {
      const files = [
        { path: 'src/my-special.service.ts', content: 'export class Service {}' },
      ];

      const graph = architectureAnalyzerService.analyzeFiles(files);
      const diagram = architectureAnalyzerService.generateMermaidDiagram(graph);

      // The ID should have special characters replaced with underscores
      expect(diagram).toContain('my_special_service');
    });
  });

  describe('generateDependencyDiagram', () => {
    it('should generate dependency diagram', () => {
      const files = [
        { path: 'src/routes/api.ts', content: 'export const api = () => {}' },
        { path: 'src/services/user.ts', content: 'export class UserService {}' },
        { path: 'src/utils/helpers.ts', content: 'export function help() {}' },
      ];

      const graph = architectureAnalyzerService.analyzeFiles(files);
      const diagram = architectureAnalyzerService.generateDependencyDiagram(graph);

      expect(diagram).toContain('flowchart LR');
      expect(diagram).toContain('subgraph');
    });
  });

  describe('generateComponentDiagram', () => {
    it('should generate component diagram with layers', () => {
      const files = [
        { path: 'src/routes/api.ts', content: 'export const api = () => {}' },
        { path: 'src/services/user.ts', content: 'export class UserService {}' },
        { path: 'src/utils/helpers.ts', content: 'export function help() {}' },
      ];

      const graph = architectureAnalyzerService.analyzeFiles(files);
      const diagram = architectureAnalyzerService.generateComponentDiagram(graph.modules);

      expect(diagram).toContain('graph TD');
      expect(diagram).toContain('API Layer');
      expect(diagram).toContain('Service Layer');
    });
  });
});
