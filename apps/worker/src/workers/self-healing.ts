/**
 * Self-Healing Documentation Worker
 *
 * Automatically regenerates outdated documentation sections based on
 * code changes and drift detection signals.
 */

import { createWorker, QUEUE_NAMES, type SelfHealingJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger, createLLMClient } from '@docsynth/utils';

const log = createLogger('self-healing-worker');

interface RegenerationResult {
  documentId: string;
  documentPath: string;
  status: 'success' | 'partial' | 'failed' | 'skipped';
  sections: Array<{
    title: string;
    regenerated: boolean;
    confidence: number;
    requiresReview: boolean;
  }>;
  error?: string;
}

export function startSelfHealingWorker() {
  const worker = createWorker(
    QUEUE_NAMES.SELF_HEALING,
    async (job) => {
      const data = job.data as SelfHealingJobData;
      const {
        repositoryId,
        triggeredBy,
        confidenceThreshold = 0.8,
        requireReview = true,
        maxSections = 5,
        excludePatterns = ['CHANGELOG', 'LICENSE'],
      } = data;

      log.info({ jobId: job.id, repositoryId, triggeredBy }, 'Starting self-healing run');

      await job.updateProgress(5);

      try {
        // Create self-healing run record
        const run = await prisma.selfHealingRun.create({
          data: {
            repositoryId,
            triggeredBy,
            status: 'running',
            confidenceThreshold,
            requireReview,
            maxSections,
            startedAt: new Date(),
          },
        });

        // Get documents that need attention
        const documents = await prisma.document.findMany({
          where: {
            repositoryId,
            NOT: {
              path: {
                in: excludePatterns.map((p) => `%${p}%`),
              },
            },
          },
          include: {
            repository: true,
          },
          orderBy: { updatedAt: 'asc' },
          take: maxSections * 2, // Get more than needed to account for filtering
        });

        await job.updateProgress(20);

        const llmClient = createLLMClient();
        const results: RegenerationResult[] = [];
        let sectionsAnalyzed = 0;
        let sectionsRegenerated = 0;
        let sectionsPending = 0;
        let sectionsFailed = 0;

        for (const doc of documents) {
          if (sectionsRegenerated >= maxSections) break;

          try {
            // Analyze document for staleness
            const analysisPrompt = `Analyze this documentation for potential staleness or accuracy issues.

Document: ${doc.title}
Path: ${doc.path}
Last Updated: ${doc.updatedAt.toISOString()}

Content:
${doc.content.substring(0, 3000)}

Return JSON with:
{
  "needsRegeneration": boolean,
  "confidence": number (0-1),
  "staleSections": [{ "title": string, "reason": string }],
  "suggestedUpdates": string[]
}`;

            const analysisResponse = await llmClient.generate(analysisPrompt, { maxTokens: 1024 });
            sectionsAnalyzed++;

            let analysis: {
              needsRegeneration: boolean;
              confidence: number;
              staleSections: Array<{ title: string; reason: string }>;
              suggestedUpdates: string[];
            };

            try {
              const jsonMatch = analysisResponse.content.match(/\{[\s\S]*\}/);
              analysis = JSON.parse(jsonMatch?.[0] || '{}');
            } catch {
              analysis = { needsRegeneration: false, confidence: 0, staleSections: [], suggestedUpdates: [] };
            }

            if (analysis.needsRegeneration && analysis.confidence >= confidenceThreshold) {
              // Regenerate the document
              const regenPrompt = `Improve and update this documentation based on the following suggestions:

Current Document:
${doc.content.substring(0, 4000)}

Suggested Updates:
${analysis.suggestedUpdates.join('\n')}

Stale Sections to Fix:
${analysis.staleSections.map((s) => `- ${s.title}: ${s.reason}`).join('\n')}

Provide an updated version of the documentation that addresses these issues while maintaining the existing structure and tone.`;

              const regenResponse = await llmClient.generate(regenPrompt, { maxTokens: 4096 });

              if (regenResponse.content && regenResponse.content.length > 100) {
                if (requireReview) {
                  // Store as pending review
                  sectionsPending++;
                  results.push({
                    documentId: doc.id,
                    documentPath: doc.path,
                    status: 'partial',
                    sections: analysis.staleSections.map((s) => ({
                      title: s.title,
                      regenerated: true,
                      confidence: analysis.confidence,
                      requiresReview: true,
                    })),
                  });
                } else {
                  // Apply directly
                  await prisma.document.update({
                    where: { id: doc.id },
                    data: {
                      content: regenResponse.content,
                      version: { increment: 1 },
                      metadata: {
                        ...(doc.metadata as object),
                        lastSelfHealing: new Date().toISOString(),
                        selfHealingConfidence: analysis.confidence,
                      },
                    },
                  });

                  sectionsRegenerated++;
                  results.push({
                    documentId: doc.id,
                    documentPath: doc.path,
                    status: 'success',
                    sections: analysis.staleSections.map((s) => ({
                      title: s.title,
                      regenerated: true,
                      confidence: analysis.confidence,
                      requiresReview: false,
                    })),
                  });
                }
              }
            } else {
              results.push({
                documentId: doc.id,
                documentPath: doc.path,
                status: 'skipped',
                sections: [],
              });
            }
          } catch (error) {
            sectionsFailed++;
            results.push({
              documentId: doc.id,
              documentPath: doc.path,
              status: 'failed',
              sections: [],
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }

          await job.updateProgress(20 + Math.floor((results.length / documents.length) * 70));
        }

        // Update run record
        await prisma.selfHealingRun.update({
          where: { id: run.id },
          data: {
            status: 'completed',
            sectionsAnalyzed,
            sectionsRegenerated,
            sectionsPending,
            sectionsFailed,
            details: results,
            completedAt: new Date(),
          },
        });

        await job.updateProgress(100);

        log.info(
          {
            repositoryId,
            sectionsAnalyzed,
            sectionsRegenerated,
            sectionsPending,
            sectionsFailed,
          },
          'Self-healing run completed'
        );

        return { runId: run.id, results };
      } catch (error) {
        log.error({ error, repositoryId }, 'Self-healing run failed');
        throw error;
      }
    },
    { concurrency: 1 }
  );

  log.info('Self-healing worker started');
  return worker;
}

// Schedule periodic self-healing runs
export async function schedulePeriodicSelfHealing(): Promise<void> {
  log.info('Scheduling periodic self-healing runs');

  const repositories = await prisma.repository.findMany({
    where: {
      enabled: true,
      config: {
        path: ['selfHealing', 'enabled'],
        equals: true,
      },
    },
  });

  for (const repo of repositories) {
    const config = repo.config as { selfHealing?: { confidenceThreshold?: number; requireReview?: boolean; maxSectionsPerRun?: number; excludePatterns?: string[] } } | null;
    const selfHealingConfig = config?.selfHealing || {};

    await prisma.$queryRaw`
      INSERT INTO self_healing_runs (id, repository_id, triggered_by, status, confidence_threshold, require_review, max_sections, created_at)
      VALUES (gen_random_uuid(), ${repo.id}, 'scheduled', 'pending', ${selfHealingConfig.confidenceThreshold || 0.8}, ${selfHealingConfig.requireReview !== false}, ${selfHealingConfig.maxSectionsPerRun || 5}, NOW())
    `;
  }

  log.info({ count: repositories.length }, 'Scheduled self-healing runs');
}
