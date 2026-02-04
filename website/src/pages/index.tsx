import type { ReactNode } from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import CodeBlock from '@theme/CodeBlock';

import styles from './index.module.css';

const features = [
  {
    emoji: '🤖',
    title: 'AI-Powered Generation',
    description: 'Uses advanced LLMs to generate documentation from code changes automatically.',
  },
  {
    emoji: '🔄',
    title: 'Always Current',
    description: 'Documentation updates automatically when code changes. No more stale docs.',
  },
  {
    emoji: '🔗',
    title: 'Multi-Source Context',
    description: 'Gathers context from PRs, Jira, Slack to understand not just what changed, but why.',
  },
  {
    emoji: '✍️',
    title: 'Human Quality',
    description: 'Produces documentation that reads naturally, matching your team\'s voice.',
  },
  {
    emoji: '🎨',
    title: 'Style Learning',
    description: 'Learns from your existing docs to maintain consistent tone and formatting.',
  },
  {
    emoji: '🔍',
    title: 'Drift Detection',
    description: 'Automatically detects when documentation falls out of sync with code.',
  },
];

const usedByCompanies = [
  'Acme Corp',
  'TechStart',
  'DevTools Inc',
  'CloudScale',
  'DataFlow',
];

function Feature({ emoji, title, description }: { emoji: string; title: string; description: string }) {
  return (
    <div className={clsx('col col--4')}>
      <div className={styles.featureCard}>
        <div className={styles.featureEmoji}>{emoji}</div>
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx('hero', styles.heroBanner)}>
      <div className="container">
        <div className={styles.badges}>
          <img src="https://img.shields.io/badge/version-0.1.0-blue" alt="Version" />
          <img src="https://img.shields.io/badge/build-passing-brightgreen" alt="Build Status" />
          <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
          <img src="https://img.shields.io/badge/TypeScript-5.3-blue" alt="TypeScript" />
        </div>
        <Heading as="h1" className={styles.heroTitle}>
          {siteConfig.title}
        </Heading>
        <p className={styles.heroSubtitle}>{siteConfig.tagline}</p>
        <div className={styles.installCommand}>
          <CodeBlock language="bash">npm install -g @docsynth/cli</CodeBlock>
        </div>
        <div className={styles.buttons}>
          <Link className="button button--primary button--lg" to="/docs/getting-started">
            Get Started →
          </Link>
          <Link
            className="button button--secondary button--lg"
            to="https://github.com/docsynth/docsynth"
          >
            GitHub
          </Link>
          <Link
            className="button button--outline button--lg"
            to="https://discord.gg/docsynth"
          >
            Discord
          </Link>
        </div>
      </div>
    </header>
  );
}

function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {features.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks(): ReactNode {
  return (
    <section className={styles.howItWorks}>
      <div className="container">
        <Heading as="h2" className="text--center margin-bottom--lg">
          How It Works
        </Heading>
        <div className={styles.pipeline}>
          <div className={styles.pipelineStep}>
            <span className={styles.stepNumber}>1</span>
            <strong>PR Merged</strong>
            <p>Your team merges a pull request</p>
          </div>
          <div className={styles.pipelineArrow}>→</div>
          <div className={styles.pipelineStep}>
            <span className={styles.stepNumber}>2</span>
            <strong>Analysis</strong>
            <p>DocSynth analyzes the changes</p>
          </div>
          <div className={styles.pipelineArrow}>→</div>
          <div className={styles.pipelineStep}>
            <span className={styles.stepNumber}>3</span>
            <strong>Context</strong>
            <p>Gathers context from PR, tickets, chat</p>
          </div>
          <div className={styles.pipelineArrow}>→</div>
          <div className={styles.pipelineStep}>
            <span className={styles.stepNumber}>4</span>
            <strong>Generation</strong>
            <p>AI generates updated documentation</p>
          </div>
          <div className={styles.pipelineArrow}>→</div>
          <div className={styles.pipelineStep}>
            <span className={styles.stepNumber}>5</span>
            <strong>Review</strong>
            <p>PR created for team review</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function UsedBy(): ReactNode {
  return (
    <section className={styles.usedBy}>
      <div className="container">
        <p className={styles.usedByTitle}>Trusted by engineering teams at</p>
        <div className={styles.usedByLogos}>
          {usedByCompanies.map((company) => (
            <span key={company}>{company}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

const demoConfigCode = `// .docsynth.json
{
  "version": 1,
  "triggers": {
    "onPRMerge": true,
    "branches": ["main"]
  },
  "docTypes": {
    "readme": true,
    "apiDocs": true,
    "changelog": true
  },
  "style": {
    "tone": "technical",
    "includeExamples": true
  }
}`;

function DemoSection(): ReactNode {
  return (
    <section className={styles.demoSection}>
      <div className="container">
        <div className={styles.demoContainer}>
          <div className={styles.demoText}>
            <Heading as="h2">Configure Once, Document Forever</Heading>
            <p>
              Add a simple config file to your repository. DocSynth handles the rest—analyzing 
              code changes, gathering context, and generating documentation automatically.
            </p>
            <Link className="button button--primary" to="/docs/guides/configuring-docsynth">
              View Configuration Guide →
            </Link>
          </div>
          <div className={styles.demoCode}>
            <CodeBlock language="json">{demoConfigCode}</CodeBlock>
          </div>
        </div>
      </div>
    </section>
  );
}

function CTASection(): ReactNode {
  return (
    <section className={styles.ctaSection}>
      <div className="container">
        <Heading as="h2">Ready to Automate Your Documentation?</Heading>
        <p>
          Join thousands of developers who never worry about outdated docs again.
        </p>
        <div className={styles.buttons}>
          <Link className="button button--primary button--lg" to="/docs/getting-started">
            Get Started Free →
          </Link>
          <Link className="button button--secondary button--lg" to="/docs/reference/comparison">
            Compare Alternatives
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title="AI-Powered Documentation"
      description="DocSynth automatically generates and maintains documentation by observing code changes, understanding context from PRs and tickets, and producing human-quality technical writing."
    >
      <HomepageHeader />
      <main>
        <UsedBy />
        <HomepageFeatures />
        <HowItWorks />
        <DemoSection />
        <CTASection />
      </main>
    </Layout>
  );
}
