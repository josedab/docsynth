import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WIDGET_CONFIG,
  validateWidgetConfig,
  generateEmbedSnippet,
  generateReactWrapper,
} from '../index.js';

describe('Widget Package', () => {
  describe('DEFAULT_WIDGET_CONFIG', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_WIDGET_CONFIG.theme).toBe('auto');
      expect(DEFAULT_WIDGET_CONFIG.position).toBe('bottom-right');
      expect(DEFAULT_WIDGET_CONFIG.primaryColor).toBe('#6366f1');
      expect(DEFAULT_WIDGET_CONFIG.zIndex).toBe(9999);
      expect(DEFAULT_WIDGET_CONFIG.features.search).toBe(true);
      expect(DEFAULT_WIDGET_CONFIG.features.chat).toBe(true);
    });
  });

  describe('validateWidgetConfig', () => {
    it('should accept a valid partial config', () => {
      const result = validateWidgetConfig({ apiKey: 'test-key', theme: 'dark' });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept an empty config', () => {
      const result = validateWidgetConfig({});
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid theme', () => {
      const result = validateWidgetConfig({ theme: 'neon' as any });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('theme must be one of: light, dark, auto');
    });

    it('should reject invalid position', () => {
      const result = validateWidgetConfig({ position: 'center' as any });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'position must be one of: bottom-right, bottom-left, top-right, top-left'
      );
    });

    it('should reject invalid primaryColor', () => {
      const result = validateWidgetConfig({ primaryColor: 'red' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('primaryColor must be a valid hex color (e.g. #6366f1)');
    });

    it('should reject negative zIndex', () => {
      const result = validateWidgetConfig({ zIndex: -1 });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('zIndex must be a non-negative number');
    });

    it('should collect multiple errors', () => {
      const result = validateWidgetConfig({
        theme: 'neon' as any,
        primaryColor: 'bad',
        zIndex: -5,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(3);
    });
  });

  describe('generateEmbedSnippet', () => {
    it('should produce a script tag with config', () => {
      const snippet = generateEmbedSnippet({ apiKey: 'key-123' });
      expect(snippet).toContain('<script');
      expect(snippet).toContain('DocSynthWidget.init(');
      expect(snippet).toContain('key-123');
    });

    it('should use the provided apiUrl for the script src', () => {
      const snippet = generateEmbedSnippet({ apiUrl: 'https://custom.api' });
      expect(snippet).toContain('src="https://custom.api/widget.js"');
    });

    it('should merge with defaults', () => {
      const snippet = generateEmbedSnippet({ theme: 'dark' });
      expect(snippet).toContain('"theme": "dark"');
      expect(snippet).toContain('"position": "bottom-right"');
    });
  });

  describe('generateReactWrapper', () => {
    it('should produce a React component', () => {
      const code = generateReactWrapper({ apiKey: 'key-456' });
      expect(code).toContain("import { useEffect } from 'react'");
      expect(code).toContain('export function DocSynthWidget');
      expect(code).toContain('key-456');
    });

    it('should include cleanup logic', () => {
      const code = generateReactWrapper({});
      expect(code).toContain('removeChild');
    });
  });
});
