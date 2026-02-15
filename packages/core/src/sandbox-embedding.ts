// ============================================================================
// Types
// ============================================================================

export type SandboxFramework = 'react' | 'vue' | 'angular' | 'node' | 'nextjs' | 'svelte';

export type SandboxProvider = 'codesandbox' | 'stackblitz';

export interface SandboxEmbedOptions {
  code: string;
  framework: SandboxFramework;
  title?: string;
  width?: string;
  height?: string;
  theme?: 'light' | 'dark';
  hideNavigation?: boolean;
  autoResize?: boolean;
}

export interface SandboxEmbedResult {
  url: string;
  iframe: string;
  provider: SandboxProvider;
  framework: SandboxFramework;
}

// ============================================================================
// Constants
// ============================================================================

const CODESANDBOX_BASE = 'https://codesandbox.io/api/v1/sandboxes/define';
const STACKBLITZ_BASE = 'https://stackblitz.com/run';

const FRAMEWORK_TEMPLATES: Record<SandboxFramework, { codesandbox: string; stackblitz: string }> = {
  react: { codesandbox: 'new', stackblitz: 'react-ts' },
  vue: { codesandbox: 'vue3', stackblitz: 'vue' },
  angular: { codesandbox: 'angular', stackblitz: 'angular-cli' },
  node: { codesandbox: 'node', stackblitz: 'node' },
  nextjs: { codesandbox: 'nextjs', stackblitz: 'nextjs' },
  svelte: { codesandbox: 'svelte', stackblitz: 'svelte' },
};

const FRAMEWORK_ENTRY_FILES: Record<SandboxFramework, string> = {
  react: 'src/App.tsx',
  vue: 'src/App.vue',
  angular: 'src/app/app.component.ts',
  node: 'src/index.ts',
  nextjs: 'pages/index.tsx',
  svelte: 'src/App.svelte',
};

const FRAMEWORK_PATTERNS: Array<{ pattern: RegExp; framework: SandboxFramework }> = [
  { pattern: /import\s+.*from\s+['"]react['"]/, framework: 'react' },
  { pattern: /import\s+.*from\s+['"]next[/"']/, framework: 'nextjs' },
  { pattern: /import\s+.*from\s+['"]vue['"]/, framework: 'vue' },
  { pattern: /import\s+.*from\s+['"]@angular\//, framework: 'angular' },
  { pattern: /import\s+.*from\s+['"]svelte['"]/, framework: 'svelte' },
  { pattern: /<script\s+lang=['"]ts['"]>/, framework: 'svelte' },
  { pattern: /require\s*\(\s*['"]express['"]/, framework: 'node' },
  { pattern: /import\s+.*from\s+['"]express['"]/, framework: 'node' },
  { pattern: /process\.env|__dirname|__filename/, framework: 'node' },
];

// ============================================================================
// Public Functions
// ============================================================================

/** Detect framework from code content by matching import patterns. */
export function detectFramework(code: string): SandboxFramework | null {
  for (const { pattern, framework } of FRAMEWORK_PATTERNS) {
    if (pattern.test(code)) {
      return framework;
    }
  }
  return null;
}

/** Encode sandbox files payload for CodeSandbox API. */
export function encodeCodeSandboxPayload(
  code: string,
  framework: SandboxFramework,
  title?: string
): string {
  const entryFile = FRAMEWORK_ENTRY_FILES[framework];
  const files: Record<string, { content: string }> = {
    [entryFile]: { content: code },
    'package.json': {
      content: JSON.stringify({
        name: title ?? 'docsynth-example',
        main: entryFile,
        dependencies: getFrameworkDependencies(framework),
      }),
    },
  };
  return base64UrlEncode(JSON.stringify({ files }));
}

/** Generate a CodeSandbox embed URL for a code snippet. */
export function generateCodeSandboxUrl(options: SandboxEmbedOptions): string {
  const template = FRAMEWORK_TEMPLATES[options.framework].codesandbox;
  const payload = encodeCodeSandboxPayload(options.code, options.framework, options.title);
  const theme = options.theme ?? 'dark';
  const hideNav = options.hideNavigation ? 1 : 0;
  return `${CODESANDBOX_BASE}?json=1&parameters=${payload}&query=module=${encodeURIComponent(FRAMEWORK_ENTRY_FILES[options.framework])}&template=${template}&theme=${theme}&hidenavigation=${hideNav}`;
}

/** Generate a StackBlitz embed URL for a code snippet. */
export function generateStackBlitzUrl(options: SandboxEmbedOptions): string {
  const template = FRAMEWORK_TEMPLATES[options.framework].stackblitz;
  const entryFile = FRAMEWORK_ENTRY_FILES[options.framework];
  const theme = options.theme ?? 'dark';
  const hideNav = options.hideNavigation ? 1 : 0;
  return `${STACKBLITZ_BASE}?template=${template}&file=${encodeURIComponent(entryFile)}&title=${encodeURIComponent(options.title ?? 'DocSynth Example')}&theme=${theme}&hideNavigation=${hideNav}`;
}

/** Generate an HTML iframe embed for the given provider. */
export function generateEmbed(
  provider: SandboxProvider,
  options: SandboxEmbedOptions
): SandboxEmbedResult {
  const url =
    provider === 'codesandbox' ? generateCodeSandboxUrl(options) : generateStackBlitzUrl(options);

  const width = options.width ?? '100%';
  const height = options.height ?? '500px';
  const title = options.title ?? 'DocSynth Example';

  const iframe = `<iframe src="${url}" style="width:${width};height:${height};border:0;border-radius:4px;overflow:hidden;" title="${escapeHtml(title)}" allow="accelerometer; ambient-light-sensor; camera; encrypted-media; geolocation; gyroscope; hid; microphone; midi; payment; usb; vr; xr-spatial-tracking" sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts"></iframe>`;

  return { url, iframe, provider, framework: options.framework };
}

/** Generate embeds for both providers at once. */
export function generateAllEmbeds(options: SandboxEmbedOptions): {
  codesandbox: SandboxEmbedResult;
  stackblitz: SandboxEmbedResult;
} {
  return {
    codesandbox: generateEmbed('codesandbox', options),
    stackblitz: generateEmbed('stackblitz', options),
  };
}

// ============================================================================
// Internal Helpers
// ============================================================================

function getFrameworkDependencies(framework: SandboxFramework): Record<string, string> {
  const deps: Record<SandboxFramework, Record<string, string>> = {
    react: { react: '^18.2.0', 'react-dom': '^18.2.0', typescript: '^5.0.0' },
    vue: { vue: '^3.3.0', typescript: '^5.0.0' },
    angular: { '@angular/core': '^17.0.0', '@angular/common': '^17.0.0', typescript: '^5.0.0' },
    node: { typescript: '^5.0.0', '@types/node': '^20.0.0' },
    nextjs: { next: '^14.0.0', react: '^18.2.0', 'react-dom': '^18.2.0', typescript: '^5.0.0' },
    svelte: { svelte: '^4.0.0', typescript: '^5.0.0' },
  };
  return deps[framework];
}

function base64UrlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
