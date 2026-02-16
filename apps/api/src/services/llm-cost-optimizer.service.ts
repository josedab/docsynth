/**
 * LLM Cost Optimizer Service
 *
 * Provides model routing, budget management, alert generation,
 * cost projection, and model downgrade capabilities for LLM usage.
 */

import { prisma } from '@docsynth/database';
import { createLogger } from '@docsynth/utils';

const log = createLogger('llm-cost-optimizer');

// Type assertion for extended Prisma models
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

// ============================================================================
// Types
// ============================================================================

export interface BudgetConfig {
  organizationId: string;
  monthlyLimitUsd: number;
  softLimitPercent: number; // default 80
  hardLimitAction: 'block' | 'downgrade' | 'alert-only';
  modelRoutingRules: ModelRoutingRule[];
  enabled: boolean;
}

export interface ModelRoutingRule {
  taskType: string;
  preferredModel: string;
  fallbackModel: string;
  maxCostPerRequest: number;
}

export interface BudgetStatus {
  currentSpend: number;
  monthlyLimit: number;
  percentUsed: number;
  projectedMonthEnd: number;
  status: 'ok' | 'warning' | 'critical' | 'exceeded';
  alerts: BudgetAlert[];
}

export interface BudgetAlert {
  type: 'warning' | 'error' | 'info';
  title: string;
  message: string;
  timestamp: Date;
}

interface ModelSelection {
  model: string;
  reason: string;
  estimatedCost: number;
}

interface SavingsReport {
  totalSaved: number;
  totalRequests: number;
  downgradedRequests: number;
  savingsByModel: Record<string, number>;
  period: { start: string; end: string };
}

interface CostSimulation {
  estimatedMonthlyCost: number;
  breakdown: Array<{ taskType: string; model: string; costPerRequest: number; totalCost: number }>;
  budgetImpact: { percentOfBudget: number; wouldExceed: boolean };
}

// ============================================================================
// Model Cost Reference (per 1K tokens in cents)
// ============================================================================

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini': { input: 0.015, output: 0.06 },
  'gpt-4o': { input: 0.25, output: 1.0 },
  'gpt-4-turbo-preview': { input: 1.0, output: 3.0 },
  'gpt-3.5-turbo': { input: 0.05, output: 0.15 },
  'claude-3-haiku-20240307': { input: 0.025, output: 0.125 },
  'claude-sonnet-4-20250514': { input: 0.3, output: 1.5 },
  'claude-3-5-sonnet-20241022': { input: 0.3, output: 1.5 },
  'claude-3-opus-20240229': { input: 1.5, output: 7.5 },
};

const DEFAULT_MODEL_COST = { input: 0.5, output: 1.5 };

// Model tier ordering from cheapest to most expensive
const MODEL_TIERS: string[] = [
  'gpt-4o-mini',
  'gpt-3.5-turbo',
  'claude-3-haiku-20240307',
  'gpt-4o',
  'claude-sonnet-4-20250514',
  'claude-3-5-sonnet-20241022',
  'gpt-4-turbo-preview',
  'claude-3-opus-20240229',
];

// Default routing rules
const DEFAULT_ROUTING_RULES: ModelRoutingRule[] = [
  {
    taskType: 'simple-summary',
    preferredModel: 'gpt-4o-mini',
    fallbackModel: 'gpt-3.5-turbo',
    maxCostPerRequest: 0.01,
  },
  {
    taskType: 'code-explanation',
    preferredModel: 'gpt-4o',
    fallbackModel: 'gpt-4o-mini',
    maxCostPerRequest: 0.05,
  },
  {
    taskType: 'doc-generation',
    preferredModel: 'claude-sonnet-4-20250514',
    fallbackModel: 'gpt-4o',
    maxCostPerRequest: 0.1,
  },
  {
    taskType: 'complex-generation',
    preferredModel: 'claude-sonnet-4-20250514',
    fallbackModel: 'gpt-4o',
    maxCostPerRequest: 0.15,
  },
  {
    taskType: 'critical-review',
    preferredModel: 'claude-3-opus-20240229',
    fallbackModel: 'claude-sonnet-4-20250514',
    maxCostPerRequest: 0.25,
  },
  {
    taskType: 'translation',
    preferredModel: 'gpt-4o',
    fallbackModel: 'gpt-4o-mini',
    maxCostPerRequest: 0.05,
  },
  {
    taskType: 'chat',
    preferredModel: 'gpt-4o-mini',
    fallbackModel: 'gpt-3.5-turbo',
    maxCostPerRequest: 0.02,
  },
];

