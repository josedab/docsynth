import Anthropic from '@anthropic-ai/sdk';
import { createLogger } from '@docsynth/utils';
import { GitHubClient } from '@docsynth/github';
import type { GeneratedDocument } from '@docsynth/types';

const log = createLogger('qa-agent-service');

export interface QAQuestion {
  id: string;
  questionType: 'ambiguity' | 'missing_example' | 'unclear_term' | 'verification' | 'edge_case';
  category: 'api' | 'behavior' | 'usage' | 'architecture' | 'terminology';
  question: string;
  context: string;
  documentPath: string;
  lineStart?: number;
  lineEnd?: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export interface QAAnalysisResult {
  questions: QAQuestion[];
  confidenceScore: number;
  suggestedImprovements: string[];
  canAutoApprove: boolean;
}

export interface DocumentRefinement {
  documentPath: string;
  originalContent: string;
  refinedContent: string;
  appliedAnswers: string[];
}

const QA_SYSTEM_PROMPT = `You are a documentation QA specialist reviewing AI-generated documentation.
Your job is to identify ambiguities, missing information, unclear explanations, and areas that need human clarification.

Focus on:
1. AMBIGUITY: Terms or concepts that could be interpreted multiple ways
2. MISSING_EXAMPLE: Places where a code example would help but is missing or incomplete
3. UNCLEAR_TERM: Technical terms that aren't defined or explained
4. VERIFICATION: Claims that need human verification (e.g., specific behaviors, limits, requirements)
5. EDGE_CASE: Undocumented edge cases or error conditions

Rate your confidence that the documentation is complete and accurate (0-100).
If confidence >= 85 and there are no critical questions, recommend auto-approval.

Output JSON in this exact format:
{
  "questions": [
    {
      "questionType": "ambiguity|missing_example|unclear_term|verification|edge_case",
      "category": "api|behavior|usage|architecture|terminology",
      "question": "The specific question to ask",
      "context": "The relevant text from the doc",
      "lineStart": 10,
      "lineEnd": 15,
      "priority": "low|medium|high|critical"
    }
  ],
  "confidenceScore": 85,
  "suggestedImprovements": ["List of suggested improvements"],
  "canAutoApprove": true
}`;

export class QAAgentService {
  private anthropic: Anthropic | null = null;

  constructor() {
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
    }
  }

