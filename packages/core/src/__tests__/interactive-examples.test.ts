import { describe, it, expect } from 'vitest';
import {
  detectFramework,
  generateCodeSandboxUrl,
  generateStackBlitzUrl,
  generateEmbed,
  generateAllEmbeds,
} from '../sandbox-embedding.js';
import {
  createRng,
  generateUuid,
  generateUser,
  generateProduct,
  generateRelatedDataSet,
  formatDataSet,
} from '../test-data-generator.js';
import {
  generateShareUrl,
  generatePlatformShareUrls,
  generateOpenGraphMeta,
  generateTwitterCardMeta,
  generateEmbedSnippet,
  recordShareEvent,
  summarizeShareAnalytics,
} from '../example-sharing.js';

// ============================================================================
// Sandbox Embedding Tests
// ============================================================================

describe('sandbox-embedding', () => {
  const baseOptions = {
    code: 'import React from "react";\nexport default function App() { return <div>Hello</div>; }',
    framework: 'react' as const,
    title: 'Test Example',
  };

  describe('detectFramework', () => {
    it('should detect React from imports', () => {
      expect(detectFramework('import React from "react";')).toBe('react');
    });

    it('should detect Vue from imports', () => {
      expect(detectFramework('import { ref } from "vue";')).toBe('vue');
    });

    it('should detect Angular from imports', () => {
      expect(detectFramework('import { Component } from "@angular/core";')).toBe('angular');
    });

    it('should detect Next.js from imports', () => {
      expect(detectFramework('import Link from "next/link";')).toBe('nextjs');
    });

    it('should detect Svelte from imports', () => {
      expect(detectFramework('import { onMount } from "svelte";')).toBe('svelte');
    });

    it('should detect Node.js from patterns', () => {
      expect(detectFramework('const app = require("express");')).toBe('node');
    });

    it('should return null for unknown code', () => {
      expect(detectFramework('console.log("hello");')).toBeNull();
    });
  });

  describe('generateCodeSandboxUrl', () => {
    it('should generate a URL containing codesandbox.io', () => {
      const url = generateCodeSandboxUrl(baseOptions);
      expect(url).toContain('codesandbox.io');
    });

    it('should include the template parameter', () => {
      const url = generateCodeSandboxUrl(baseOptions);
      expect(url).toContain('template=new');
    });

    it('should include theme parameter', () => {
      const url = generateCodeSandboxUrl({ ...baseOptions, theme: 'light' });
      expect(url).toContain('theme=light');
    });
  });

  describe('generateStackBlitzUrl', () => {
    it('should generate a URL containing stackblitz.com', () => {
      const url = generateStackBlitzUrl(baseOptions);
      expect(url).toContain('stackblitz.com');
    });

    it('should include template parameter', () => {
      const url = generateStackBlitzUrl(baseOptions);
      expect(url).toContain('template=react-ts');
    });
  });

  describe('generateEmbed', () => {
    it('should return an iframe string for codesandbox', () => {
      const result = generateEmbed('codesandbox', baseOptions);
      expect(result.iframe).toContain('<iframe');
      expect(result.iframe).toContain('codesandbox.io');
      expect(result.provider).toBe('codesandbox');
      expect(result.framework).toBe('react');
    });

    it('should return an iframe string for stackblitz', () => {
      const result = generateEmbed('stackblitz', baseOptions);
      expect(result.iframe).toContain('<iframe');
      expect(result.iframe).toContain('stackblitz.com');
    });

    it('should use custom dimensions', () => {
      const result = generateEmbed('codesandbox', {
        ...baseOptions,
        width: '800px',
        height: '600px',
      });
      expect(result.iframe).toContain('width:800px');
      expect(result.iframe).toContain('height:600px');
    });
  });

  describe('generateAllEmbeds', () => {
    it('should return both codesandbox and stackblitz embeds', () => {
      const result = generateAllEmbeds(baseOptions);
      expect(result.codesandbox.provider).toBe('codesandbox');
      expect(result.stackblitz.provider).toBe('stackblitz');
    });
  });
});

// ============================================================================
// Test Data Generator Tests
// ============================================================================

