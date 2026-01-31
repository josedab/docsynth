import { Job } from 'bullmq';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import { createWorker, QUEUE_NAMES, ExampleValidationJobData } from '@docsynth/queue';
import { exampleExtractorService } from '../services/example-extractor.js';
import { sandboxExecutorService } from '../services/sandbox-executor.js';
import type { SandboxConfig } from '@docsynth/types';

const log = createLogger('example-validation-worker');

async function processExampleValidation(job: Job<ExampleValidationJobData>): Promise<void> {
  const { repositoryId, exampleId, documentId, validateAll } = job.data;

  log.info({ repositoryId, exampleId, documentId }, 'Starting example validation');

  try {
    if (exampleId) {
      // Validate single example
      await validateSingleExample(exampleId);
    } else if (documentId) {
      // Extract and validate examples from a document
      await processDocumentExamples(documentId, repositoryId);
    } else if (validateAll) {
      // Validate all examples for repository
      await validateAllRepositoryExamples(repositoryId);
    } else {
      // Extract examples from all documents
      await extractRepositoryExamples(repositoryId);
    }

    await job.updateProgress(100);
    log.info({ repositoryId }, 'Example validation completed');
  } catch (error) {
    log.error({ error, repositoryId }, 'Example validation failed');
    throw error;
  }
}

async function validateSingleExample(exampleId: string): Promise<void> {
  const example = await prisma.interactiveExample.findUnique({
    where: { id: exampleId },
  });

  if (!example) {
    throw new Error(`Example not found: ${exampleId}`);
  }

  const config = example.sandboxConfig as unknown as SandboxConfig;
  const result = await sandboxExecutorService.validateExample(
    example.code,
    example.language,
    example.expectedOutput ?? undefined,
    config
  );

  await prisma.interactiveExample.update({
    where: { id: exampleId },
    data: {
      validationStatus: result.isValid ? 'valid' : 'invalid',
      lastValidated: new Date(),
    },
  });

  // Record execution
  await prisma.exampleExecution.create({
    data: {
      exampleId,
      code: example.code,
      output: result.actualOutput,
      error: result.error,
      exitCode: result.isValid ? 0 : 1,
    },
  });
}

async function processDocumentExamples(documentId: string, repositoryId: string): Promise<void> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
  });

  if (!document) {
    throw new Error(`Document not found: ${documentId}`);
  }

  // Extract examples from document
  const extractedExamples = exampleExtractorService.extractExamples(
    document.content,
    document.path
  );

  log.info({ documentId, count: extractedExamples.length }, 'Extracted examples from document');

  // Delete existing examples for this document
  await prisma.interactiveExample.deleteMany({
    where: { documentId },
  });

  // Create new examples
  for (const example of extractedExamples) {
    const sandboxConfig = exampleExtractorService.generateSandboxConfig(
      example.language,
      example.dependencies
    );

    const created = await prisma.interactiveExample.create({
      data: {
        documentId,
        repositoryId,
        title: example.title,
        description: example.description,
        language: example.language,
        code: example.code,
        expectedOutput: example.expectedOutput,
        dependencies: example.dependencies,
        sandboxConfig: JSON.parse(JSON.stringify(sandboxConfig)),
        isRunnable: example.isRunnable,
        sourceLineStart: example.lineStart,
        sourceLineEnd: example.lineEnd,
        validationStatus: 'pending',
      },
    });

    // Validate if runnable
    if (example.isRunnable) {
      try {
        const result = await sandboxExecutorService.validateExample(
          example.code,
          example.language,
          example.expectedOutput,
          sandboxConfig
        );

        await prisma.interactiveExample.update({
          where: { id: created.id },
          data: {
            validationStatus: result.isValid ? 'valid' : 'invalid',
            lastValidated: new Date(),
          },
        });
      } catch (error) {
        log.warn({ error, exampleId: created.id }, 'Failed to validate example');
        await prisma.interactiveExample.update({
          where: { id: created.id },
          data: { validationStatus: 'error' },
        });
      }
    }
  }
}

async function validateAllRepositoryExamples(repositoryId: string): Promise<void> {
  const examples = await prisma.interactiveExample.findMany({
    where: {
      repositoryId,
      isRunnable: true,
    },
  });

  log.info({ repositoryId, count: examples.length }, 'Validating repository examples');

  for (const example of examples) {
    try {
      const config = example.sandboxConfig as unknown as SandboxConfig;
      const result = await sandboxExecutorService.validateExample(
        example.code,
        example.language,
        example.expectedOutput ?? undefined,
        config
      );

      await prisma.interactiveExample.update({
        where: { id: example.id },
        data: {
          validationStatus: result.isValid ? 'valid' : 'invalid',
          lastValidated: new Date(),
        },
      });

      await prisma.exampleExecution.create({
        data: {
          exampleId: example.id,
          code: example.code,
          output: result.actualOutput,
          error: result.error,
          exitCode: result.isValid ? 0 : 1,
        },
      });
    } catch (error) {
      log.warn({ error, exampleId: example.id }, 'Failed to validate example');
      await prisma.interactiveExample.update({
        where: { id: example.id },
        data: { validationStatus: 'error' },
      });
    }
  }
}

async function extractRepositoryExamples(repositoryId: string): Promise<void> {
  const documents = await prisma.document.findMany({
    where: { repositoryId },
    select: { id: true },
  });

  log.info({ repositoryId, documentCount: documents.length }, 'Extracting examples from repository');

  for (const doc of documents) {
    await processDocumentExamples(doc.id, repositoryId);
  }
}

export function startExampleValidationWorker() {
  return createWorker(QUEUE_NAMES.EXAMPLE_VALIDATION, processExampleValidation, {
    concurrency: 2,
    limiter: { max: 20, duration: 60000 },
  });
}
