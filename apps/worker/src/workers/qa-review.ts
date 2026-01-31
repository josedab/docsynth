import { Job } from 'bullmq';
import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';
import { GitHubClient } from '@docsynth/github';
import { qaAgentService } from '../services/qa-agent.js';

const log = createLogger('qa-review-worker');

// Type assertion for models with expected field names
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

export interface QAReviewJobData {
  sessionId: string;
  repositoryId: string;
  generationJobId: string;
  prNumber: number;
  owner: string;
  repo: string;
  installationId: number;
  documents: Array<{
    path: string;
    type: string;
    title: string;
    content: string;
    action: string;
  }>;
  codeContext: string;
  prContext: {
    title: string;
    body: string | null;
    number: number;
  };
}

export async function processQAReview(job: Job<QAReviewJobData>): Promise<void> {
  const { sessionId, repositoryId, prNumber, owner, repo, installationId, documents, codeContext, prContext } =
    job.data;

  log.info({ sessionId, repositoryId, prNumber }, 'Starting QA review');

  try {
    // Update session status
    await db.qASession.update({
      where: { id: sessionId },
      data: { status: 'reviewing' },
    });

    // Get GitHub client
    const client = GitHubClient.forInstallation(installationId);

    // Analyze documentation with properly typed documents
    const typedDocs = documents.map((d) => ({
      ...d,
      type: d.type as 'README' | 'API_REFERENCE' | 'GUIDE' | 'TUTORIAL' | 'CHANGELOG' | 'ARCHITECTURE' | 'ADR' | 'INLINE_COMMENT',
      action: d.action as 'create' | 'update',
    }));
    const qaResult = await qaAgentService.analyzeDocumentation(typedDocs, codeContext, prContext);

    // Store questions in database
    const createdQuestions = await Promise.all(
      qaResult.questions.map((q) =>
        db.qAQuestion.create({
          data: {
            sessionId,
            questionType: q.questionType,
            category: q.category,
            question: q.question,
            context: q.context,
            documentPath: q.documentPath,
            lineStart: q.lineStart,
            lineEnd: q.lineEnd,
            priority: q.priority,
            status: 'pending',
          },
        })
      )
    );

    // Update session with confidence score
    await db.qASession.update({
      where: { id: sessionId },
      data: {
        confidenceScore: qaResult.confidenceScore,
        documentIds: documents.map((d) => d.path),
      },
    });

    // Check if we can auto-approve
    if (qaResult.canAutoApprove && qaResult.confidenceScore >= 85) {
      log.info({ sessionId, confidenceScore: qaResult.confidenceScore }, 'Auto-approving documentation');

      await db.qASession.update({
        where: { id: sessionId },
        data: {
          status: 'approved',
          autoApproved: true,
          approvedAt: new Date(),
        },
      });

      // Post approval comment to PR
      await client.createPRComment(
        owner,
        repo,
        prNumber,
        `## ✅ DocSynth QA Review - Auto-Approved\n\n` +
          `The generated documentation has been reviewed and approved automatically.\n\n` +
          `**Confidence Score:** ${qaResult.confidenceScore}%\n\n` +
          `No critical issues were found that require human review.`
      );

      return;
    }

    // Post questions to GitHub PR
    if (createdQuestions.length > 0) {
      const { commentId, threadUrl } = await qaAgentService.postQuestionsToGitHub(
        client,
        owner,
        repo,
        prNumber,
        qaResult.questions
      );

      await db.qASession.update({
        where: { id: sessionId },
        data: {
          status: 'awaiting_response',
          metadata: {
            commentId,
            threadUrl,
            questionCount: createdQuestions.length,
          },
        },
      });

      log.info({ sessionId, questionCount: createdQuestions.length, commentId }, 'QA questions posted to GitHub');
    } else {
      // No questions but not high enough confidence - flag for manual review
      await db.qASession.update({
        where: { id: sessionId },
        data: { status: 'awaiting_response' },
      });

      await client.createPRComment(
        owner,
        repo,
        prNumber,
        `## 📝 DocSynth QA Review\n\n` +
          `Documentation has been generated but requires human review.\n\n` +
          `**Confidence Score:** ${qaResult.confidenceScore}%\n\n` +
          `Please review the generated documentation and reply with \`/qa approve\` to finalize.`
      );
    }
  } catch (error) {
    log.error({ error, sessionId }, 'QA review failed');

    await db.qASession.update({
      where: { id: sessionId },
      data: {
        status: 'completed',
        metadata: { error: String(error) },
      },
    });

    throw error;
  }
}

