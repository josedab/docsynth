import { Hono } from 'hono';
import { prisma } from '@docsynth/database';
import { requireAuth, requireOrgAccess } from '../middleware/auth.js';
import { NotFoundError, ValidationError } from '@docsynth/utils';
import type { DocTemplate, DocumentType } from '@docsynth/types';

const app = new Hono();

// Default templates for each document type
const defaultTemplates: Record<DocumentType, Omit<DocTemplate, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>> = {
  README: {
    name: 'Standard README',
    description: 'A comprehensive README template with common sections',
    documentType: 'README',
    sections: [
      { id: '1', name: 'header', heading: '# {project_name}', required: true, order: 1, promptHint: 'Generate a brief tagline describing the project' },
      { id: '2', name: 'overview', heading: '## Overview', required: true, order: 2, promptHint: 'Explain what this project does and why it exists' },
      { id: '3', name: 'features', heading: '## Features', required: false, order: 3, promptHint: 'List the main features as bullet points' },
      { id: '4', name: 'quickstart', heading: '## Quick Start', required: true, order: 4, promptHint: 'Provide installation and basic usage instructions' },
      { id: '5', name: 'usage', heading: '## Usage', required: false, order: 5, promptHint: 'Show common usage examples with code' },
      { id: '6', name: 'api', heading: '## API', required: false, order: 6, promptHint: 'Document main API endpoints or functions' },
      { id: '7', name: 'contributing', heading: '## Contributing', required: false, order: 7, promptHint: 'Explain how to contribute to the project' },
      { id: '8', name: 'license', heading: '## License', required: false, order: 8, promptHint: 'State the license' },
    ],
    variables: [
      { name: 'project_name', description: 'Name of the project', required: true },
      { name: 'version', description: 'Current version', required: false, defaultValue: '1.0.0' },
    ],
    style: {
      tone: 'technical',
      includeTableOfContents: true,
      includeBadges: true,
      includeGeneratedNote: true,
      headerFormat: 'atx',
      maxDepth: 3,
    },
    isDefault: true,
  },
  API_REFERENCE: {
    name: 'API Reference',
    description: 'Template for API documentation',
    documentType: 'API_REFERENCE',
    sections: [
      { id: '1', name: 'overview', heading: '# API Reference', required: true, order: 1, promptHint: 'Provide an overview of the API' },
      { id: '2', name: 'authentication', heading: '## Authentication', required: false, order: 2, promptHint: 'Explain authentication methods' },
      { id: '3', name: 'endpoints', heading: '## Endpoints', required: true, order: 3, promptHint: 'Document each endpoint with method, path, parameters, and response' },
      { id: '4', name: 'errors', heading: '## Error Codes', required: false, order: 4, promptHint: 'List common error codes and their meanings' },
      { id: '5', name: 'examples', heading: '## Examples', required: true, order: 5, promptHint: 'Provide request/response examples' },
    ],
    variables: [
      { name: 'base_url', description: 'Base URL for the API', required: true },
      { name: 'api_version', description: 'API version', required: false, defaultValue: 'v1' },
    ],
    style: {
      tone: 'technical',
      includeTableOfContents: true,
      includeBadges: false,
      includeGeneratedNote: true,
      headerFormat: 'atx',
      maxDepth: 4,
    },
    isDefault: true,
  },
  CHANGELOG: {
    name: 'Keep a Changelog',
    description: 'Following the Keep a Changelog format',
    documentType: 'CHANGELOG',
    sections: [
      { id: '1', name: 'header', heading: '# Changelog', required: true, order: 1, promptHint: 'Standard changelog header' },
      { id: '2', name: 'unreleased', heading: '## [Unreleased]', required: false, order: 2, promptHint: 'Changes not yet released' },
      { id: '3', name: 'version', heading: '## [{version}] - {date}', required: true, order: 3, promptHint: 'Document changes for this version' },
    ],
    variables: [
      { name: 'version', description: 'Version number', required: true },
      { name: 'date', description: 'Release date', required: true },
    ],
    style: {
      tone: 'formal',
      includeTableOfContents: false,
      includeBadges: false,
      includeGeneratedNote: false,
      headerFormat: 'atx',
      maxDepth: 2,
    },
    isDefault: true,
  },
  GUIDE: {
    name: 'User Guide',
    description: 'Template for user guides and tutorials',
    documentType: 'GUIDE',
    sections: [
      { id: '1', name: 'intro', heading: '# {title}', required: true, order: 1, promptHint: 'Introduce what this guide covers' },
      { id: '2', name: 'prerequisites', heading: '## Prerequisites', required: false, order: 2, promptHint: 'List what users need before starting' },
      { id: '3', name: 'steps', heading: '## Step-by-Step', required: true, order: 3, promptHint: 'Provide detailed steps with explanations' },
      { id: '4', name: 'troubleshooting', heading: '## Troubleshooting', required: false, order: 4, promptHint: 'Common issues and solutions' },
      { id: '5', name: 'next', heading: '## Next Steps', required: false, order: 5, promptHint: 'What to learn or do next' },
    ],
    variables: [
      { name: 'title', description: 'Guide title', required: true },
    ],
    style: {
      tone: 'casual',
      includeTableOfContents: true,
      includeBadges: false,
      includeGeneratedNote: true,
      headerFormat: 'atx',
      maxDepth: 3,
    },
    isDefault: true,
  },
  TUTORIAL: {
    name: 'Tutorial',
    description: 'Step-by-step tutorial template',
    documentType: 'TUTORIAL',
    sections: [
      { id: '1', name: 'intro', heading: '# {title}', required: true, order: 1, promptHint: 'Introduce the tutorial goal' },
      { id: '2', name: 'whatyoulllearn', heading: '## What You\'ll Learn', required: true, order: 2, promptHint: 'List learning outcomes' },
      { id: '3', name: 'setup', heading: '## Setup', required: true, order: 3, promptHint: 'Environment setup instructions' },
      { id: '4', name: 'walkthrough', heading: '## Walkthrough', required: true, order: 4, promptHint: 'Main tutorial content with code examples' },
      { id: '5', name: 'summary', heading: '## Summary', required: true, order: 5, promptHint: 'Recap what was learned' },
    ],
    variables: [
      { name: 'title', description: 'Tutorial title', required: true },
      { name: 'difficulty', description: 'Difficulty level', required: false, defaultValue: 'Intermediate' },
    ],
    style: {
      tone: 'casual',
      includeTableOfContents: true,
      includeBadges: true,
      includeGeneratedNote: true,
      headerFormat: 'atx',
      maxDepth: 3,
    },
    isDefault: true,
  },
  ARCHITECTURE: {
    name: 'Architecture Document',
    description: 'System architecture documentation',
    documentType: 'ARCHITECTURE',
    sections: [
      { id: '1', name: 'overview', heading: '# Architecture Overview', required: true, order: 1, promptHint: 'High-level system description' },
      { id: '2', name: 'components', heading: '## Components', required: true, order: 2, promptHint: 'Describe main components' },
      { id: '3', name: 'dataflow', heading: '## Data Flow', required: false, order: 3, promptHint: 'How data moves through the system' },
      { id: '4', name: 'diagrams', heading: '## Diagrams', required: false, order: 4, promptHint: 'Architecture diagrams' },
      { id: '5', name: 'decisions', heading: '## Key Decisions', required: false, order: 5, promptHint: 'Important architectural decisions' },
    ],
    variables: [],
    style: {
      tone: 'technical',
      includeTableOfContents: true,
      includeBadges: false,
      includeGeneratedNote: true,
      headerFormat: 'atx',
      maxDepth: 3,
    },
    isDefault: true,
  },
  ADR: {
    name: 'Architecture Decision Record',
    description: 'ADR template following standard format',
    documentType: 'ADR',
    sections: [
      { id: '1', name: 'title', heading: '# ADR-{number}: {title}', required: true, order: 1, promptHint: 'ADR title' },
      { id: '2', name: 'status', heading: '## Status', required: true, order: 2, promptHint: 'Proposed, Accepted, Deprecated, Superseded' },
      { id: '3', name: 'context', heading: '## Context', required: true, order: 3, promptHint: 'Describe the issue motivating this decision' },
      { id: '4', name: 'decision', heading: '## Decision', required: true, order: 4, promptHint: 'Describe the decision and rationale' },
      { id: '5', name: 'consequences', heading: '## Consequences', required: true, order: 5, promptHint: 'Describe resulting context after applying the decision' },
    ],
    variables: [
      { name: 'number', description: 'ADR number', required: true },
      { name: 'title', description: 'Decision title', required: true },
    ],
    style: {
      tone: 'formal',
      includeTableOfContents: false,
      includeBadges: false,
      includeGeneratedNote: false,
      headerFormat: 'atx',
      maxDepth: 2,
    },
    isDefault: true,
  },
  INLINE_COMMENT: {
    name: 'Inline Comment',
    description: 'Template for code comments',
    documentType: 'INLINE_COMMENT',
    sections: [
      { id: '1', name: 'summary', heading: '', required: true, order: 1, promptHint: 'Brief one-line summary' },
      { id: '2', name: 'description', heading: '', required: false, order: 2, promptHint: 'Detailed description if needed' },
      { id: '3', name: 'params', heading: '@param', required: false, order: 3, promptHint: 'Document parameters' },
      { id: '4', name: 'returns', heading: '@returns', required: false, order: 4, promptHint: 'Document return value' },
    ],
    variables: [],
    style: {
      tone: 'technical',
      includeTableOfContents: false,
      includeBadges: false,
      includeGeneratedNote: false,
      headerFormat: 'atx',
      maxDepth: 1,
    },
    isDefault: true,
  },
};

