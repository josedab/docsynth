import type { LintRule } from '../linter.js';

import { missingApiDocsRule } from './missing-api-docs.js';
import { staleReferenceRule } from './stale-reference.js';
import { brokenInternalLinkRule } from './broken-internal-link.js';
import { missingCodeExamplesRule } from './missing-code-examples.js';
import { outdatedVersionReferenceRule } from './outdated-version-reference.js';
import { incompleteParameterDocsRule } from './incomplete-parameter-docs.js';
import { missingReturnTypeDocsRule } from './missing-return-type-docs.js';
import { emptySectionRule } from './empty-section.js';

export {
  missingApiDocsRule,
  staleReferenceRule,
  brokenInternalLinkRule,
  missingCodeExamplesRule,
  outdatedVersionReferenceRule,
  incompleteParameterDocsRule,
  missingReturnTypeDocsRule,
  emptySectionRule,
};

export const builtInRules: LintRule[] = [
  missingApiDocsRule,
  staleReferenceRule,
  brokenInternalLinkRule,
  missingCodeExamplesRule,
  outdatedVersionReferenceRule,
  incompleteParameterDocsRule,
  missingReturnTypeDocsRule,
  emptySectionRule,
];