// ============================================================================
// Service
// ============================================================================

class LLMCostOptimizerService {
  // In-memory budget config cache (keyed by orgId)
  private budgetConfigs = new Map<string, BudgetConfig>();

  /**
   * Select the optimal model for a task based on type and complexity
   */
  async selectOptimalModel(
    orgId: string,
    taskType: string,
    complexity: 'low' | 'medium' | 'high'
  ): Promise<ModelSelection> {
    const config = await this.getBudgetConfig(orgId);
    const rules = config?.modelRoutingRules?.length
      ? config.modelRoutingRules
      : DEFAULT_ROUTING_RULES;

    const rule = rules.find((r) => r.taskType === taskType);

    if (!rule) {
      // Default model selection based on complexity
      const model =
        complexity === 'high'
          ? 'claude-sonnet-4-20250514'
          : complexity === 'medium'
            ? 'gpt-4o'
            : 'gpt-4o-mini';

      const cost = MODEL_COSTS[model] || DEFAULT_MODEL_COST;
      return {
        model,
        reason: `Default selection for ${complexity} complexity task`,
        estimatedCost: (cost.input + cost.output) / 1000,
      };
    }

    // Check budget status to decide if we should downgrade
    const budgetStatus = await this.getBudgetStatus(orgId);
    let selectedModel = rule.preferredModel;
    let reason = `Optimal model for ${taskType}`;

    if (budgetStatus.status === 'exceeded' || budgetStatus.status === 'critical') {
      const downgraded = this.getDowngradedModel(rule.preferredModel, budgetStatus);
      if (downgraded !== rule.preferredModel) {
        selectedModel = downgraded;
        reason = `Downgraded from ${rule.preferredModel} due to budget ${budgetStatus.status} status`;
      }
    }

    // For low complexity, always prefer fallback (cheaper) model
    if (complexity === 'low' && rule.fallbackModel) {
      selectedModel = rule.fallbackModel;
      reason = `Using fallback model for low complexity ${taskType}`;
    }

    const cost = MODEL_COSTS[selectedModel] || DEFAULT_MODEL_COST;
    return {
      model: selectedModel,
      reason,
      estimatedCost: (cost.input + cost.output) / 1000,
    };
  }

  /**
   * Get budget status for an organization
   */
  async getBudgetStatus(orgId: string): Promise<BudgetStatus> {
    const config = await this.getBudgetConfig(orgId);
    const monthlyLimit = config?.monthlyLimitUsd ?? 500;
    const softLimitPercent = config?.softLimitPercent ?? 80;

    // Get current month's spend
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentSpend = await this.getCurrentMonthSpend(orgId, monthStart);

    const percentUsed = monthlyLimit > 0 ? (currentSpend / monthlyLimit) * 100 : 0;
    const projectedMonthEnd = await this.projectMonthlyCost(orgId);

    // Determine status
    let status: BudgetStatus['status'] = 'ok';
    if (percentUsed >= 100) {
      status = 'exceeded';
    } else if (percentUsed >= 90) {
      status = 'critical';
    } else if (percentUsed >= softLimitPercent) {
      status = 'warning';
    }

    const alerts = this.generateBudgetAlerts(
      orgId,
      currentSpend,
      monthlyLimit,
      percentUsed,
      projectedMonthEnd,
      softLimitPercent
    );

    return {
      currentSpend: Math.round(currentSpend * 100) / 100,
      monthlyLimit,
      percentUsed: Math.round(percentUsed * 100) / 100,
      projectedMonthEnd: Math.round(projectedMonthEnd * 100) / 100,
      status,
      alerts,
    };
  }

