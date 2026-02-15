import { describe, it, expect } from 'vitest';

describe('@docsynth/github-action', () => {
  describe('action configuration', () => {
    it('should have required inputs defined', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const actionYml = fs.readFileSync(path.resolve(__dirname, '../../action.yml'), 'utf-8');
      expect(actionYml).toContain('github-token');
      expect(actionYml).toContain('llm-provider');
      expect(actionYml).toContain('doc-types');
      expect(actionYml).toContain('output-mode');
      expect(actionYml).toContain('dry-run');
    });

    it('should have outputs defined', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const actionYml = fs.readFileSync(path.resolve(__dirname, '../../action.yml'), 'utf-8');
      expect(actionYml).toContain('impact-score');
      expect(actionYml).toContain('changed-docs');
      expect(actionYml).toContain('generated-files');
    });

    it('should use node20 runtime', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const actionYml = fs.readFileSync(path.resolve(__dirname, '../../action.yml'), 'utf-8');
      expect(actionYml).toContain('node20');
    });
  });
});
