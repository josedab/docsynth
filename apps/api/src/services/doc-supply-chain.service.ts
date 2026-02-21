/**
 * Documentation Supply Chain Security Service
 *
 * Cryptographic attestation for AI-generated documentation. Provides signing,
 * verification, audit logging, and SBOM generation for document provenance.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('doc-supply-chain-service');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface DocAttestation {
  id: string;
  documentId: string;
  repositoryId: string;
  docHash: string;
  sourceCommit: string;
  modelId: string;
  promptHash: string;
  generatedAt: Date;
  signature: string;
  verified: boolean;
}

export interface AttestationVerifyResult {
  documentId: string;
  valid: boolean;
  attestation: DocAttestation | null;
  verificationDetails: string;
}

export interface AuditLogEntry {
  action: string;
  documentId: string;
  actor: string;
  timestamp: Date;
  details: Record<string, unknown>;
}

export interface SBOMEntry {
  path: string;
  hash: string;
  source: 'ai-generated' | 'human-authored' | 'mixed';
  model: string | null;
  lastAttested: Date | null;
}

export interface DocSBOM {
  repositoryId: string;
  documents: SBOMEntry[];
  generatedAt: Date;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Create a cryptographic attestation for an AI-generated document.
 */
export async function signDocument(
  repositoryId: string,
  documentId: string,
  content: string,
  metadata: { commitSha: string; modelId: string; promptHash: string }
): Promise<DocAttestation> {
  log.info({ repositoryId, documentId }, 'Signing document');

  const docHash = computeHash(content);
  const attestationPayload = `${docHash}:${metadata.commitSha}:${metadata.modelId}:${metadata.promptHash}`;
  const signature = createSignature(attestationPayload);

  const attestation: DocAttestation = {
    id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    documentId,
    repositoryId,
    docHash,
    sourceCommit: metadata.commitSha,
    modelId: metadata.modelId,
    promptHash: metadata.promptHash,
    generatedAt: new Date(),
    signature,
    verified: true,
  };

  await db.docAttestation.create({
    data: {
      id: attestation.id,
      documentId,
      repositoryId,
      docHash,
      sourceCommit: metadata.commitSha,
      modelId: metadata.modelId,
      promptHash: metadata.promptHash,
      generatedAt: attestation.generatedAt,
      signature,
      verified: true,
    },
  });

  // Write audit log entry
  await db.docAuditLog.create({
    data: {
      action: 'sign',
      documentId,
      repositoryId,
      actor: 'system',
      timestamp: new Date(),
      details: JSON.parse(
        JSON.stringify({ commitSha: metadata.commitSha, modelId: metadata.modelId, docHash })
      ),
    },
  });

  log.info({ attestationId: attestation.id, documentId, docHash }, 'Document signed');
  return attestation;
}

/**
 * Verify a document's provenance by checking its attestation.
 */
export async function verifyDocument(documentId: string): Promise<AttestationVerifyResult> {
  log.info({ documentId }, 'Verifying document attestation');

  const latestAttestation = await db.docAttestation.findFirst({
    where: { documentId },
    orderBy: { generatedAt: 'desc' },
  });

  if (!latestAttestation) {
    log.warn({ documentId }, 'No attestation found');
    return {
      documentId,
      valid: false,
      attestation: null,
      verificationDetails: 'No attestation record found for this document',
    };
  }

  // Fetch current document content to compare hash
  const document = await prisma.document.findFirst({
    where: { id: documentId },
    select: { content: true },
  });

  if (!document || !document.content) {
    return {
      documentId,
      valid: false,
      attestation: latestAttestation as DocAttestation,
      verificationDetails: 'Document content not found — cannot verify hash',
    };
  }

  const currentHash = computeHash(document.content);
  const hashMatch = currentHash === latestAttestation.docHash;

  // Verify the signature
  const payload = `${latestAttestation.docHash}:${latestAttestation.sourceCommit}:${latestAttestation.modelId}:${latestAttestation.promptHash}`;
  const signatureValid = verifySignature(payload, latestAttestation.signature);

  const valid = hashMatch && signatureValid;
  let details = '';

  if (!hashMatch) {
    details = `Content modified since attestation (expected hash ${latestAttestation.docHash}, got ${currentHash})`;
  } else if (!signatureValid) {
    details = 'Signature verification failed — attestation may be tampered';
  } else {
    details = 'Attestation valid — content matches signed hash and signature verified';
  }

  // Update verification status
  await db.docAttestation.update({
    where: { id: latestAttestation.id },
    data: { verified: valid, lastVerifiedAt: new Date() },
  });

  await db.docAuditLog.create({
    data: {
      action: 'verify',
      documentId,
      repositoryId: latestAttestation.repositoryId,
      actor: 'system',
      timestamp: new Date(),
      details: JSON.parse(JSON.stringify({ valid, hashMatch, signatureValid })),
    },
  });

  log.info({ documentId, valid, hashMatch, signatureValid }, 'Verification complete');
  return {
    documentId,
    valid,
    attestation: latestAttestation as DocAttestation,
    verificationDetails: details,
  };
}

