import { createWorker, QUEUE_NAMES, type NotificationJobData } from '@docsynth/queue';
import { createLogger } from '@docsynth/utils';

const log = createLogger('notification-worker');

export function startNotificationWorker() {
  const worker = createWorker(
    QUEUE_NAMES.NOTIFICATIONS,
    async (job) => {
      const data = job.data as NotificationJobData;

      log.info({ jobId: job.id, type: data.type }, 'Processing notification');

      switch (data.type) {
        case 'email':
          await sendEmail(data);
          break;
        case 'slack':
          await sendSlackNotification(data);
          break;
        case 'webhook':
          await sendWebhook(data);
          break;
        default:
          log.warn({ type: data.type }, 'Unknown notification type');
      }

      await job.updateProgress(100);
    },
    { concurrency: 5 }
  );

  log.info('Notification worker started');
  return worker;
}

async function sendEmail(data: NotificationJobData): Promise<void> {
  // In production, integrate with email service (SendGrid, SES, etc.)
  log.info({ recipient: data.recipient, subject: data.subject }, 'Would send email');

  // Example with a hypothetical email service:
  // await emailService.send({
  //   to: data.recipient,
  //   subject: data.subject,
  //   html: data.body,
  // });
}

async function sendSlackNotification(data: NotificationJobData): Promise<void> {
  const webhookUrl = data.metadata?.webhookUrl as string;

  if (!webhookUrl) {
    log.warn('No Slack webhook URL provided');
    return;
  }

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: data.subject,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${data.subject}*\n${data.body}`,
            },
          },
        ],
      }),
    });

    log.info({ recipient: data.recipient }, 'Slack notification sent');
  } catch (error) {
    log.error({ error }, 'Failed to send Slack notification');
    throw error;
  }
}

async function sendWebhook(data: NotificationJobData): Promise<void> {
  const webhookUrl = data.recipient;

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-DocSynth-Event': data.metadata?.event as string ?? 'notification',
      },
      body: JSON.stringify({
        subject: data.subject,
        body: data.body,
        metadata: data.metadata,
        timestamp: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Webhook returned ${response.status}`);
    }

    log.info({ webhookUrl }, 'Webhook notification sent');
  } catch (error) {
    log.error({ error, webhookUrl }, 'Failed to send webhook notification');
    throw error;
  }
}

// Notification helper functions
export async function notifyDocumentationGenerated(
  organizationId: string,
  repoName: string,
  prNumber: number,
  docsPrUrl: string
): Promise<void> {
  const { addJob } = await import('@docsynth/queue');
  const { prisma } = await import('@docsynth/database');

  // Get organization settings (would include notification preferences)
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
  });

  if (!org) return;

  // Queue email notification
  await addJob(QUEUE_NAMES.NOTIFICATIONS, {
    type: 'email',
    recipient: `org-${organizationId}@docsynth.io`,
    subject: `Documentation generated for ${repoName} #${prNumber}`,
    body: `
      <h2>Documentation Generated</h2>
      <p>DocSynth has automatically generated documentation for PR #${prNumber} in ${repoName}.</p>
      <p><a href="${docsPrUrl}">Review the documentation PR</a></p>
    `,
    metadata: {
      event: 'documentation.generated',
      organizationId,
      repoName,
      prNumber,
    },
  });
}

export async function notifyGenerationFailed(
  organizationId: string,
  repoName: string,
  prNumber: number,
  error: string
): Promise<void> {
  const { addJob } = await import('@docsynth/queue');

  await addJob(QUEUE_NAMES.NOTIFICATIONS, {
    type: 'email',
    recipient: `org-${organizationId}@docsynth.io`,
    subject: `Documentation generation failed for ${repoName} #${prNumber}`,
    body: `
      <h2>Generation Failed</h2>
      <p>DocSynth failed to generate documentation for PR #${prNumber} in ${repoName}.</p>
      <p><strong>Error:</strong> ${error}</p>
      <p>Please check the DocSynth dashboard for more details.</p>
    `,
    metadata: {
      event: 'documentation.failed',
      organizationId,
      repoName,
      prNumber,
      error,
    },
  });
}