  /**
   * Set or update budget configuration for an organization
   */
  async setBudget(orgId: string, config: Partial<BudgetConfig>): Promise<BudgetConfig> {
    const existing = await this.getBudgetConfig(orgId);
    const updated: BudgetConfig = {
      organizationId: orgId,
      monthlyLimitUsd: config.monthlyLimitUsd ?? existing?.monthlyLimitUsd ?? 500,
      softLimitPercent: config.softLimitPercent ?? existing?.softLimitPercent ?? 80,
      hardLimitAction: config.hardLimitAction ?? existing?.hardLimitAction ?? 'alert-only',
      modelRoutingRules:
        config.modelRoutingRules ?? existing?.modelRoutingRules ?? DEFAULT_ROUTING_RULES,
      enabled: config.enabled ?? existing?.enabled ?? true,
    };

    // Persist to database
    try {
      await db.llmBudgetConfig.upsert({
        where: { organizationId: orgId },
        create: {
          organizationId: orgId,
          monthlyLimitUsd: updated.monthlyLimitUsd,
          softLimitPercent: updated.softLimitPercent,
          hardLimitAction: updated.hardLimitAction,
          modelRoutingRules: updated.modelRoutingRules,
          enabled: updated.enabled,
        },
        update: {
          monthlyLimitUsd: updated.monthlyLimitUsd,
          softLimitPercent: updated.softLimitPercent,
          hardLimitAction: updated.hardLimitAction,
          modelRoutingRules: updated.modelRoutingRules,
          enabled: updated.enabled,
        },
      });
    } catch (error) {
      log.warn(
        { error, orgId },
        'Failed to persist budget config to database, using in-memory only'
      );
    }

    this.budgetConfigs.set(orgId, updated);
    log.info({ orgId, monthlyLimit: updated.monthlyLimitUsd }, 'Budget config updated');

    return updated;
  }

  /**
   * Check if an org is allowed to make LLM requests
   */
  async checkBudget(
    orgId: string
  ): Promise<{ allowed: boolean; action: 'allowed' | 'blocked' | 'downgraded'; reason?: string }> {
    const config = await this.getBudgetConfig(orgId);

    if (!config?.enabled) {
      return { allowed: true, action: 'allowed', reason: 'Budget controls not enabled' };
    }

    const status = await this.getBudgetStatus(orgId);

    if (status.status === 'exceeded') {
      switch (config.hardLimitAction) {
        case 'block':
          return {
            allowed: false,
            action: 'blocked',
            reason: `Monthly budget of $${config.monthlyLimitUsd} exceeded`,
          };
        case 'downgrade':
          return {
            allowed: true,
            action: 'downgraded',
            reason: 'Budget exceeded, using cheaper models',
          };
        case 'alert-only':
          return { allowed: true, action: 'allowed', reason: 'Budget exceeded, alert-only mode' };
      }
    }

    return { allowed: true, action: 'allowed' };
  }

  /**
   * Project monthly cost based on current usage trends
   */
  async projectMonthlyCost(orgId: string): Promise<number> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const daysElapsed = Math.max(1, (now.getTime() - monthStart.getTime()) / (24 * 60 * 60 * 1000));
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    const currentSpend = await this.getCurrentMonthSpend(orgId, monthStart);
    const dailyRate = currentSpend / daysElapsed;

