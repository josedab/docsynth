import { createWorker, QUEUE_NAMES, type VectorIndexJobData } from '@docsynth/queue';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('vector-index-worker');

// Type assertion for new Prisma models (requires db:generate)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// Embedding configuration
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
const BATCH_SIZE = 100;

// Simple OpenAI client for embeddings
async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding API error: ${response.statusText}`);
  }

  const data = await response.json() as { data: { embedding: number[] }[] };
  return data.data.map((d) => d.embedding);
}

interface ChunkMetadata {
  documentPath: string;
  documentType: string;
  documentTitle: string;
  sectionHeading?: string;
  tokenCount: number;
}

function chunkDocument(content: string, documentId: string, repositoryId: string, metadata: Omit<ChunkMetadata, 'tokenCount' | 'sectionHeading'>): Array<{
  documentId: string;
  repositoryId: string;
  chunkIndex: number;
  content: string;
  metadata: ChunkMetadata;
}> {
  const chunks: Array<{
    documentId: string;
    repositoryId: string;
    chunkIndex: number;
    content: string;
    metadata: ChunkMetadata;
  }> = [];

  // Split by sections (markdown headers)
  const lines = content.split('\n');
  const sections: { heading?: string; content: string }[] = [];
  let currentSection = { heading: undefined as string | undefined, content: '' };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (currentSection.content.trim()) {
        sections.push(currentSection);
      }
      currentSection = { heading: headingMatch[2], content: line + '\n' };
    } else {
      currentSection.content += line + '\n';
    }
  }
  if (currentSection.content.trim()) {
    sections.push(currentSection);
  }
  if (sections.length === 0) {
    sections.push({ content });
  }

  let chunkIndex = 0;
  for (const section of sections) {
    // Split by size with overlap
    let start = 0;
    while (start < section.content.length) {
      let end = Math.min(start + CHUNK_SIZE, section.content.length);
      
      // Try to break at paragraph, sentence, or line boundary
      if (end < section.content.length) {
        const lastPara = section.content.lastIndexOf('\n\n', end);
        const lastSentence = section.content.lastIndexOf('. ', end);
        const lastLine = section.content.lastIndexOf('\n', end);
        
        if (lastPara > start + CHUNK_SIZE / 2) end = lastPara + 2;
        else if (lastSentence > start + CHUNK_SIZE / 2) end = lastSentence + 2;
        else if (lastLine > start + CHUNK_SIZE / 2) end = lastLine + 1;
      }

      const chunkContent = section.content.slice(start, end).trim();
      if (chunkContent.length > 0) {
        chunks.push({
          documentId,
          repositoryId,
          chunkIndex,
          content: chunkContent,
          metadata: {
            ...metadata,
            sectionHeading: section.heading,
            tokenCount: Math.ceil(chunkContent.length / 4),
          },
        });
        chunkIndex++;
      }
      start = end - CHUNK_OVERLAP;
    }
  }

  return chunks;
}

async function indexDocument(documentId: string, repositoryId: string): Promise<{ chunksCreated: number }> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
  });

  if (!document) {
    throw new Error(`Document not found: ${documentId}`);
  }

  // Delete existing chunks
  await db.documentChunk.deleteMany({
    where: { documentId },
  });

  // Create chunks
  const chunks = chunkDocument(document.content, documentId, repositoryId, {
    documentPath: document.path,
    documentType: document.type,
    documentTitle: document.title,
  });

  if (chunks.length === 0) {
    return { chunksCreated: 0 };
  }

  // Generate embeddings in batches
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map((c) => c.content);
    const embeddings = await generateEmbeddings(texts);

    // Store chunks with embeddings
    for (let j = 0; j < batch.length; j++) {
      const chunk = batch[j];
      if (chunk) {
        await db.documentChunk.create({
          data: {
            documentId: chunk.documentId,
            repositoryId: chunk.repositoryId,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            embedding: embeddings[j] ?? [],
            metadata: chunk.metadata as object,
          },
        });
      }
    }
  }

  return { chunksCreated: chunks.length };
}

async function updateVectorIndexMeta(repositoryId: string): Promise<void> {
  const totalChunks = await db.documentChunk.count({
    where: { repositoryId },
  });

  const totalDocuments = await prisma.document.count({
    where: {
      repositoryId,
      // Only count documents that have been indexed (have chunks)
    },
  });

  await db.vectorIndexMeta.upsert({
    where: { repositoryId },
    create: {
      repositoryId,
      totalChunks,
      totalDocuments,
      embeddingModel: EMBEDDING_MODEL,
      dimensionality: EMBEDDING_DIMENSIONS,
    },
    update: {
      totalChunks,
      totalDocuments,
      lastIndexedAt: new Date(),
    },
  });
}

export function startVectorIndexWorker() {
  const worker = createWorker(
    QUEUE_NAMES.VECTOR_INDEX,
    async (job) => {
      const data = job.data as VectorIndexJobData;

      log.info({ jobId: job.id, repositoryId: data.repositoryId, documentId: data.documentId }, 'Processing vector indexing');

      await job.updateProgress(10);

      if (data.documentId) {
        // Index single document
        const result = await indexDocument(data.documentId, data.repositoryId);
        log.info({ documentId: data.documentId, chunksCreated: result.chunksCreated }, 'Document indexed');
        await job.updateProgress(80);
      } else {
        // Index all documents in repository
        if (data.reindex) {
          // Delete all existing chunks
          await db.documentChunk.deleteMany({
            where: { repositoryId: data.repositoryId },
          });
          log.info({ repositoryId: data.repositoryId }, 'Cleared existing chunks for reindex');
        }

        const documents = await prisma.document.findMany({
          where: { repositoryId: data.repositoryId },
          select: { id: true },
        });

        let processed = 0;
        for (const doc of documents) {
          await indexDocument(doc.id, data.repositoryId);
          processed++;
          await job.updateProgress(10 + (processed / documents.length) * 70);
        }

        log.info({ repositoryId: data.repositoryId, documentsIndexed: documents.length }, 'Repository indexed');
      }

      // Update metadata
      await updateVectorIndexMeta(data.repositoryId);
      await job.updateProgress(100);

      log.info({ jobId: job.id }, 'Vector indexing complete');
    },
    {
      concurrency: 2,
      limiter: {
        max: 5,
        duration: 60000,
      },
    }
  );

  log.info('Vector index worker started');

  return worker;
}
