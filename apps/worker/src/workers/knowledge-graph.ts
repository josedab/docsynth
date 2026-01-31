import { Job } from 'bullmq';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import { createWorker, QUEUE_NAMES, KnowledgeGraphJobData } from '@docsynth/queue';
import { knowledgeGraphBuilderService } from '../services/knowledge-graph-builder.js';

const log = createLogger('knowledge-graph-worker');

async function processKnowledgeGraph(job: Job<KnowledgeGraphJobData>): Promise<void> {
  const { repositoryId, fullRebuild } = job.data;
  const startTime = Date.now();

  log.info({ repositoryId, fullRebuild }, 'Starting knowledge graph build');

  try {
    // Update status to building
    await upsertGraphMeta(repositoryId, { status: 'building' });

    // Get repository and documents
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
      include: {
        documents: {
          select: {
            id: true,
            path: true,
            type: true,
            title: true,
            content: true,
          },
        },
      },
    });

    if (!repository) {
      throw new Error(`Repository not found: ${repositoryId}`);
    }

    await job.updateProgress(10);

    // Clear existing entities if full rebuild
    if (fullRebuild) {
      await prisma.knowledgeRelation.deleteMany({ where: { repositoryId } });
      await prisma.knowledgeEntity.deleteMany({ where: { repositoryId } });
    }

    await job.updateProgress(20);

    // Extract entities from documentation
    const docEntities = knowledgeGraphBuilderService.extractEntitiesFromDocs(
      repository.documents.map((d) => ({
        id: d.id,
        path: d.path,
        type: d.type,
        title: d.title,
        content: d.content,
      }))
    );

    await job.updateProgress(40);

    // Build relations
    const relations = knowledgeGraphBuilderService.buildRelations(
      docEntities,
      repository.documents.map((d) => ({
        id: d.id,
        path: d.path,
        type: d.type,
        title: d.title,
        content: d.content,
      }))
    );

    await job.updateProgress(60);

    // Store entities
    const entityIdMap = new Map<string, string>();

    for (const entity of docEntities) {
      const entityKey = `${entity.type}:${entity.name.toLowerCase()}`;

      try {
        const created = await prisma.knowledgeEntity.upsert({
          where: {
            repositoryId_name_type: {
              repositoryId,
              name: entity.name,
              type: entity.type,
            },
          },
          update: {
            description: entity.description,
            filePath: entity.filePath,
            lineStart: entity.lineStart,
            lineEnd: entity.lineEnd,
            metadata: JSON.parse(JSON.stringify(entity.metadata)),
            documentIds: entity.metadata.sourceDocumentId
              ? [entity.metadata.sourceDocumentId as string]
              : [],
          },
          create: {
            repositoryId,
            name: entity.name,
            type: entity.type,
            description: entity.description,
            filePath: entity.filePath,
            lineStart: entity.lineStart,
            lineEnd: entity.lineEnd,
            metadata: JSON.parse(JSON.stringify(entity.metadata)),
            documentIds: entity.metadata.sourceDocumentId
              ? [entity.metadata.sourceDocumentId as string]
              : [],
            embedding: [], // Will be populated by vector index job
          },
        });

        entityIdMap.set(entityKey, created.id);
      } catch (error) {
        log.warn({ error, entity: entity.name }, 'Failed to create entity');
      }
    }

    await job.updateProgress(80);

    // Store relations
    for (const relation of relations) {
      const fromKey = docEntities.find((e) => e.name === relation.fromEntity);
      const toKey = docEntities.find((e) => e.name === relation.toEntity);

      if (!fromKey || !toKey) continue;

      const fromId = entityIdMap.get(`${fromKey.type}:${fromKey.name.toLowerCase()}`);
      const toId = entityIdMap.get(`${toKey.type}:${toKey.name.toLowerCase()}`);

      if (!fromId || !toId) continue;

      try {
        await prisma.knowledgeRelation.upsert({
          where: {
            fromEntityId_toEntityId_relationship: {
              fromEntityId: fromId,
              toEntityId: toId,
              relationship: relation.relationship,
            },
          },
          update: {
            weight: relation.weight,
            metadata: JSON.parse(JSON.stringify(relation.metadata)),
          },
          create: {
            repositoryId,
            fromEntityId: fromId,
            toEntityId: toId,
            relationship: relation.relationship,
            weight: relation.weight,
            metadata: JSON.parse(JSON.stringify(relation.metadata)),
          },
        });
      } catch (error) {
        log.warn({ error, relation }, 'Failed to create relation');
      }
    }

    await job.updateProgress(95);

    // Update metadata
    const entityCount = await prisma.knowledgeEntity.count({ where: { repositoryId } });
    const relationCount = await prisma.knowledgeRelation.count({ where: { repositoryId } });
    const buildDurationMs = Date.now() - startTime;

    await upsertGraphMeta(repositoryId, {
      status: 'ready',
      entityCount,
      relationCount,
      buildDurationMs,
      lastBuiltAt: new Date(),
    });

    await job.updateProgress(100);
    log.info(
      { repositoryId, entityCount, relationCount, buildDurationMs },
      'Knowledge graph build completed'
    );
  } catch (error) {
    log.error({ error, repositoryId }, 'Knowledge graph build failed');

    await upsertGraphMeta(repositoryId, {
      status: 'error',
      errorMessage: error instanceof Error ? error.message : 'Build failed',
    });

    throw error;
  }
}

async function upsertGraphMeta(
  repositoryId: string,
  data: {
    status?: string;
    entityCount?: number;
    relationCount?: number;
    buildDurationMs?: number;
    lastBuiltAt?: Date;
    errorMessage?: string;
  }
): Promise<void> {
  await prisma.knowledgeGraphMeta.upsert({
    where: { repositoryId },
    update: data,
    create: {
      repositoryId,
      status: data.status || 'pending',
      entityCount: data.entityCount || 0,
      relationCount: data.relationCount || 0,
      buildDurationMs: data.buildDurationMs,
      errorMessage: data.errorMessage,
    },
  });
}

export function startKnowledgeGraphWorker() {
  return createWorker(QUEUE_NAMES.KNOWLEDGE_GRAPH, processKnowledgeGraph, {
    concurrency: 1,
    limiter: { max: 5, duration: 60000 },
  });
}
