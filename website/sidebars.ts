import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'introduction',
    {
      type: 'category',
      label: 'Getting Started',
      collapsed: false,
      items: [
        'getting-started/index',
        'getting-started/installation',
        'getting-started/quick-start',
        'getting-started/github-app-setup',
        'getting-started/demo-mode',
      ],
    },
    {
      type: 'category',
      label: 'Core Concepts',
      items: [
        'core-concepts/index',
        'core-concepts/how-it-works',
        'core-concepts/processing-pipeline',
        'core-concepts/multi-source-context',
        'core-concepts/style-learning',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        'guides/index',
        'guides/configuring-docsynth',
        'guides/using-the-cli',
        'guides/dashboard-overview',
        'guides/vscode-extension',
        'guides/integrations',
        'guides/mcp-server',
        'guides/github-action',
        'guides/self-hosting',
        'guides/examples',
      ],
    },
    {
      type: 'category',
      label: 'API Reference',
      items: [
        'api-reference/index',
        'api-reference/rest-api',
        'api-reference/webhooks',
        'api-reference/configuration-schema',
        'api-reference/sdk',
      ],
    },
    {
      type: 'category',
      label: 'Advanced',
      items: [
        'advanced/architecture',
        'advanced/knowledge-graphs',
        'advanced/drift-detection',
        'advanced/diagram-generation',
        'advanced/multi-language',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'reference/troubleshooting',
        'reference/faq',
        'reference/comparison',
        'reference/security',
        'reference/environment-variables',
        'reference/benchmarks',
        'reference/contributing',
        'reference/code-of-conduct',
        'reference/changelog',
      ],
    },
  ],
};

export default sidebars;
