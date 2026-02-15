// ============================================================================
// Types
// ============================================================================

export type ApprovalState = 'pending' | 'in_review' | 'approved' | 'rejected' | 'changes_requested';

export type ReviewStrategy = 'any-of' | 'all-of';

export interface ApprovalWorkflow {
  id: string;
  documentId: string;
  requiredReviewers: string[];
  strategy: ReviewStrategy;
  minReviewers: number;
  requiredRoles: string[];
  autoApproveRules: AutoApproveRule[];
  state: ApprovalState;
  decisions: ReviewDecision[];
  createdAt: string;
  updatedAt: string;
}

export interface AutoApproveRule {
  condition: 'minor-edit' | 'same-author' | 'trusted-role';
  value: string;
}

export interface ReviewDecision {
  reviewerId: string;
  role: string;
  decision: 'approved' | 'rejected' | 'changes_requested';
  comment: string;
  timestamp: string;
}

export interface ApprovalSummary {
  workflowId: string;
  state: ApprovalState;
  totalReviewers: number;
  decisionsRecorded: number;
  approved: number;
  rejected: number;
  changesRequested: number;
  pending: number;
  averageTimeToDecisionMs: number | null;
  meetsPolicy: boolean;
}

// ============================================================================
// Workflow creation
// ============================================================================

export function createWorkflow(opts: {
  id: string;
  documentId: string;
  requiredReviewers: string[];
  strategy?: ReviewStrategy;
  minReviewers?: number;
  requiredRoles?: string[];
  autoApproveRules?: AutoApproveRule[];
}): ApprovalWorkflow {
  const now = new Date().toISOString();
  return {
    id: opts.id,
    documentId: opts.documentId,
    requiredReviewers: opts.requiredReviewers,
    strategy: opts.strategy ?? 'all-of',
    minReviewers: opts.minReviewers ?? opts.requiredReviewers.length,
    requiredRoles: opts.requiredRoles ?? [],
    autoApproveRules: opts.autoApproveRules ?? [],
    state: 'pending',
    decisions: [],
    createdAt: now,
    updatedAt: now,
  };
}

// ============================================================================
// Submit & transition
// ============================================================================

export function submitForApproval(workflow: ApprovalWorkflow): ApprovalWorkflow {
  if (workflow.state !== 'pending') {
    return workflow;
  }
  return { ...workflow, state: 'in_review', updatedAt: new Date().toISOString() };
}

export function recordDecision(
  workflow: ApprovalWorkflow,
  decision: ReviewDecision
): ApprovalWorkflow {
  if (workflow.state !== 'in_review') {
    return workflow;
  }

  const decisions = [
    ...workflow.decisions.filter((d) => d.reviewerId !== decision.reviewerId),
    decision,
  ];
  const nextState = computeNextState(workflow, decisions);

  return { ...workflow, decisions, state: nextState, updatedAt: new Date().toISOString() };
}

function computeNextState(workflow: ApprovalWorkflow, decisions: ReviewDecision[]): ApprovalState {
  const hasRejection = decisions.some((d) => d.decision === 'rejected');
  if (hasRejection) return 'rejected';

  const hasChangesRequested = decisions.some((d) => d.decision === 'changes_requested');
  if (hasChangesRequested) return 'changes_requested';

  const approvalCount = decisions.filter((d) => d.decision === 'approved').length;

  if (workflow.strategy === 'any-of' && approvalCount >= 1) {
    return 'approved';
  }

  if (workflow.strategy === 'all-of' && approvalCount >= workflow.minReviewers) {
    return 'approved';
  }

  return 'in_review';
}

// ============================================================================
// Auto-approve evaluation
// ============================================================================

export function evaluateAutoApprove(
  workflow: ApprovalWorkflow,
  context: { changeSize: 'minor' | 'major'; authorId: string; authorRole: string }
): boolean {
  for (const rule of workflow.autoApproveRules) {
    if (rule.condition === 'minor-edit' && context.changeSize === 'minor') return true;
    if (rule.condition === 'same-author' && workflow.requiredReviewers.includes(context.authorId))
      return true;
    if (rule.condition === 'trusted-role' && context.authorRole === rule.value) return true;
  }
  return false;
}

// ============================================================================
// Policy enforcement
// ============================================================================

export function checkPolicy(workflow: ApprovalWorkflow): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  if (workflow.requiredReviewers.length < workflow.minReviewers) {
    violations.push(
      `Need at least ${workflow.minReviewers} reviewers but only ${workflow.requiredReviewers.length} assigned`
    );
  }

  for (const role of workflow.requiredRoles) {
    const hasRole = workflow.decisions.some((d) => d.role === role && d.decision === 'approved');
    if (!hasRole) {
      violations.push(`Missing required approval from role: ${role}`);
    }
  }

  return { valid: violations.length === 0, violations };
}

// ============================================================================
// Metrics & summary
// ============================================================================

export function calculateTimeToApprove(workflow: ApprovalWorkflow): number | null {
  if (workflow.decisions.length === 0) return null;
  const createdMs = new Date(workflow.createdAt).getTime();
  const times = workflow.decisions.map((d) => new Date(d.timestamp).getTime() - createdMs);
  return times.reduce((sum, t) => sum + t, 0) / times.length;
}

export function getApprovalSummary(workflow: ApprovalWorkflow): ApprovalSummary {
  const approved = workflow.decisions.filter((d) => d.decision === 'approved').length;
  const rejected = workflow.decisions.filter((d) => d.decision === 'rejected').length;
  const changesRequested = workflow.decisions.filter(
    (d) => d.decision === 'changes_requested'
  ).length;
  const pending = workflow.requiredReviewers.length - workflow.decisions.length;
  const policy = checkPolicy(workflow);

  return {
    workflowId: workflow.id,
    state: workflow.state,
    totalReviewers: workflow.requiredReviewers.length,
    decisionsRecorded: workflow.decisions.length,
    approved,
    rejected,
    changesRequested,
    pending: Math.max(0, pending),
    averageTimeToDecisionMs: calculateTimeToApprove(workflow),
    meetsPolicy: policy.valid,
  };
}