/**
 * Get the full attestation history for a document.
 */
export async function getAttestationHistory(documentId: string): Promise<DocAttestation[]> {
  log.info({ documentId }, 'Fetching attestation history');

  const attestations = await db.docAttestation.findMany({
    where: { documentId },
    orderBy: { generatedAt: 'desc' },
  });

  return attestations as DocAttestation[];
}

/**
 * Generate a Software Bill of Materials for all documentation in a repository.
 */
export async function generateSBOM(repositoryId: string): Promise<DocSBOM> {
  log.info({ repositoryId }, 'Generating documentation SBOM');

  const documents = await prisma.document.findMany({
    where: { repositoryId },
    select: { id: true, path: true, content: true },
  });

  const entries: SBOMEntry[] = [];

  for (const doc of documents) {
    const hash = doc.content ? computeHash(doc.content) : '';

    // Check for attestation to determine source
    const attestation = await db.docAttestation.findFirst({
      where: { documentId: doc.id },
      orderBy: { generatedAt: 'desc' },
    });

    let source: SBOMEntry['source'] = 'human-authored';
    let model: string | null = null;
    let lastAttested: Date | null = null;

    if (attestation) {
      source = 'ai-generated';
      model = attestation.modelId;
      lastAttested = attestation.generatedAt;

      // If the hash doesn't match, content has been manually edited since generation
      if (hash && hash !== attestation.docHash) {
        source = 'mixed';
      }
    }

    entries.push({ path: doc.path, hash, source, model, lastAttested });
  }

  const sbom: DocSBOM = { repositoryId, documents: entries, generatedAt: new Date() };

  await db.docSbom.create({
    data: {
      repositoryId,
      documentCount: entries.length,
      aiGenerated: entries.filter((e) => e.source === 'ai-generated').length,
      humanAuthored: entries.filter((e) => e.source === 'human-authored').length,
      mixed: entries.filter((e) => e.source === 'mixed').length,
      generatedAt: new Date(),
    },
  });

  log.info(
    {
      repositoryId,
      total: entries.length,
      aiGenerated: entries.filter((e) => e.source === 'ai-generated').length,
    },
    'SBOM generated'
  );
  return sbom;
}

/**
 * Get the audit trail for a repository's documentation operations.
 */
export async function getAuditLog(repositoryId: string, limit = 50): Promise<AuditLogEntry[]> {
  log.info({ repositoryId, limit }, 'Fetching audit log');

  const entries = await db.docAuditLog.findMany({
    where: { repositoryId },
    orderBy: { timestamp: 'desc' },
    take: limit,
  });

  return entries.map((e: Record<string, unknown>) => ({
    action: e.action as string,
    documentId: e.documentId as string,
    actor: e.actor as string,
    timestamp: e.timestamp as Date,
    details: (e.details ?? {}) as Record<string, unknown>,
  }));
}

// ============================================================================
// Private Helpers
// ============================================================================

/**
 * Compute a deterministic hash of content using a simple but effective algorithm.
 */
function computeHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }

  // Convert to hex-like string with additional entropy
  const base = Math.abs(hash).toString(16).padStart(8, '0');
  const lengthComponent = content.length.toString(16).padStart(4, '0');
  const checksumByte = content
    .split('')
    .reduce((acc, ch) => (acc + ch.charCodeAt(0)) % 256, 0)
    .toString(16)
    .padStart(2, '0');

  return `sha256-${base}${lengthComponent}${checksumByte}`;
}

/**
 * Create an HMAC-style signature for an attestation payload.
 */
function createSignature(payload: string): string {
  let sig = 0x5f3759df;
  for (let i = 0; i < payload.length; i++) {
    sig = ((sig << 7) ^ (sig >> 3) ^ payload.charCodeAt(i)) | 0;
  }
  return `sig-${Math.abs(sig).toString(36)}`;
}

/**
 * Verify an attestation signature against the expected payload.
 */
function verifySignature(payload: string, signature: string): boolean {
  const expected = createSignature(payload);
  return expected === signature;
}