    return dailyRate * daysInMonth;
  }

  /**
   * Get a downgraded (cheaper) model when budget is tight
   */
  getDowngradedModel(requestedModel: string, budgetStatus: BudgetStatus): string {
    const currentTierIndex = MODEL_TIERS.indexOf(requestedModel);

    if (currentTierIndex <= 0) {
      return requestedModel; // Already cheapest or unknown
    }

    // Downgrade by 1 tier for warning, 2 for critical/exceeded
    const downgradeSteps = budgetStatus.status === 'warning' ? 1 : 2;
    const targetIndex = Math.max(0, currentTierIndex - downgradeSteps);

    return MODEL_TIERS[targetIndex]!;
  }

  /**
   * Get routing rules for an organization
   */
  async getRoutingRules(orgId: string): Promise<ModelRoutingRule[]> {
    const config = await this.getBudgetConfig(orgId);
    return config?.modelRoutingRules?.length ? config.modelRoutingRules : DEFAULT_ROUTING_RULES;
  }

  /**
   * Update routing rules for an organization
   */
  async updateRoutingRules(orgId: string, rules: ModelRoutingRule[]): Promise<ModelRoutingRule[]> {
    await this.setBudget(orgId, { modelRoutingRules: rules });
    return rules;
  }

  /**
   * Get savings report — cost avoided by model routing/downgrading
   */
  async getSavingsReport(orgId: string): Promise<SavingsReport> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let logs: Array<{ model: string; estimatedCost: number; metadata: Record<string, unknown> }> =
      [];
    try {
      logs = await db.lLMUsageLog.findMany({
        where: {
          organizationId: orgId,
          createdAt: { gte: monthStart, lte: now },
        },
        select: { model: true, estimatedCost: true, metadata: true },
      });
    } catch (error) {
      log.warn({ error, orgId }, 'Failed to fetch usage logs for savings report');
    }

    let totalSaved = 0;
    let downgradedRequests = 0;
    const savingsByModel: Record<string, number> = {};

    for (const entry of logs) {
      const meta = entry.metadata as Record<string, unknown> | null;
      if (meta?.originalModel && meta.originalModel !== entry.model) {
        downgradedRequests++;
        const originalCost = MODEL_COSTS[meta.originalModel as string] || DEFAULT_MODEL_COST;
        const actualCost = MODEL_COSTS[entry.model] || DEFAULT_MODEL_COST;
        const saved =
          (originalCost.input + originalCost.output - (actualCost.input + actualCost.output)) /
          1000;
        totalSaved += Math.max(0, saved);

        if (!savingsByModel[entry.model]) savingsByModel[entry.model] = 0;
        savingsByModel[entry.model]! += Math.max(0, saved);
      }
    }

    return {
      totalSaved: Math.round(totalSaved * 100) / 100,
      totalRequests: logs.length,
      downgradedRequests,
      savingsByModel,
      period: { start: monthStart.toISOString(), end: now.toISOString() },
    };
  }

  /**
   * Simulate cost for a hypothetical workload
   */
  async simulateCost(
    orgId: string,
    workload: Array<{ taskType: string; requestCount: number; avgTokens?: number }>
  ): Promise<CostSimulation> {
    const config = await this.getBudgetConfig(orgId);
    const rules = config?.modelRoutingRules?.length
      ? config.modelRoutingRules
      : DEFAULT_ROUTING_RULES;
    const monthlyLimit = config?.monthlyLimitUsd ?? 500;

    const breakdown: CostSimulation['breakdown'] = [];
    let estimatedMonthlyCost = 0;

    for (const item of workload) {
      const rule = rules.find((r) => r.taskType === item.taskType);
      const model = rule?.preferredModel ?? 'gpt-4o';
      const cost = MODEL_COSTS[model] || DEFAULT_MODEL_COST;
      const avgTokens = item.avgTokens ?? 1000;
      const costPerRequest = (cost.input * avgTokens + cost.output * avgTokens) / 1000;
      const totalCost = costPerRequest * item.requestCount;

      breakdown.push({
        taskType: item.taskType,
        model,
        costPerRequest: Math.round(costPerRequest * 10000) / 10000,
        totalCost: Math.round(totalCost * 100) / 100,
      });

      estimatedMonthlyCost += totalCost;
    }

    return {
      estimatedMonthlyCost: Math.round(estimatedMonthlyCost * 100) / 100,
      breakdown,
      budgetImpact: {
        percentOfBudget:
          monthlyLimit > 0 ? Math.round((estimatedMonthlyCost / monthlyLimit) * 10000) / 100 : 0,
        wouldExceed: estimatedMonthlyCost > monthlyLimit,
      },
    };
  }

  /**
   * Check all orgs' budgets and return alerts (used by worker)
   */
  async checkAllOrgBudgets(): Promise<Array<{ orgId: string; status: BudgetStatus }>> {
    const results: Array<{ orgId: string; status: BudgetStatus }> = [];

    try {
      const configs = await db.llmBudgetConfig.findMany({
        where: { enabled: true },
      });

      for (const config of configs) {
        try {
          const status = await this.getBudgetStatus(config.organizationId);
          if (status.status !== 'ok') {
            results.push({ orgId: config.organizationId, status });
          }
        } catch (error) {
          log.error({ error, orgId: config.organizationId }, 'Failed to check budget for org');
        }
      }
    } catch (error) {
      log.warn({ error }, 'Failed to fetch budget configs, skipping bulk check');
    }

    return results;
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private async getBudgetConfig(orgId: string): Promise<BudgetConfig | null> {
    // Check cache first
    const cached = this.budgetConfigs.get(orgId);
    if (cached) return cached;

    // Try database
    try {
      const dbConfig = await db.llmBudgetConfig.findUnique({
        where: { organizationId: orgId },
      });

      if (dbConfig) {
        const config: BudgetConfig = {
          organizationId: dbConfig.organizationId,
          monthlyLimitUsd: dbConfig.monthlyLimitUsd,
          softLimitPercent: dbConfig.softLimitPercent,
          hardLimitAction: dbConfig.hardLimitAction,
          modelRoutingRules: dbConfig.modelRoutingRules as ModelRoutingRule[],
          enabled: dbConfig.enabled,
        };
        this.budgetConfigs.set(orgId, config);
        return config;
      }
    } catch (error) {
      log.debug({ error, orgId }, 'Failed to load budget config from database');
    }

    return null;
  }

  private async getCurrentMonthSpend(orgId: string, monthStart: Date): Promise<number> {
    try {
      const result = await db.lLMUsageLog.aggregate({
        where: {
          organizationId: orgId,
          createdAt: { gte: monthStart },
        },
        _sum: { estimatedCost: true },
      });
      return result._sum?.estimatedCost ?? 0;
    } catch (error) {
      log.warn({ error, orgId }, 'Failed to get current month spend');
      return 0;
    }
  }

  private generateBudgetAlerts(
    _orgId: string,
    currentSpend: number,
    monthlyLimit: number,
    percentUsed: number,
    projectedMonthEnd: number,
    softLimitPercent: number
  ): BudgetAlert[] {
    const alerts: BudgetAlert[] = [];
    const now = new Date();

    if (percentUsed >= 100) {
      alerts.push({
        type: 'error',
        title: 'Budget Exceeded',
        message: `Monthly LLM budget of $${monthlyLimit} has been exceeded. Current spend: $${currentSpend.toFixed(2)}.`,
        timestamp: now,
      });
    } else if (percentUsed >= 90) {
      alerts.push({
        type: 'warning',
        title: 'Budget Critical',
        message: `LLM spend has reached ${percentUsed.toFixed(1)}% of the $${monthlyLimit} monthly budget.`,
        timestamp: now,
      });
    } else if (percentUsed >= softLimitPercent) {
      alerts.push({
        type: 'warning',
        title: 'Budget Warning',
        message: `LLM spend has reached ${percentUsed.toFixed(1)}% of the $${monthlyLimit} monthly budget (soft limit: ${softLimitPercent}%).`,
        timestamp: now,
      });
    }

    if (projectedMonthEnd > monthlyLimit && percentUsed < 100) {
      alerts.push({
        type: 'info',
        title: 'Projected Overage',
        message: `At the current rate, projected month-end spend is $${projectedMonthEnd.toFixed(2)}, exceeding the $${monthlyLimit} budget.`,
        timestamp: now,
      });
    }

    return alerts;
  }
}

export const llmCostOptimizerService = new LLMCostOptimizerService();