// List all templates for organization
app.get('/', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const { documentType } = c.req.query();

  // Get custom templates from database
  const customTemplates = await prisma.docTemplate.findMany({
    where: {
      organizationId: orgId,
      ...(documentType && { documentType: documentType as DocumentType }),
    },
    orderBy: { name: 'asc' },
  });

  // Combine with default templates
  const allTemplates = [
    ...Object.values(defaultTemplates)
      .filter(t => !documentType || t.documentType === documentType)
      .map(t => ({
        ...t,
        id: `default-${t.documentType}`,
        organizationId: orgId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    ...customTemplates.map(t => ({
      ...t,
      sections: t.sections as unknown as DocTemplate['sections'],
      variables: t.variables as unknown as DocTemplate['variables'],
      style: t.style as unknown as DocTemplate['style'],
    })),
  ];

  return c.json({
    success: true,
    data: allTemplates,
  });
});

// Get a specific template
app.get('/:templateId', requireAuth, requireOrgAccess, async (c) => {
  const templateId = c.req.param('templateId');
  const orgId = c.get('organizationId');

  // Check if it's a default template
  if (templateId.startsWith('default-')) {
    const docType = templateId.replace('default-', '') as DocumentType;
    const template = defaultTemplates[docType];
    if (template) {
      return c.json({
        success: true,
        data: {
          ...template,
          id: templateId,
          organizationId: orgId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
  }

  const template = await prisma.docTemplate.findFirst({
    where: { id: templateId, organizationId: orgId },
  });

  if (!template) {
    throw new NotFoundError('Template', templateId);
  }

  return c.json({
    success: true,
    data: {
      ...template,
      sections: template.sections as unknown as DocTemplate['sections'],
      variables: template.variables as unknown as DocTemplate['variables'],
      style: template.style as unknown as DocTemplate['style'],
    },
  });
});

// Create a custom template
app.post('/', requireAuth, requireOrgAccess, async (c) => {
  const orgId = c.get('organizationId');
  const body = await c.req.json<Partial<DocTemplate>>();

  if (!body.name || !body.documentType) {
    throw new ValidationError('name and documentType are required');
  }

  const template = await prisma.docTemplate.create({
    data: {
      organizationId: orgId,
      name: body.name,
      description: body.description ?? '',
      documentType: body.documentType,
      sections: JSON.parse(JSON.stringify(body.sections ?? [])),
      variables: JSON.parse(JSON.stringify(body.variables ?? [])),
      style: JSON.parse(JSON.stringify(body.style ?? defaultTemplates[body.documentType]?.style ?? {})),
      isDefault: false,
    },
  });

  return c.json({
    success: true,
    data: template,
  }, 201);
});

// Update a template
app.put('/:templateId', requireAuth, requireOrgAccess, async (c) => {
  const templateId = c.req.param('templateId');
  const orgId = c.get('organizationId');
  const body = await c.req.json<Partial<DocTemplate>>();

  if (templateId.startsWith('default-')) {
    throw new ValidationError('Cannot modify default templates. Create a custom template instead.');
  }

  const template = await prisma.docTemplate.update({
    where: { id: templateId, organizationId: orgId },
    data: {
      ...(body.name && { name: body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.sections && { sections: JSON.parse(JSON.stringify(body.sections)) }),
      ...(body.variables && { variables: JSON.parse(JSON.stringify(body.variables)) }),
      ...(body.style && { style: JSON.parse(JSON.stringify(body.style)) }),
    },
  });

  return c.json({
    success: true,
    data: template,
  });
});

// Delete a template
app.delete('/:templateId', requireAuth, requireOrgAccess, async (c) => {
  const templateId = c.req.param('templateId');
  const orgId = c.get('organizationId');

  if (templateId.startsWith('default-')) {
    throw new ValidationError('Cannot delete default templates');
  }

  await prisma.docTemplate.delete({
    where: { id: templateId, organizationId: orgId },
  });

  return c.json({
    success: true,
    data: { deleted: true },
  });
});

// Preview template rendering
app.post('/:templateId/preview', requireAuth, requireOrgAccess, async (c) => {
  const templateId = c.req.param('templateId');
  const orgId = c.get('organizationId');
  const body = await c.req.json<{ variables?: Record<string, string> }>();

  let template: DocTemplate;

  if (templateId.startsWith('default-')) {
    const docType = templateId.replace('default-', '') as DocumentType;
    const defaultTemplate = defaultTemplates[docType];
    if (!defaultTemplate) {
      throw new NotFoundError('Template', templateId);
    }
    template = {
      ...defaultTemplate,
      id: templateId,
      organizationId: orgId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  } else {
    const dbTemplate = await prisma.docTemplate.findFirst({
      where: { id: templateId, organizationId: orgId },
    });
    if (!dbTemplate) {
      throw new NotFoundError('Template', templateId);
    }
    template = {
      ...dbTemplate,
      sections: dbTemplate.sections as unknown as DocTemplate['sections'],
      variables: dbTemplate.variables as unknown as DocTemplate['variables'],
      style: dbTemplate.style as unknown as DocTemplate['style'],
    };
  }

  // Render preview
  const variables = body.variables ?? {};
  let preview = '';

  for (const section of template.sections.sort((a, b) => a.order - b.order)) {
    let heading = section.heading;
    
    // Replace variables in heading
    for (const [key, value] of Object.entries(variables)) {
      heading = heading.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }

    preview += `${heading}\n\n`;
    preview += `<!-- ${section.promptHint} -->\n\n`;
    if (section.defaultContent) {
      preview += `${section.defaultContent}\n\n`;
    } else {
      preview += `[Content will be generated here]\n\n`;
    }
  }

  if (template.style.includeGeneratedNote) {
    preview += '\n---\n*Generated by DocSynth*\n';
  }

  return c.json({
    success: true,
    data: {
      preview,
      template,
    },
  });
});

export { app as templateRoutes };
