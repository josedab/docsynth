import type { ReactNode } from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import CodeBlock from '@theme/CodeBlock';
import HomepageFeatures from '@site/src/components/HomepageFeatures';

import styles from './index.module.css';

const communityStats = [
  { label: 'Open Source', value: 'MIT License' },
  { label: 'Apps', value: '6' },
  { label: 'Packages', value: '10' },
  { label: 'Job Types', value: '61' },
  { label: 'API Endpoints', value: '40+' },
];

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx('hero', styles.heroBanner)}>
      <div className="container">
        <div className={styles.badges}>
          <a href="https://github.com/docsynth/docsynth/actions/workflows/ci.yml">
            <img
              src="https://github.com/docsynth/docsynth/actions/workflows/ci.yml/badge.svg"
              alt="CI"
            />
          </a>
          <a href="https://github.com/docsynth/docsynth">
            <img
              src="https://img.shields.io/github/stars/docsynth/docsynth?style=flat"
              alt="GitHub Stars"
            />
          </a>
          <a href="https://github.com/docsynth/docsynth/blob/main/LICENSE">
            <img src="https://img.shields.io/github/license/docsynth/docsynth" alt="License" />
          </a>
          <img src="https://img.shields.io/badge/node-20%2B-brightgreen" alt="Node.js 20+" />
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
          <Link className="button button--outline button--lg" to="https://discord.gg/docsynth">
            Discord
          </Link>
        </div>
      </div>
    </header>
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

function CommunityStats(): ReactNode {
  return (
    <section className={styles.usedBy}>
      <div className="container">
        <p className={styles.usedByTitle}>
          Built in the open — community-driven documentation automation
        </p>
        <div className={styles.usedByLogos}>
          {communityStats.map((stat) => (
            <div key={stat.label} className={styles.statItem}>
              <span className={styles.statValue}>{stat.value}</span>
              <span className={styles.statLabel}>{stat.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const demoConfigCode = `// .docsynth.json — drop this in your repo
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

const demoOutputCode = `PR #42 merged → DocSynth processing...

✔ Change Analysis — 12 files, 3 new exports
✔ Intent Inference — Context from PR + JIRA-123
✔ Doc Generation — 2 docs updated, 1 created
✔ Quality Review — Score: 94/100

→ PR #43 opened: "docs: Add authentication guide"
  • docs/api/authentication.md (new)
  • docs/api/users.md (updated)
  • CHANGELOG.md (entry added)`;

function DemoSection(): ReactNode {
  return (
    <section className={styles.demoSection}>
      <div className="container">
        <div className={styles.demoContainer}>
          <div className={styles.demoText}>
            <Heading as="h2">Configure Once, Document Forever</Heading>
            <p>
              Add a simple config file to your repository. DocSynth handles the rest—analyzing code
              changes, gathering context, and generating documentation automatically.
            </p>
            <div className={styles.demoCode}>
              <CodeBlock language="json" title=".docsynth.json">
                {demoConfigCode}
              </CodeBlock>
            </div>
          </div>
          <div className={styles.demoText}>
            <Heading as="h2">See It in Action</Heading>
            <p>
              Merge a PR and DocSynth takes over. It analyzes changes, gathers context from your PR
              and linked tickets, generates docs, and opens a review PR—all automatically.
            </p>
            <div className={styles.demoCode}>
              <CodeBlock language="bash" title="Pipeline Output">
                {demoOutputCode}
              </CodeBlock>
            </div>
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
        <p>Join thousands of developers who never worry about outdated docs again.</p>
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
        <CommunityStats />
        <HomepageFeatures />
        <HowItWorks />
        <DemoSection />
        <CTASection />
      </main>
    </Layout>
  );
}
