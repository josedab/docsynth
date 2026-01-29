import { describe, it, expect } from 'vitest';
import type {
  SubscriptionTier,
  UserRole,
  DocumentType,
  PRAction,
  ChangePriority,
  SemanticChangeType,
  JobStatus,
  SubscriptionStatus,
  AuditAction,
  ContextSourceType,
} from '../index.js';

describe('Types Package', () => {
  describe('SubscriptionTier', () => {
    it('should have valid subscription tiers', () => {
      const tiers: SubscriptionTier[] = ['FREE', 'PRO', 'TEAM', 'ENTERPRISE'];
      expect(tiers).toHaveLength(4);
      expect(tiers).toContain('FREE');
      expect(tiers).toContain('PRO');
      expect(tiers).toContain('TEAM');
      expect(tiers).toContain('ENTERPRISE');
    });
  });

  describe('UserRole', () => {
    it('should have valid user roles', () => {
      const roles: UserRole[] = ['owner', 'admin', 'member', 'viewer'];
      expect(roles).toHaveLength(4);
      expect(roles).toContain('owner');
      expect(roles).toContain('admin');
      expect(roles).toContain('member');
      expect(roles).toContain('viewer');
    });
  });

  describe('DocumentType', () => {
    it('should have valid document types', () => {
      const docTypes: DocumentType[] = [
        'README',
        'API_REFERENCE',
        'CHANGELOG',
        'GUIDE',
        'TUTORIAL',
        'ARCHITECTURE',
        'ADR',
        'INLINE_COMMENT',
      ];
      expect(docTypes).toHaveLength(8);
      expect(docTypes).toContain('README');
      expect(docTypes).toContain('CHANGELOG');
      expect(docTypes).toContain('API_REFERENCE');
    });
  });

  describe('PRAction', () => {
    it('should have valid PR actions', () => {
      const actions: PRAction[] = ['opened', 'closed', 'merged', 'synchronize', 'edited'];
      expect(actions).toHaveLength(5);
      expect(actions).toContain('merged');
      expect(actions).toContain('opened');
    });
  });

  describe('ChangePriority', () => {
    it('should have valid change priorities', () => {
      const priorities: ChangePriority[] = ['critical', 'high', 'medium', 'low', 'none'];
      expect(priorities).toHaveLength(5);
      expect(priorities).toContain('critical');
      expect(priorities).toContain('none');
    });
  });

  describe('SemanticChangeType', () => {
    it('should have valid semantic change types', () => {
      const changeTypes: SemanticChangeType[] = [
        'new-export',
        'new-function',
        'new-class',
        'new-interface',
        'new-type',
        'api-change',
        'signature-change',
        'deprecation',
        'removal',
        'logic-change',
      ];
      expect(changeTypes).toHaveLength(10);
      expect(changeTypes).toContain('new-function');
      expect(changeTypes).toContain('api-change');
    });
  });

  describe('JobStatus', () => {
    it('should have valid job statuses', () => {
      const statuses: JobStatus[] = [
        'PENDING',
        'ANALYZING',
        'INFERRING',
        'GENERATING',
        'REVIEWING',
        'COMPLETED',
        'FAILED',
      ];
      expect(statuses).toHaveLength(7);
      expect(statuses).toContain('PENDING');
      expect(statuses).toContain('COMPLETED');
      expect(statuses).toContain('FAILED');
    });
  });

  describe('SubscriptionStatus', () => {
    it('should have valid subscription statuses', () => {
      const statuses: SubscriptionStatus[] = [
        'ACTIVE',
        'CANCELED',
        'PAST_DUE',
        'TRIALING',
        'UNPAID',
      ];
      expect(statuses).toHaveLength(5);
      expect(statuses).toContain('ACTIVE');
      expect(statuses).toContain('CANCELED');
    });
  });

  describe('AuditAction', () => {
    it('should have valid audit actions', () => {
      const actions: AuditAction[] = [
        'create',
        'update',
        'delete',
        'enable',
        'disable',
        'generate',
        'approve',
        'reject',
        'login',
        'logout',
      ];
      expect(actions).toHaveLength(10);
      expect(actions).toContain('create');
      expect(actions).toContain('delete');
    });
  });

  describe('ContextSourceType', () => {
    it('should have valid context source types', () => {
      const sources: ContextSourceType[] = [
        'pr',
        'commit',
        'jira',
        'linear',
        'slack',
        'confluence',
      ];
      expect(sources).toHaveLength(6);
      expect(sources).toContain('pr');
      expect(sources).toContain('jira');
    });
  });
});