describe('test-data-generator', () => {
  describe('createRng', () => {
    it('should produce deterministic output for the same seed', () => {
      const rng1 = createRng(42);
      const rng2 = createRng(42);
      expect(rng1()).toBe(rng2());
      expect(rng1()).toBe(rng2());
    });

    it('should produce different output for different seeds', () => {
      const rng1 = createRng(1);
      const rng2 = createRng(2);
      expect(rng1()).not.toBe(rng2());
    });
  });

  describe('generateUuid', () => {
    it('should generate a valid UUID-like string', () => {
      const rng = createRng(42);
      const uuid = generateUuid(rng);
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should be reproducible with same seed', () => {
      expect(generateUuid(createRng(99))).toBe(generateUuid(createRng(99)));
    });
  });

  describe('generateUser', () => {
    it('should generate a user with all fields', () => {
      const user = generateUser(createRng(42));
      expect(user.id).toBeDefined();
      expect(user.name).toBeDefined();
      expect(user.email).toContain('@');
      expect(user.phone).toMatch(/^\+1-/);
      expect(user.address.city).toBeDefined();
      expect(user.createdAt).toBeDefined();
    });
  });

  describe('generateProduct', () => {
    it('should generate a product with all fields', () => {
      const product = generateProduct(createRng(42));
      expect(product.id).toBeDefined();
      expect(product.name).toBeDefined();
      expect(product.price).toBeGreaterThanOrEqual(0);
      expect(product.category).toBeDefined();
      expect(product.url).toContain('https://');
    });
  });

  describe('generateRelatedDataSet', () => {
    it('should generate consistent related data', () => {
      const data = generateRelatedDataSet({ seed: 42, count: 3 });
      expect(data.users).toHaveLength(3);
      expect(data.products).toHaveLength(6);
      expect(data.orders.length).toBeGreaterThan(0);
      // Orders should reference existing users
      for (const order of data.orders) {
        expect(data.users.some((u) => u.id === order.userId)).toBe(true);
      }
    });

    it('should be reproducible with the same seed', () => {
      const data1 = generateRelatedDataSet({ seed: 42, count: 2 });
      const data2 = generateRelatedDataSet({ seed: 42, count: 2 });
      expect(data1.users[0]!.name).toBe(data2.users[0]!.name);
      expect(data1.products[0]!.name).toBe(data2.products[0]!.name);
    });
  });

  describe('formatDataSet', () => {
    const data = generateRelatedDataSet({ seed: 1, count: 2 });

    it('should format as JSON', () => {
      const json = formatDataSet(data, 'json');
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should format as TypeScript', () => {
      const ts = formatDataSet(data, 'typescript');
      expect(ts).toContain('export const users');
      expect(ts).toContain('export const products');
      expect(ts).toContain('export const orders');
    });

    it('should format as SQL', () => {
      const sql = formatDataSet(data, 'sql');
      expect(sql).toContain('INSERT INTO users');
      expect(sql).toContain('INSERT INTO products');
      expect(sql).toContain('INSERT INTO orders');
    });
  });
});

// ============================================================================
// Example Sharing Tests
// ============================================================================

describe('example-sharing', () => {
  const example = {
    id: 'test-example-123',
    title: 'React Counter',
    description: 'A simple counter component built with React hooks.',
    code: 'export default function Counter() { return <div>0</div>; }',
    language: 'typescript',
    author: '@johndoe',
    tags: ['react', 'hooks'],
  };

  describe('generateShareUrl', () => {
    it('should generate a URL containing the example id', () => {
      const url = generateShareUrl(example);
      expect(url).toContain('test-example-123');
      expect(url).toContain('docsynth.dev/examples');
    });
  });

  describe('generatePlatformShareUrls', () => {
    it('should generate URLs for all platforms', () => {
      const urls = generatePlatformShareUrls(example);
      expect(urls).toHaveLength(5);
      const platforms = urls.map((u) => u.platform);
      expect(platforms).toContain('twitter');
      expect(platforms).toContain('linkedin');
      expect(platforms).toContain('facebook');
      expect(platforms).toContain('reddit');
      expect(platforms).toContain('hackernews');
    });

    it('should encode the URL in share links', () => {
      const urls = generatePlatformShareUrls(example);
      for (const { url } of urls) {
        expect(url).toContain(encodeURIComponent('docsynth.dev'));
      }
    });
  });

  describe('generateOpenGraphMeta', () => {
    it('should generate valid OG meta tags', () => {
      const og = generateOpenGraphMeta(example);
      expect(og['og:title']).toBe('React Counter');
      expect(og['og:type']).toBe('article');
      expect(og['og:url']).toContain('test-example-123');
      expect(og['og:image']).toContain('.png');
      expect(og['og:site_name']).toBe('DocSynth');
    });
  });

  describe('generateTwitterCardMeta', () => {
    it('should generate Twitter card data', () => {
      const tc = generateTwitterCardMeta(example, '@docsynth');
      expect(tc['twitter:card']).toBe('summary_large_image');
      expect(tc['twitter:title']).toBe('React Counter');
      expect(tc['twitter:site']).toBe('@docsynth');
      expect(tc['twitter:creator']).toBe('@johndoe');
    });

    it('should omit site if not provided', () => {
      const tc = generateTwitterCardMeta(example);
      expect(tc['twitter:site']).toBeUndefined();
    });
  });

  describe('generateEmbedSnippet', () => {
    it('should generate HTML embed', () => {
      const embed = generateEmbedSnippet(example, 'html');
      expect(embed.format).toBe('html');
      expect(embed.code).toContain('<iframe');
    });

    it('should generate markdown embed', () => {
      const embed = generateEmbedSnippet(example, 'markdown');
      expect(embed.format).toBe('markdown');
      expect(embed.code).toContain('[![');
    });

    it('should generate React embed', () => {
      const embed = generateEmbedSnippet(example, 'react');
      expect(embed.format).toBe('react');
      expect(embed.code).toContain('DocSynthEmbed');
    });
  });

  describe('recordShareEvent / summarizeShareAnalytics', () => {
    it('should record new share events', () => {
      let entries = recordShareEvent([], 'ex-1', 'twitter');
      expect(entries).toHaveLength(1);
      expect(entries[0]!.count).toBe(1);

      entries = recordShareEvent(entries, 'ex-1', 'twitter');
      expect(entries).toHaveLength(1);
      expect(entries[0]!.count).toBe(2);
    });

    it('should summarize analytics correctly', () => {
      let entries = recordShareEvent([], 'ex-1', 'twitter');
      entries = recordShareEvent(entries, 'ex-1', 'twitter');
      entries = recordShareEvent(entries, 'ex-1', 'linkedin');
      entries = recordShareEvent(entries, 'ex-2', 'twitter');

      const summary = summarizeShareAnalytics(entries, 'ex-1');
      expect(summary.totalShares).toBe(3);
      expect(summary.byPlatform['twitter']).toBe(2);
      expect(summary.byPlatform['linkedin']).toBe(1);
    });
  });
});