export interface QARefinementJobData {
  sessionId: string;
  answers: Array<{ questionId: string; answer: string }>;
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
}

export async function processQARefinement(job: Job<QARefinementJobData>): Promise<void> {
  const { sessionId, answers, installationId, owner, repo, prNumber } = job.data;

  log.info({ sessionId, answerCount: answers.length }, 'Processing QA refinement');

  try {
    const session = await db.qASession.findUnique({
      where: { id: sessionId },
      include: { questions: true },
    });

    if (!session) {
      throw new Error(`QA session not found: ${sessionId}`);
    }

    // Update questions with answers
    for (const { questionId, answer } of answers) {
      await db.qAQuestion.update({
        where: { id: questionId },
        data: {
          answer,
          status: 'answered',
          answeredAt: new Date(),
        },
      });
    }

    // Get the documents to refine
    const documentPaths = session.documentIds as string[];
    const documents = await prisma.document.findMany({
      where: {
        repositoryId: session.repositoryId,
        path: { in: documentPaths },
      },
    });

    // Match questions with answers for refinement
    const questionsWithAnswers = session.questions
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((q: any) => answers.some((a) => a.questionId === q.id))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((q: any) => ({
        question: {
          id: q.id,
          questionType: q.questionType as 'ambiguity' | 'missing_example' | 'unclear_term' | 'verification' | 'edge_case',
          category: q.category as 'api' | 'behavior' | 'usage' | 'architecture' | 'terminology',
          question: q.question,
          context: q.context ?? '',
          documentPath: q.documentPath ?? '',
          lineStart: q.lineStart ?? undefined,
          lineEnd: q.lineEnd ?? undefined,
          priority: q.priority as 'low' | 'medium' | 'high' | 'critical',
        },
        answer: answers.find((a) => a.questionId === q.id)?.answer ?? '',
      }));

    // Refine each document
    for (const doc of documents) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const docQAs = questionsWithAnswers.filter((qa: any) => qa.question.documentPath === doc.path);

      if (docQAs.length > 0) {
        const refinement = await qaAgentService.refineDocumentWithAnswers(
          { path: doc.path, type: doc.type, title: doc.title, content: doc.content, action: 'update' },
          docQAs
        );

        // Update document with refined content
        await prisma.document.update({
          where: { id: doc.id },
          data: {
            content: refinement.refinedContent,
            version: { increment: 1 },
          },
        });

        // Mark questions as applied
        for (const qaId of refinement.appliedAnswers) {
          await db.qAQuestion.update({
            where: { id: qaId },
            data: { status: 'applied', appliedAt: new Date() },
          });
        }
      }
    }

    // Check if all questions are handled
    const pendingQuestions = await db.qAQuestion.count({
      where: { sessionId, status: 'pending' },
    });

    if (pendingQuestions === 0) {
      await db.qASession.update({
        where: { id: sessionId },
        data: { status: 'completed' },
      });

      // Notify on GitHub
      const client = GitHubClient.forInstallation(installationId);
      await client.createPRComment(
        owner,
        repo,
        prNumber,
        `## ✅ DocSynth QA Review - Complete\n\n` +
          `All questions have been addressed and documentation has been updated.\n\n` +
          `The refined documentation is ready for final review.`
      );
    }

    log.info({ sessionId, refinedDocs: documents.length }, 'QA refinement complete');
  } catch (error) {
    log.error({ error, sessionId }, 'QA refinement failed');
    throw error;
  }
}
