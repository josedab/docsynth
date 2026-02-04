import { describe, it, expect } from 'vitest';
import {
  parseApiSurface,
  detectBreakingChanges,
  analyzeDocumentationImpact,
} from '../../services/breaking-change.service.js';

describe('Breaking Change Detection Service', () => {
  describe('parseApiSurface', () => {
    it('should extract exported functions', () => {
      const code = `
export function greet(name: string): string {
  return 'Hello, ' + name;
}

export async function fetchData(id: number): Promise<Data> {
  return await api.get(id);
}
`;
      const surface = parseApiSurface(code, 'test.ts');

      expect(surface.functions).toHaveLength(2);

      const greet = surface.functions[0];
      expect(greet).toBeDefined();
      expect(greet?.name).toBe('greet');
      expect(greet?.params).toHaveLength(1);
      expect(greet?.params[0]?.name).toBe('name');
      expect(greet?.returnType).toBe('string');

      const fetchData = surface.functions[1];
      expect(fetchData).toBeDefined();
      expect(fetchData?.name).toBe('fetchData');
      expect(fetchData?.async).toBe(true);
    });

    it('should extract exported interfaces', () => {
      const code = `
export interface User {
  id: string;
  name: string;
  email?: string;
}

export interface Product extends BaseEntity {
  title: string;
  price: number;
}
`;
      const surface = parseApiSurface(code, 'types.ts');

      expect(surface.interfaces).toHaveLength(2);

      const user = surface.interfaces[0];
      expect(user).toBeDefined();
      expect(user?.name).toBe('User');
      expect(user?.properties).toHaveLength(3);
      expect(user?.properties[2]?.optional).toBe(true);

      const product = surface.interfaces[1];
      expect(product).toBeDefined();
      expect(product?.extends).toContain('BaseEntity');
    });

    it('should extract exported types', () => {
      const code = `
export type UserId = string;
export type Status = 'pending' | 'active' | 'inactive';
`;
      const surface = parseApiSurface(code, 'types.ts');

      expect(surface.types).toHaveLength(2);

      const userId = surface.types[0];
      expect(userId).toBeDefined();
      expect(userId?.name).toBe('UserId');

      const status = surface.types[1];
      expect(status).toBeDefined();
      expect(status?.name).toBe('Status');
    });
  });

  describe('detectBreakingChanges', () => {
    it('should detect removed functions', () => {
      const oldCode = `
export function greet(name: string): string {
  return 'Hello, ' + name;
}

export function goodbye(name: string): string {
  return 'Goodbye, ' + name;
}
`;
      const newCode = `
export function greet(name: string): string {
  return 'Hello, ' + name;
}
`;
      const oldSurface = parseApiSurface(oldCode, 'test.ts');
      const newSurface = parseApiSurface(newCode, 'test.ts');
      const changes = detectBreakingChanges(oldSurface, newSurface);

      expect(changes).toHaveLength(1);

      const change = changes[0];
      expect(change).toBeDefined();
      expect(change?.type).toBe('function_removed');
      expect(change?.name).toBe('goodbye');
      expect(change?.severity).toBe('critical');
    });

    it('should detect added required parameters', () => {
      const oldCode = `
export function greet(name: string): string {
  return 'Hello, ' + name;
}
`;
      const newCode = `
export function greet(name: string, title: string): string {
  return 'Hello, ' + title + ' ' + name;
}
`;
      const oldSurface = parseApiSurface(oldCode, 'test.ts');
      const newSurface = parseApiSurface(newCode, 'test.ts');
      const changes = detectBreakingChanges(oldSurface, newSurface);

      expect(changes).toHaveLength(1);

      const change = changes[0];
      expect(change).toBeDefined();
      expect(change?.type).toBe('parameter_added_required');
      expect(change?.name).toBe('greet.title');
    });

    it('should detect return type changes', () => {
      const oldCode = `
export function getData(): string {
  return 'data';
}
`;
      const newCode = `
export function getData(): number {
  return 42;
}
`;
      const oldSurface = parseApiSurface(oldCode, 'test.ts');
      const newSurface = parseApiSurface(newCode, 'test.ts');
      const changes = detectBreakingChanges(oldSurface, newSurface);

      expect(changes).toHaveLength(1);

      const change = changes[0];
      expect(change).toBeDefined();
      expect(change?.type).toBe('return_type_changed');
      expect(change?.previousValue).toBe('string');
      expect(change?.currentValue).toBe('number');
    });

    it('should detect removed interface properties', () => {
      const oldCode = `
export interface User {
  id: string;
  name: string;
  email: string;
}
`;
      const newCode = `
export interface User {
  id: string;
  name: string;
}
`;
      const oldSurface = parseApiSurface(oldCode, 'types.ts');
      const newSurface = parseApiSurface(newCode, 'types.ts');
      const changes = detectBreakingChanges(oldSurface, newSurface);

      expect(changes).toHaveLength(1);

      const change = changes[0];
      expect(change).toBeDefined();
      expect(change?.type).toBe('interface_property_removed');
      expect(change?.name).toBe('User.email');
    });

    it('should detect property made required', () => {
      const oldCode = `
export interface User {
  id: string;
  email?: string;
}
`;
      const newCode = `
export interface User {
  id: string;
  email: string;
}
`;
      const oldSurface = parseApiSurface(oldCode, 'types.ts');
      const newSurface = parseApiSurface(newCode, 'types.ts');
      const changes = detectBreakingChanges(oldSurface, newSurface);

      expect(changes).toHaveLength(1);

      const change = changes[0];
      expect(change).toBeDefined();
      expect(change?.type).toBe('interface_property_required');
      expect(change?.name).toBe('User.email');
    });

    it('should not flag non-breaking changes', () => {
      const oldCode = `
export function greet(name: string): string {
  return 'Hello, ' + name;
}
`;
      const newCode = `
export function greet(name: string, title?: string): string {
  return 'Hello, ' + (title ? title + ' ' : '') + name;
}
`;
      const oldSurface = parseApiSurface(oldCode, 'test.ts');
      const newSurface = parseApiSurface(newCode, 'test.ts');
      const changes = detectBreakingChanges(oldSurface, newSurface);

      // Adding optional parameter is not breaking
      expect(changes).toHaveLength(0);
    });
  });

  describe('analyzeDocumentationImpact', () => {
    it('should find affected documentation', async () => {
      const changes = [
        {
          type: 'function_removed' as const,
          name: 'createUser',
          description: 'Function removed',
          filePath: 'user.ts',
          lineNumber: 10,
          severity: 'critical' as const,
        },
      ];

      const docs = [
        {
          path: 'docs/api.md',
          content: 'The createUser function is used to create new users.',
          type: 'API_REFERENCE',
        },
        {
          path: 'docs/readme.md',
          content: 'This is the project readme.',
          type: 'README',
        },
      ];

      const affected = await analyzeDocumentationImpact(changes, docs);

      expect(affected).toContain('docs/api.md');
      expect(affected).not.toContain('docs/readme.md');
    });
  });
});
