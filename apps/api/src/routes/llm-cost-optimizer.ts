/**
 * LLM Cost Optimizer Routes
 *
 * API endpoints for LLM cost optimization, budget controls,
 * model routing, and cost projections.
 */

import { Hono } from 'hono';
import { createLogger } from '@docsynth/utils';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { llmCostOptimizerService } from '../services/llm-cost-optimizer.service.js';

const log = createLogger('llm-cost-optimizer-routes');

const app = new Hono();

/**
 * Get budget status for an organization
 */
app.get('/budget/:orgId', requireAuth, requireOrgAccess, async (c) => {
  const org = (c as any).get('organization') as { id: string };

  try {
    const status = await llmCostOptimizerService.getBudgetStatus(org.id);
    return c.json({ success: true, data: status });
  } catch (error) {
    log.error({ error, orgId: org.id }, 'Failed to get budget status');
    return c.json({ success: false, error: 'Failed to get budget status' }, 500);
  }
});

/**
 * Set or update budget configuration
 */
app.put('/budget/:orgId', requireAuth, requireOrgAccess, async (c) => {
  const org = (c as any).get('organization') as { id: string };

  try {
    const body = await c.req.json();
    const config = await llmCostOptimizerService.setBudget(org.id, body);
    return c.json({ success: true, data: config });
  } catch (error) {
    log.error({ error, orgId: org.id }, 'Failed to update budget');
    return c.json({ success: false, error: 'Failed to update budget' }, 500);
  }
});

/**
 * Get model routing rules for an organization
 */
app.get('/routing-rules/:orgId', requireAuth, requireOrgAccess, async (c) => {
  const org = (c as any).get('organization') as { id: string };

  try {
    const rules = await llmCostOptimizerService.getRoutingRules(org.id);
    return c.json({ success: true, data: { rules } });
  } catch (error) {
    log.error({ error, orgId: org.id }, 'Failed to get routing rules');
    return c.json({ success: false, error: 'Failed to get routing rules' }, 500);
  }
});

/**
 * Update model routing rules
 */
app.put('/routing-rules/:orgId', requireAuth, requireOrgAccess, async (c) => {
  const org = (c as any).get('organization') as { id: string };

  try {
    const body = await c.req.json();
    const rules = await llmCostOptimizerService.updateRoutingRules(org.id, body.rules);
    return c.json({ success: true, data: { rules } });
  } catch (error) {
    log.error({ error, orgId: org.id }, 'Failed to update routing rules');
    return c.json({ success: false, error: 'Failed to update routing rules' }, 500);
  }
});

/**
 * Select optimal model for a task
 */
app.post('/select-model', requireAuth, requireOrgAccess, async (c) => {
  const org = (c as any).get('organization') as { id: string };

  try {
    const body = await c.req.json();
    const { taskType, complexity } = body;

    if (!taskType || !complexity) {
      return c.json({ success: false, error: 'taskType and complexity are required' }, 400);
    }

    const selection = await llmCostOptimizerService.selectOptimalModel(
      org.id,
      taskType,
      complexity
    );
    return c.json({ success: true, data: selection });
  } catch (error) {
    log.error({ error }, 'Failed to select model');
    return c.json({ success: false, error: 'Failed to select model' }, 500);
  }
});

/**
 * Get cost projections for an organization
 */
app.get('/projections/:orgId', requireAuth, requireOrgAccess, async (c) => {
  const org = (c as any).get('organization') as { id: string };

  try {
    const projectedCost = await llmCostOptimizerService.projectMonthlyCost(org.id);
    const budgetStatus = await llmCostOptimizerService.getBudgetStatus(org.id);

    return c.json({
      success: true,
      data: {
        projectedMonthEnd: Math.round(projectedCost * 100) / 100,
        currentSpend: budgetStatus.currentSpend,
        monthlyLimit: budgetStatus.monthlyLimit,
        percentUsed: budgetStatus.percentUsed,
        daysRemaining: Math.ceil(
          (new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getTime() -
            Date.now()) /
            (24 * 60 * 60 * 1000)
        ),
      },
    });
  } catch (error) {
    log.error({ error, orgId: org.id }, 'Failed to get projections');
    return c.json({ success: false, error: 'Failed to get projections' }, 500);
  }
});

/**
 * Get savings report
 */
app.get('/savings/:orgId', requireAuth, requireOrgAccess, async (c) => {
  const org = (c as any).get('organization') as { id: string };

  try {
    const report = await llmCostOptimizerService.getSavingsReport(org.id);
    return c.json({ success: true, data: report });
  } catch (error) {
    log.error({ error, orgId: org.id }, 'Failed to get savings report');
    return c.json({ success: false, error: 'Failed to get savings report' }, 500);
  }
});

/**
 * Simulate cost for a hypothetical workload
 */
app.post('/simulate', requireAuth, requireOrgAccess, async (c) => {
  const org = (c as any).get('organization') as { id: string };

  try {
    const body = await c.req.json();
    const { workload } = body;

    if (!workload || !Array.isArray(workload)) {
      return c.json({ success: false, error: 'workload array is required' }, 400);
    }

    const simulation = await llmCostOptimizerService.simulateCost(org.id, workload);
    return c.json({ success: true, data: simulation });
  } catch (error) {
    log.error({ error }, 'Failed to simulate cost');
    return c.json({ success: false, error: 'Failed to simulate cost' }, 500);
  }
});

export { app as llmCostOptimizerRoutes };
