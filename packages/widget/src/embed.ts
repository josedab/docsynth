// ============================================================================
// Embed Snippet Generator
// ============================================================================

import { DEFAULT_WIDGET_CONFIG, type WidgetConfig } from './widget-config.js';

/**
 * Validate a partial widget configuration.
 */
export function validateWidgetConfig(config: Partial<WidgetConfig>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (config.apiKey !== undefined && typeof config.apiKey !== 'string') {
    errors.push('apiKey must be a string');
  }

  if (config.apiUrl !== undefined && typeof config.apiUrl !== 'string') {
    errors.push('apiUrl must be a string');
  }

  if (config.theme !== undefined && !['light', 'dark', 'auto'].includes(config.theme)) {
    errors.push('theme must be one of: light, dark, auto');
  }

  if (
    config.position !== undefined &&
    !['bottom-right', 'bottom-left', 'top-right', 'top-left'].includes(config.position)
  ) {
    errors.push('position must be one of: bottom-right, bottom-left, top-right, top-left');
  }

  if (config.primaryColor !== undefined && !/^#[0-9a-fA-F]{6}$/.test(config.primaryColor)) {
    errors.push('primaryColor must be a valid hex color (e.g. #6366f1)');
  }

  if (config.zIndex !== undefined && (typeof config.zIndex !== 'number' || config.zIndex < 0)) {
    errors.push('zIndex must be a non-negative number');
  }

  if (config.maxHeight !== undefined && typeof config.maxHeight !== 'string') {
    errors.push('maxHeight must be a string (e.g. "600px")');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Generate an HTML embed snippet for the widget.
 */
export function generateEmbedSnippet(config: Partial<WidgetConfig>): string {
  const merged = { ...DEFAULT_WIDGET_CONFIG, ...config };
  const configJson = JSON.stringify(merged, null, 2);

  return `<script src="${merged.apiUrl}/widget.js"></script>
<script>
  DocSynthWidget.init(${configJson});
</script>`;
}

/**
 * Generate a React wrapper component for the widget.
 */
export function generateReactWrapper(config: Partial<WidgetConfig>): string {
  const merged = { ...DEFAULT_WIDGET_CONFIG, ...config };
  const configJson = JSON.stringify(merged, null, 2);

  return `import { useEffect } from 'react';

export function DocSynthWidget() {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = '${merged.apiUrl}/widget.js';
    script.async = true;
    script.onload = () => {
      (window as any).DocSynthWidget.init(${configJson});
    };
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
  }, []);

  return null;
}`;
}
