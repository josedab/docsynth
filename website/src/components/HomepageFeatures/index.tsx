import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

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
    description:
      'Gathers context from PRs, Jira, Slack to understand not just what changed, but why.',
  },
  {
    emoji: '✍️',
    title: 'Human Quality',
    description: "Produces documentation that reads naturally, matching your team's voice.",
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

function Feature({
  emoji,
  title,
  description,
}: {
  emoji: string;
  title: string;
  description: string;
}) {
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

export default function HomepageFeatures(): React.ReactNode {
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
