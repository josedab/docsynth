import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'DocSynth',
  tagline: 'AI-powered documentation that stays current with your code',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://docsynth.dev',
  baseUrl: '/',

  organizationName: 'docsynth',
  projectName: 'docsynth',

  onBrokenLinks: 'throw',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        language: ['en'],
        highlightSearchTermsOnTargetPage: true,
        explicitSearchResultPath: true,
      },
    ],
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/docsynth/docsynth/tree/main/website/',
          showLastUpdateAuthor: true,
          showLastUpdateTime: true,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/docsynth-social-card.svg',
    metadata: [
      { name: 'keywords', content: 'documentation, AI, automation, developer tools, GitHub' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    announcementBar: {
      id: 'beta',
      content:
        '🚀 DocSynth is in beta! <a href="/docs/getting-started">Get started</a> or <a href="https://github.com/docsynth/docsynth">star us on GitHub</a>',
      backgroundColor: '#5865F2',
      textColor: '#fff',
      isCloseable: true,
    },
    navbar: {
      title: 'DocSynth',
      logo: {
        alt: 'DocSynth Logo',
        src: 'img/logo.svg',
        srcDark: 'img/logo-dark.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          to: '/docs/api-reference',
          label: 'API',
          position: 'left',
        },
        {
          href: 'https://github.com/docsynth/docsynth',
          position: 'right',
          className: 'header-github-link',
          'aria-label': 'GitHub repository',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Learn',
          items: [
            { label: 'Getting Started', to: '/docs/getting-started' },
            { label: 'Core Concepts', to: '/docs/core-concepts' },
            { label: 'Guides', to: '/docs/guides' },
            { label: 'API Reference', to: '/docs/api-reference' },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub Discussions',
              href: 'https://github.com/docsynth/docsynth/discussions',
            },
            { label: 'Discord', href: 'https://discord.gg/docsynth' },
            { label: 'X / Twitter', href: 'https://x.com/docsynthdev' },
          ],
        },
        {
          title: 'More',
          items: [{ label: 'GitHub', href: 'https://github.com/docsynth/docsynth' }],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} DocSynth. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'typescript', 'yaml'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