  async analyzeDocumentation(
    documents: GeneratedDocument[],
    codeContext: string,
    prContext: { title: string; body: string | null; number: number }
  ): Promise<QAAnalysisResult> {
    log.info({ docCount: documents.length, prNumber: prContext.number }, 'Analyzing documentation for QA');

    if (!this.anthropic) {
      log.warn('Anthropic client not available, returning default QA result');
      return {
        questions: [],
        confidenceScore: 70,
        suggestedImprovements: ['Configure ANTHROPIC_API_KEY for full QA analysis'],
        canAutoApprove: false,
      };
    }

    const docsContent = documents
      .map((doc) => `## ${doc.path}\n\n${doc.content}`)
      .join('\n\n---\n\n');

    const prompt = `Review this AI-generated documentation for a PR:

## PR Context
Title: ${prContext.title}
Description: ${prContext.body ?? 'No description provided'}

## Code Context
${codeContext.slice(0, 5000)}

## Generated Documentation
${docsContent}

Identify questions that need human clarification before these docs can be approved.
Focus on critical issues first. Limit to 10 most important questions.`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: QA_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0]?.type === 'text' ? response.content[0].text : '';
      
      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        log.warn('Could not parse QA response as JSON');
        return this.getDefaultResult();
      }

      const result = JSON.parse(jsonMatch[0]) as QAAnalysisResult;
      
      // Add IDs to questions
      result.questions = result.questions.map((q, i) => ({
        ...q,
        id: `qa-${Date.now()}-${i}`,
      }));

      log.info({
        questionCount: result.questions.length,
        confidenceScore: result.confidenceScore,
        canAutoApprove: result.canAutoApprove,
      }, 'QA analysis complete');

      return result;
    } catch (error) {
      log.error({ error }, 'QA analysis failed');
      return this.getDefaultResult();
    }
  }

  async refineDocumentWithAnswers(
    document: GeneratedDocument,
    questionsAndAnswers: Array<{ question: QAQuestion; answer: string }>
  ): Promise<DocumentRefinement> {
    log.info({ path: document.path, qaCount: questionsAndAnswers.length }, 'Refining document with answers');

    if (!this.anthropic || questionsAndAnswers.length === 0) {
      return {
        documentPath: document.path,
        originalContent: document.content,
        refinedContent: document.content,
        appliedAnswers: [],
      };
    }

    const qaContext = questionsAndAnswers
      .map((qa, i) => `Q${i + 1}: ${qa.question.question}\nA${i + 1}: ${qa.answer}`)
      .join('\n\n');

    const prompt = `Update this documentation based on the Q&A below.
Incorporate the answers naturally into the documentation.
Maintain the existing style and structure.

## Original Documentation
${document.content}

## Questions & Answers to Incorporate
${qaContext}

Output the refined documentation only, no explanations.`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      });

      const refinedContent = response.content[0]?.type === 'text' ? response.content[0].text : document.content;

      return {
        documentPath: document.path,
        originalContent: document.content,
        refinedContent,
        appliedAnswers: questionsAndAnswers.map((qa) => qa.question.id),
      };
    } catch (error) {
      log.error({ error }, 'Document refinement failed');
      return {
        documentPath: document.path,
        originalContent: document.content,
        refinedContent: document.content,
        appliedAnswers: [],
      };
    }
  }

  async postQuestionsToGitHub(
    client: GitHubClient,
    owner: string,
    repo: string,
    prNumber: number,
    questions: QAQuestion[]
  ): Promise<{ commentId: number; threadUrl: string }> {
    log.info({ owner, repo, prNumber, questionCount: questions.length }, 'Posting QA questions to GitHub');

    const grouped = this.groupQuestionsByPriority(questions);
    
    let commentBody = `## 🤖 DocSynth QA Review\n\n`;
    commentBody += `I've reviewed the generated documentation and have some questions to ensure accuracy:\n\n`;

    for (const [priority, qs] of Object.entries(grouped)) {
      if (qs.length === 0) continue;
      
      const emoji = priority === 'critical' ? '🔴' : priority === 'high' ? '🟠' : priority === 'medium' ? '🟡' : '🟢';
      commentBody += `### ${emoji} ${priority.charAt(0).toUpperCase() + priority.slice(1)} Priority\n\n`;
      
      for (const q of qs) {
        commentBody += `<details>\n<summary><b>${q.category.toUpperCase()}</b>: ${q.question}</summary>\n\n`;
        if (q.context) {
          commentBody += `> ${q.context.slice(0, 200)}${q.context.length > 200 ? '...' : ''}\n\n`;
        }
        if (q.documentPath) {
          commentBody += `📄 File: \`${q.documentPath}\``;
          if (q.lineStart) {
            commentBody += ` (lines ${q.lineStart}-${q.lineEnd ?? q.lineStart})`;
          }
          commentBody += '\n';
        }
        commentBody += `\n**Reply with your answer or "skip" to ignore this question.**\n`;
        commentBody += `<!-- qa-id:${q.id} -->\n`;
        commentBody += `</details>\n\n`;
      }
    }

    commentBody += `---\n*Reply to this comment to answer questions. Use \`/qa approve\` when ready to finalize documentation.*`;

    const comment = await client.createPRComment(owner, repo, prNumber, commentBody);

    return {
      commentId: comment.id,
      threadUrl: comment.url,
    };
  }

  async parseAnswersFromComment(
    commentBody: string,
    questions: QAQuestion[]
  ): Promise<Array<{ questionId: string; answer: string }>> {
    const answers: Array<{ questionId: string; answer: string }> = [];
    
    // Parse answers in format "Q1: answer" or "@qa-id: answer"
    for (const q of questions) {
      const idPattern = new RegExp(`(?:@${q.id}|qa-id:${q.id})[:\\s]+(.+?)(?=(?:@qa-|qa-id:|$))`, 'is');
      const match = commentBody.match(idPattern);
      
      if (match && match[1]) {
        const answer = match[1].trim();
        if (answer.toLowerCase() !== 'skip') {
          answers.push({ questionId: q.id, answer });
        }
      }
    }

    return answers;
  }

  private groupQuestionsByPriority(questions: QAQuestion[]): Record<string, QAQuestion[]> {
    return {
      critical: questions.filter((q) => q.priority === 'critical'),
      high: questions.filter((q) => q.priority === 'high'),
      medium: questions.filter((q) => q.priority === 'medium'),
      low: questions.filter((q) => q.priority === 'low'),
    };
  }

  private getDefaultResult(): QAAnalysisResult {
    return {
      questions: [],
      confidenceScore: 50,
      suggestedImprovements: [],
      canAutoApprove: false,
    };
  }
}

export const qaAgentService = new QAAgentService();
