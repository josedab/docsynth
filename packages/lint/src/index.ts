export {
  lint,
  lintMultiple,
  type LintRule,
  type LintContext,
  type LintConfig,
  type LintIssue,
  type LintResult,
  type SourceFileInfo,
  type ExportedSymbol,
} from './linter.js';

export { DEFAULT_CONFIG, loadConfig, mergeConfig } from './config.js';

export { builtInRules } from './rules/index.js';
