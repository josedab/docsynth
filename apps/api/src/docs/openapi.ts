import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';

// Create OpenAPI app for documentation
export const docsApp = new OpenAPIHono();

// OpenAPI specification
const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'DocSynth API',
    version: '1.0.0',
    description: `
# DocSynth API Documentation

DocSynth is an AI-powered documentation generator that automatically creates and maintains documentation from your codebase.

## Features

- **Smart Documentation Testing** - Validate documentation examples with CI integration
- **Knowledge Graph Visualization** - Explore relationships between code entities
- **Multi-Language Translation** - Translate documentation to multiple languages
- **Real-Time Collaborative Editing** - Edit documentation with your team in real-time
- **AI-Powered Chat** - Ask questions about your documentation
- **Video Documentation Generation** - Create video tutorials from docs
- **Compliance & Security Module** - Generate SOC2, GDPR, HIPAA documentation
- **Health Score & Gamification** - Track documentation health with badges and leaderboards
- **Self-Healing Documentation** - Automatically fix broken links and outdated references
- **Smart Migration Engine** - Import documentation from Confluence, Notion, GitBook, and markdown repos
- **Webhook-less Polling** - Alternative to webhooks via scheduled GitHub API polling
- **Doc Impact Analysis** - Analyze which docs become stale when PRs are merged
- **AI Documentation Testing** - Extract and execute code examples from docs with CI integration
- **Personalized Onboarding Paths** - Role-specific developer onboarding with progressive learning
- **Multi-Repository Documentation Graph** - Unified knowledge graph across all org repositories
- **Multi-SCM Support** - GitLab and Bitbucket support alongside GitHub
- **Natural Language Doc Editing** - Modify documentation through natural language commands
- **Documentation Analytics & ROI Dashboard** - Track documentation usage, productivity gains, and return on investment

## Authentication

All API endpoints require authentication via Bearer token in the Authorization header:

\`\`\`
Authorization: Bearer <your-jwt-token>
\`\`\`

## Rate Limiting

- Standard endpoints: 100 requests/minute
- AI-powered endpoints: 20 requests/minute

## Webhooks

DocSynth integrates with GitHub webhooks to automatically trigger documentation updates on code changes.
    `,
    contact: {
      name: 'DocSynth Support',
      email: 'support@docsynth.io',
      url: 'https://docsynth.io',
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT',
    },
  },
  servers: [
    {
      url: 'http://localhost:3001',
      description: 'Development server',
    },
    {
      url: 'https://api.docsynth.io',
      description: 'Production server',
    },
  ],
  tags: [
    { name: 'Health', description: 'API health and status endpoints' },
    { name: 'Auth', description: 'Authentication endpoints' },
    { name: 'Repositories', description: 'Repository management' },
    { name: 'Documents', description: 'Document management' },
    { name: 'Health Dashboard', description: 'Documentation health monitoring and gamification' },
    { name: 'Translation', description: 'Multi-language translation' },
    { name: 'Knowledge Graph', description: 'Code knowledge graph visualization' },
    { name: 'Collaborative', description: 'Real-time collaborative editing' },
    { name: 'Compliance', description: 'Compliance and security documentation' },
    { name: 'Video Docs', description: 'Video documentation generation' },
    { name: 'Self-Healing', description: 'Automatic documentation fixing' },
    { name: 'Doc Tests', description: 'Documentation testing and validation' },
    { name: 'Chat', description: 'AI-powered documentation chat' },
    { name: 'LLM Usage', description: 'LLM token usage, costs, and observability' },
    { name: 'Interactive Playground', description: 'Interactive code playgrounds with AI hints' },
    { name: 'AI Doc Editor', description: 'AI-powered documentation editing suggestions' },
    { name: 'Community', description: 'Community features, discussions, and badges' },
    { name: 'Hub', description: 'Documentation hub and navigation' },
    { name: 'Review Documentation', description: 'AI code review documentation' },
    { name: 'Coverage Gate', description: 'Documentation coverage CI/CD gate' },
    { name: 'Polling', description: 'Webhook-less change detection via polling' },
    { name: 'Doc Impact', description: 'PR documentation impact analysis' },
    { name: 'Migration', description: 'Smart migration engine for importing docs' },
    { name: 'Doc Testing V2', description: 'AI documentation testing with code execution' },
    { name: 'Onboarding Paths', description: 'Personalized developer onboarding paths' },
    { name: 'Multi-Repo Graph', description: 'Multi-repository documentation graph' },
    { name: 'SCM Providers', description: 'Multi-SCM provider support (GitHub, GitLab, Bitbucket)' },
    { name: 'NL Editor', description: 'Natural language documentation editing' },
    { name: 'ROI Analytics', description: 'Documentation analytics and ROI dashboard' },
  ],
  paths: {
    // Health
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        description: 'Check if the API is running and healthy',
        responses: {
          '200': {
            description: 'API is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    timestamp: { type: 'string', format: 'date-time' },
                    version: { type: 'string', example: '1.0.0' },
                  },
                },
              },
            },
          },
        },
      },
    },

    // Repositories
    '/api/repositories': {
      get: {
        tags: ['Repositories'],
        summary: 'List repositories',
        description: 'Get all repositories for the authenticated organization',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          '200': {
            description: 'List of repositories',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        repositories: { type: 'array', items: { $ref: '#/components/schemas/Repository' } },
                        pagination: { $ref: '#/components/schemas/Pagination' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    // Documents
    '/api/documents': {
      get: {
        tags: ['Documents'],
        summary: 'List documents',
        description: 'Get all documents for a repository',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'repositoryId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'type', in: 'query', schema: { $ref: '#/components/schemas/DocumentType' } },
        ],
        responses: {
          '200': {
            description: 'List of documents',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { type: 'array', items: { $ref: '#/components/schemas/Document' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/documents/{documentId}': {
      get: {
        tags: ['Documents'],
        summary: 'Get document',
        description: 'Get a specific document by ID',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'documentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Document details',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/Document' },
                  },
                },
              },
            },
          },
          '404': { description: 'Document not found' },
        },
      },
    },

    // Health Dashboard
    '/api/health-dashboard/overview': {
      get: {
        tags: ['Health Dashboard'],
        summary: 'Get health overview',
        description: 'Get organization-wide documentation health overview',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'days', in: 'query', schema: { type: 'integer', default: 30 } },
        ],
        responses: {
          '200': {
            description: 'Health overview',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        overallScore: { type: 'number' },
                        totalRepositories: { type: 'integer' },
                        totalDocuments: { type: 'integer' },
                        healthDistribution: {
                          type: 'object',
                          properties: {
                            healthy: { type: 'integer' },
                            needsAttention: { type: 'integer' },
                            critical: { type: 'integer' },
                          },
                        },
                        topPerformers: { type: 'array', items: { $ref: '#/components/schemas/LeaderboardEntry' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/health-dashboard/leaderboard': {
      get: {
        tags: ['Health Dashboard'],
        summary: 'Get leaderboard',
        description: 'Get documentation health leaderboard with rankings',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'period', in: 'query', schema: { type: 'string', enum: ['weekly', 'monthly', 'all-time'] } },
        ],
        responses: {
          '200': {
            description: 'Leaderboard entries',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        period: { type: 'string' },
                        entries: { type: 'array', items: { $ref: '#/components/schemas/LeaderboardEntry' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/health-dashboard/achievements/{userId}': {
      get: {
        tags: ['Health Dashboard'],
        summary: 'Get user achievements',
        description: 'Get badges and achievements for a user',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'User achievements',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        level: { type: 'integer' },
                        currentXp: { type: 'integer' },
                        xpForNextLevel: { type: 'integer' },
                        badges: { type: 'array', items: { $ref: '#/components/schemas/Badge' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    // Translation
    '/api/multi-lang/batch': {
      post: {
        tags: ['Translation'],
        summary: 'Batch translate documents',
        description: 'Translate multiple documents to a target language',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['documentIds', 'targetLocale'],
                properties: {
                  documentIds: { type: 'array', items: { type: 'string' } },
                  targetLocale: { type: 'string', example: 'es' },
                  priority: { type: 'string', enum: ['low', 'normal', 'high'] },
                },
              },
            },
          },
        },
        responses: {
          '202': {
            description: 'Translation jobs queued',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        jobIds: { type: 'array', items: { type: 'string' } },
                        documentsQueued: { type: 'integer' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/multi-lang/glossaries': {
      get: {
        tags: ['Translation'],
        summary: 'List glossary entries',
        description: 'Get all glossary entries for the organization',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'locale', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Glossary entries',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { type: 'array', items: { $ref: '#/components/schemas/GlossaryEntry' } },
                  },
                },
              },
            },
          },
        },
      },
    },

    // Knowledge Graph
    '/api/knowledge-graph/{repositoryId}': {
      get: {
        tags: ['Knowledge Graph'],
        summary: 'Get knowledge graph',
        description: 'Get the full knowledge graph for a repository',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'repositoryId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Knowledge graph data',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        entities: { type: 'array', items: { $ref: '#/components/schemas/KnowledgeEntity' } },
                        relations: { type: 'array', items: { $ref: '#/components/schemas/KnowledgeRelation' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/knowledge-graph/{repositoryId}/clusters': {
      get: {
        tags: ['Knowledge Graph'],
        summary: 'Get graph clusters',
        description: 'Detect and return clusters/communities in the knowledge graph',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'repositoryId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'minSize', in: 'query', schema: { type: 'integer', default: 3 } },
        ],
        responses: {
          '200': {
            description: 'Graph clusters',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { type: 'array', items: { $ref: '#/components/schemas/GraphCluster' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/knowledge-graph/{repositoryId}/path/{fromId}/{toId}': {
      get: {
        tags: ['Knowledge Graph'],
        summary: 'Find shortest path',
        description: 'Find the shortest path between two entities',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'repositoryId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'fromId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'toId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Path between entities',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        path: { type: 'array', items: { $ref: '#/components/schemas/KnowledgeEntity' } },
                        length: { type: 'integer' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    // Collaborative Editing
    '/api/collaborative/documents/{documentId}/session': {
      get: {
        tags: ['Collaborative'],
        summary: 'Get edit session',
        description: 'Get the current collaborative edit session for a document',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'documentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Edit session details',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/EditSession' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/collaborative/documents/{documentId}/comments': {
      get: {
        tags: ['Collaborative'],
        summary: 'Get document comments',
        description: 'Get all comments on a document',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'documentId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'resolved', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: {
          '200': {
            description: 'Document comments',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { type: 'array', items: { $ref: '#/components/schemas/Comment' } },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Collaborative'],
        summary: 'Add comment',
        description: 'Add a comment to a document',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'documentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['text', 'lineStart', 'lineEnd'],
                properties: {
                  text: { type: 'string' },
                  lineStart: { type: 'integer' },
                  lineEnd: { type: 'integer' },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Comment created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/Comment' },
                  },
                },
              },
            },
          },
        },
      },
    },

    // Compliance
    '/api/compliance/assess': {
      post: {
        tags: ['Compliance'],
        summary: 'Run compliance assessment',
        description: 'Run a compliance assessment against a framework',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['repositoryId', 'framework'],
                properties: {
                  repositoryId: { type: 'string' },
                  framework: { $ref: '#/components/schemas/ComplianceFramework' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Assessment results',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/ComplianceAssessment' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/compliance/frameworks': {
      get: {
        tags: ['Compliance'],
        summary: 'List compliance frameworks',
        description: 'Get all supported compliance frameworks',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Available frameworks',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          name: { type: 'string' },
                          description: { type: 'string' },
                          categories: { type: 'array', items: { type: 'string' } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    // Video Documentation
    '/api/video-docs/generate-script': {
      post: {
        tags: ['Video Docs'],
        summary: 'Generate video script',
        description: 'Generate a video script from a document',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['documentId'],
                properties: {
                  documentId: { type: 'string' },
                  style: { type: 'string', enum: ['screencast', 'animated-slides', 'code-walkthrough'] },
                  maxDuration: { type: 'integer', description: 'Max duration in seconds' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Generated script',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/VideoScript' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/video-docs/render': {
      post: {
        tags: ['Video Docs'],
        summary: 'Queue video render',
        description: 'Queue a video script for rendering',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['scriptId'],
                properties: {
                  scriptId: { type: 'string' },
                  quality: { type: 'string', enum: ['low', 'medium', 'high', '4k'] },
                  format: { type: 'string', enum: ['mp4', 'webm'] },
                },
              },
            },
          },
        },
        responses: {
          '202': {
            description: 'Render job queued',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/RenderJob' },
                  },
                },
              },
            },
          },
        },
      },
    },

    // Self-Healing
    '/api/self-healing/scan': {
      post: {
        tags: ['Self-Healing'],
        summary: 'Scan for issues',
        description: 'Scan documents for issues that can be auto-fixed',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  repositoryId: { type: 'string' },
                  documentId: { type: 'string' },
                  issueTypes: { type: 'array', items: { $ref: '#/components/schemas/IssueType' } },
                },
              },
            },
          },
        },
        responses: {
          '202': {
            description: 'Scan job started',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        jobId: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/self-healing/issues/{repositoryId}': {
      get: {
        tags: ['Self-Healing'],
        summary: 'Get detected issues',
        description: 'Get all detected documentation issues for a repository',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'repositoryId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'type', in: 'query', schema: { $ref: '#/components/schemas/IssueType' } },
          { name: 'severity', in: 'query', schema: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] } },
        ],
        responses: {
          '200': {
            description: 'Detected issues',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        issues: { type: 'array', items: { $ref: '#/components/schemas/DocumentIssue' } },
                        summary: {
                          type: 'object',
                          properties: {
                            total: { type: 'integer' },
                            autoFixable: { type: 'integer' },
                            critical: { type: 'integer' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/self-healing/heal': {
      post: {
        tags: ['Self-Healing'],
        summary: 'Auto-fix issues',
        description: 'Automatically fix detected documentation issues',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['issueIds', 'mode'],
                properties: {
                  issueIds: { type: 'array', items: { type: 'string' } },
                  mode: { type: 'string', enum: ['auto', 'review'] },
                  createPR: { type: 'boolean', default: false },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Healing results',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        results: { type: 'array', items: { $ref: '#/components/schemas/HealingResult' } },
                        summary: {
                          type: 'object',
                          properties: {
                            total: { type: 'integer' },
                            fixed: { type: 'integer' },
                            failed: { type: 'integer' },
                            skipped: { type: 'integer' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    // Doc Tests
    '/api/doc-tests/documents/{documentId}/tests/run': {
      post: {
        tags: ['Doc Tests'],
        summary: 'Run document tests',
        description: 'Execute tests for code examples in a document',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'documentId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  dryRun: { type: 'boolean', default: false },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Test results',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/TestResult' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/doc-tests/ci/config': {
      post: {
        tags: ['Doc Tests'],
        summary: 'Generate CI config',
        description: 'Generate CI configuration for documentation testing',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['repositoryId', 'provider'],
                properties: {
                  repositoryId: { type: 'string' },
                  provider: { $ref: '#/components/schemas/CIProvider' },
                  framework: { $ref: '#/components/schemas/TestFramework' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Generated CI config',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        config: { type: 'string' },
                        filename: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    // Chat
    '/api/chat': {
      post: {
        tags: ['Chat'],
        summary: 'Send chat message',
        description: 'Send a message to the AI documentation assistant',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['message', 'repositoryId'],
                properties: {
                  message: { type: 'string' },
                  repositoryId: { type: 'string' },
                  conversationId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Chat response',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        response: { type: 'string' },
                        conversationId: { type: 'string' },
                        sources: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              documentId: { type: 'string' },
                              title: { type: 'string' },
                              relevance: { type: 'number' },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    // LLM Usage
    '/api/llm-usage/overview': {
      get: {
        tags: ['LLM Usage'],
        summary: 'Get LLM usage overview',
        description: 'Get organization-wide LLM token usage, costs, and statistics',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: {
          '200': {
            description: 'LLM usage statistics',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/LLMUsageStats' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/llm-usage/trend': {
      get: {
        tags: ['LLM Usage'],
        summary: 'Get usage trend',
        description: 'Get LLM usage trend over time',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'granularity', in: 'query', schema: { type: 'string', enum: ['hourly', 'daily', 'weekly'] } },
        ],
        responses: {
          '200': {
            description: 'Usage trend data',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        trend: { type: 'array', items: { $ref: '#/components/schemas/UsageTrend' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/llm-usage/cost-breakdown': {
      get: {
        tags: ['LLM Usage'],
        summary: 'Get cost breakdown',
        description: 'Get LLM cost breakdown by provider, feature, and model',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date' } },
        ],
        responses: {
          '200': {
            description: 'Cost breakdown',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/CostBreakdown' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/llm-usage/alerts': {
      get: {
        tags: ['LLM Usage'],
        summary: 'Get usage alerts',
        description: 'Get alerts and recommendations for LLM usage',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Alerts and recommendations',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        alerts: { type: 'array', items: { $ref: '#/components/schemas/LLMUsageAlert' } },
                        recommendations: { type: 'array', items: { type: 'string' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    // Interactive Playground
    '/api/interactive-playground': {
      post: {
        tags: ['Interactive Playground'],
        summary: 'Create playground',
        description: 'Create a new interactive code playground',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['repositoryId', 'language'],
                properties: {
                  repositoryId: { type: 'string' },
                  documentId: { type: 'string' },
                  language: { type: 'string', enum: ['javascript', 'typescript', 'python', 'go', 'rust', 'html'] },
                  framework: { type: 'string', enum: ['react', 'vue', 'svelte', 'node', 'express', 'fastapi', 'none'] },
                  initialCode: { type: 'string' },
                  dependencies: { type: 'object', additionalProperties: { type: 'string' } },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Playground created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/Playground' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/interactive-playground/{playgroundId}/execute': {
      post: {
        tags: ['Interactive Playground'],
        summary: 'Execute code',
        description: 'Execute code in the playground sandbox',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'playgroundId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['code'],
                properties: {
                  code: { type: 'string' },
                  timeout: { type: 'integer', default: 30000 },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Execution result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/ExecutionResult' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/interactive-playground/{playgroundId}/hint': {
      post: {
        tags: ['Interactive Playground'],
        summary: 'Get AI hint',
        description: 'Get an AI-powered hint for the current code (rate limited)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'playgroundId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['code'],
                properties: {
                  code: { type: 'string' },
                  errorMessage: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'AI hint',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        hint: { type: 'string' },
                        confidence: { type: 'number' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    // AI Doc Editor
    '/api/ai-editor/completion': {
      post: {
        tags: ['AI Doc Editor'],
        summary: 'Get inline completion',
        description: 'Get AI-powered inline completion suggestion at cursor position',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/EditorContext' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Inline suggestion',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/InlineSuggestion' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/ai-editor/improve': {
      post: {
        tags: ['AI Doc Editor'],
        summary: 'Get improvement suggestions',
        description: 'Get AI improvement suggestions for selected text',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/EditorContext' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Improvement suggestions',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { type: 'array', items: { $ref: '#/components/schemas/AISuggestion' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/ai-editor/style-check': {
      post: {
        tags: ['AI Doc Editor'],
        summary: 'Check style consistency',
        description: 'Analyze document for style consistency and suggest fixes',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['repositoryId', 'content'],
                properties: {
                  repositoryId: { type: 'string' },
                  content: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Style fixes',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { type: 'array', items: { $ref: '#/components/schemas/StyleFix' } },
                  },
                },
              },
            },
          },
        },
      },
    },

    // Community
    '/api/community/discussions': {
      get: {
        tags: ['Community'],
        summary: 'List discussions',
        description: 'Get community discussions for a repository',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'repositoryId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'category', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['open', 'closed', 'resolved'] } },
        ],
        responses: {
          '200': {
            description: 'List of discussions',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { type: 'array', items: { $ref: '#/components/schemas/CommunityDiscussion' } },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['Community'],
        summary: 'Create discussion',
        description: 'Start a new community discussion',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['repositoryId', 'title', 'content'],
                properties: {
                  repositoryId: { type: 'string' },
                  title: { type: 'string' },
                  content: { type: 'string' },
                  category: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Discussion created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/CommunityDiscussion' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/community/badges': {
      get: {
        tags: ['Community'],
        summary: 'List available badges',
        description: 'Get all available community badges',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'List of badges',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { type: 'array', items: { $ref: '#/components/schemas/CommunityBadge' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/community/contributors/{contributorId}/profile': {
      get: {
        tags: ['Community'],
        summary: 'Get contributor profile',
        description: 'Get a contributor profile with stats and badges',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'contributorId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Contributor profile',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/ContributorProfile' },
                  },
                },
              },
            },
          },
        },
      },
    },

    // Hub
    '/api/hub/{hubId}/navigation': {
      get: {
        tags: ['Hub'],
        summary: 'Get hub navigation',
        description: 'Get the navigation structure for a documentation hub',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'hubId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Hub navigation structure',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/HubNavigation' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/hub/{hubId}/search': {
      get: {
        tags: ['Hub'],
        summary: 'Search hub',
        description: 'Search documentation across the hub',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'hubId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: {
          '200': {
            description: 'Search results',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        results: { type: 'array', items: { $ref: '#/components/schemas/SearchResult' } },
                        total: { type: 'integer' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    // Coverage Gate
    '/api/coverage-gate/status/{repositoryId}': {
      get: {
        tags: ['Coverage Gate'],
        summary: 'Get coverage status',
        description: 'Get documentation coverage status for a repository',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'repositoryId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Coverage status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/CoverageStatus' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/coverage-gate/check': {
      post: {
        tags: ['Coverage Gate'],
        summary: 'Check coverage gate',
        description: 'Check if a PR passes the documentation coverage gate',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['repositoryId', 'prNumber'],
                properties: {
                  repositoryId: { type: 'string' },
                  prNumber: { type: 'integer' },
                  sha: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Gate check result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/GateCheckResult' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/coverage-gate/config': {
      get: {
        tags: ['Coverage Gate'],
        summary: 'Get gate config',
        description: 'Get the coverage gate configuration for a repository',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'repositoryId', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Gate configuration',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/GateConfig' },
                  },
                },
              },
            },
          },
        },
      },
      put: {
        tags: ['Coverage Gate'],
        summary: 'Update gate config',
        description: 'Update the coverage gate configuration',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/GateConfig' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Configuration updated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                  },
                },
              },
            },
          },
        },
      },
    },

    // Review Documentation
    '/api/review-documentation/generate': {
      post: {
        tags: ['Review Documentation'],
        summary: 'Generate review docs',
        description: 'Generate documentation from code review insights',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['repositoryId', 'prNumber'],
                properties: {
                  repositoryId: { type: 'string' },
                  prNumber: { type: 'integer' },
                  includeComments: { type: 'boolean', default: true },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Generated documentation',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { $ref: '#/components/schemas/ReviewDocumentation' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT token obtained from /auth/login',
      },
    },
    schemas: {
      Repository: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          fullName: { type: 'string' },
          description: { type: 'string', nullable: true },
          defaultBranch: { type: 'string' },
          enabled: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      DocumentType: {
        type: 'string',
        enum: ['readme', 'api', 'guide', 'tutorial', 'reference', 'changelog', 'contributing', 'architecture', 'adr', 'other'],
      },
      Document: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          repositoryId: { type: 'string' },
          path: { type: 'string' },
          type: { $ref: '#/components/schemas/DocumentType' },
          title: { type: 'string' },
          content: { type: 'string' },
          version: { type: 'integer' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Pagination: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          limit: { type: 'integer' },
          total: { type: 'integer' },
          hasMore: { type: 'boolean' },
        },
      },
      Badge: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          icon: { type: 'string' },
          earnedAt: { type: 'string', format: 'date-time' },
        },
      },
      LeaderboardEntry: {
        type: 'object',
        properties: {
          rank: { type: 'integer' },
          repositoryId: { type: 'string' },
          repositoryName: { type: 'string' },
          score: { type: 'number' },
          scoreChange: { type: 'number' },
          docsCreated: { type: 'integer' },
          docsImproved: { type: 'integer' },
          streak: { type: 'integer' },
          badges: { type: 'array', items: { $ref: '#/components/schemas/Badge' } },
        },
      },
      GlossaryEntry: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          term: { type: 'string' },
          definition: { type: 'string' },
          locale: { type: 'string' },
          context: { type: 'string', nullable: true },
          doNotTranslate: { type: 'boolean' },
        },
      },
      KnowledgeEntity: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string', enum: ['document', 'concept', 'function', 'class', 'interface', 'type', 'module', 'component', 'endpoint', 'event'] },
          description: { type: 'string', nullable: true },
        },
      },
      KnowledgeRelation: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          sourceId: { type: 'string' },
          targetId: { type: 'string' },
          type: { type: 'string' },
          weight: { type: 'number' },
        },
      },
      GraphCluster: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          nodeIds: { type: 'array', items: { type: 'string' } },
          color: { type: 'string' },
        },
      },
      EditSession: {
        type: 'object',
        properties: {
          documentId: { type: 'string' },
          version: { type: 'integer' },
          participants: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                userId: { type: 'string' },
                color: { type: 'string' },
                cursor: {
                  type: 'object',
                  properties: {
                    line: { type: 'integer' },
                    column: { type: 'integer' },
                  },
                },
              },
            },
          },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Comment: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          documentId: { type: 'string' },
          userId: { type: 'string' },
          text: { type: 'string' },
          lineStart: { type: 'integer' },
          lineEnd: { type: 'integer' },
          resolved: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          replies: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                userId: { type: 'string' },
                text: { type: 'string' },
                createdAt: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
      },
      ComplianceFramework: {
        type: 'string',
        enum: ['soc2', 'gdpr', 'hipaa', 'iso27001'],
      },
      ComplianceAssessment: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          repositoryId: { type: 'string' },
          framework: { $ref: '#/components/schemas/ComplianceFramework' },
          score: { type: 'number' },
          status: { type: 'string', enum: ['compliant', 'partial', 'non-compliant'] },
          gaps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                requirementId: { type: 'string' },
                description: { type: 'string' },
                severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                remediation: { type: 'string' },
              },
            },
          },
          assessedAt: { type: 'string', format: 'date-time' },
        },
      },
      VideoScript: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          documentId: { type: 'string' },
          scenes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                duration: { type: 'number' },
                narration: { type: 'string' },
                visuals: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          totalDuration: { type: 'number' },
          style: { type: 'string', enum: ['screencast', 'animated-slides', 'code-walkthrough'] },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      RenderJob: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          scriptId: { type: 'string' },
          status: { type: 'string', enum: ['queued', 'processing', 'completed', 'failed'] },
          progress: { type: 'number' },
          outputUrl: { type: 'string', nullable: true },
          error: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      IssueType: {
        type: 'string',
        enum: ['broken-link', 'outdated-reference', 'terminology-drift', 'missing-section', 'deprecated-api', 'code-mismatch'],
      },
      DocumentIssue: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { $ref: '#/components/schemas/IssueType' },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          documentId: { type: 'string' },
          documentPath: { type: 'string' },
          description: { type: 'string' },
          suggestedFix: { type: 'string', nullable: true },
          autoFixable: { type: 'boolean' },
          detectedAt: { type: 'string', format: 'date-time' },
        },
      },
      HealingResult: {
        type: 'object',
        properties: {
          issueId: { type: 'string' },
          status: { type: 'string', enum: ['fixed', 'failed', 'skipped'] },
          originalContent: { type: 'string' },
          newContent: { type: 'string' },
          error: { type: 'string' },
        },
      },
      TestFramework: {
        type: 'string',
        enum: ['jest', 'vitest', 'mocha', 'pytest', 'go-test', 'cargo-test'],
      },
      TestResult: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          documentId: { type: 'string' },
          framework: { $ref: '#/components/schemas/TestFramework' },
          passed: { type: 'boolean' },
          totalTests: { type: 'integer' },
          passedTests: { type: 'integer' },
          failedTests: { type: 'integer' },
          skippedTests: { type: 'integer' },
          duration: { type: 'number' },
          errors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                testName: { type: 'string' },
                message: { type: 'string' },
                stack: { type: 'string' },
              },
            },
          },
          runAt: { type: 'string', format: 'date-time' },
        },
      },
      CIProvider: {
        type: 'string',
        enum: ['github-actions', 'gitlab-ci', 'circleci', 'jenkins'],
      },

      // LLM Usage schemas
      LLMUsageStats: {
        type: 'object',
        properties: {
          totalRequests: { type: 'integer' },
          successfulRequests: { type: 'integer' },
          failedRequests: { type: 'integer' },
          totalInputTokens: { type: 'integer' },
          totalOutputTokens: { type: 'integer' },
          totalTokens: { type: 'integer' },
          totalCost: { type: 'number', description: 'Total cost in cents' },
          avgLatencyMs: { type: 'number' },
          byProvider: { type: 'object', additionalProperties: { $ref: '#/components/schemas/UsageBreakdown' } },
          byFeature: { type: 'object', additionalProperties: { $ref: '#/components/schemas/UsageBreakdown' } },
          byModel: { type: 'object', additionalProperties: { $ref: '#/components/schemas/UsageBreakdown' } },
        },
      },
      UsageBreakdown: {
        type: 'object',
        properties: {
          requests: { type: 'integer' },
          tokens: { type: 'integer' },
          cost: { type: 'number' },
        },
      },
      UsageTrend: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          requests: { type: 'integer' },
          tokens: { type: 'integer' },
          cost: { type: 'number' },
        },
      },
      CostBreakdown: {
        type: 'object',
        properties: {
          totalCost: { type: 'number' },
          totalRequests: { type: 'integer' },
          totalTokens: { type: 'integer' },
          successRate: { type: 'number' },
          avgLatencyMs: { type: 'number' },
          byProvider: { type: 'array', items: { $ref: '#/components/schemas/CostBreakdownEntry' } },
          byFeature: { type: 'array', items: { $ref: '#/components/schemas/CostBreakdownEntry' } },
          byModel: { type: 'array', items: { $ref: '#/components/schemas/CostBreakdownEntry' } },
        },
      },
      CostBreakdownEntry: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          cost: { type: 'number' },
          percentage: { type: 'number' },
          requests: { type: 'integer' },
          tokens: { type: 'integer' },
        },
      },
      LLMUsageAlert: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['warning', 'info', 'error'] },
          title: { type: 'string' },
          message: { type: 'string' },
        },
      },

      // Interactive Playground schemas
      Playground: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          repositoryId: { type: 'string' },
          documentId: { type: 'string', nullable: true },
          language: { type: 'string' },
          framework: { type: 'string', nullable: true },
          initialCode: { type: 'string' },
          dependencies: { type: 'object', additionalProperties: { type: 'string' } },
          sessionToken: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      ExecutionResult: {
        type: 'object',
        properties: {
          output: { type: 'string' },
          error: { type: 'string', nullable: true },
          exitCode: { type: 'integer' },
          durationMs: { type: 'integer' },
          memoryUsed: { type: 'integer' },
        },
      },

      // AI Doc Editor schemas
      EditorContext: {
        type: 'object',
        required: ['repositoryId', 'content', 'cursorPosition'],
        properties: {
          documentId: { type: 'string' },
          repositoryId: { type: 'string' },
          filePath: { type: 'string' },
          content: { type: 'string' },
          cursorPosition: { $ref: '#/components/schemas/Position' },
          selection: { $ref: '#/components/schemas/Selection' },
          language: { type: 'string' },
        },
      },
      Position: {
        type: 'object',
        properties: {
          line: { type: 'integer' },
          character: { type: 'integer' },
        },
      },
      Selection: {
        type: 'object',
        properties: {
          start: { $ref: '#/components/schemas/Position' },
          end: { $ref: '#/components/schemas/Position' },
        },
      },
      InlineSuggestion: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          suggestionText: { type: 'string' },
          displayText: { type: 'string' },
          position: { $ref: '#/components/schemas/Position' },
          type: { type: 'string', enum: ['ghost', 'inline', 'tooltip'] },
        },
      },
      AISuggestion: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          position: { $ref: '#/components/schemas/Position' },
          endPosition: { $ref: '#/components/schemas/Position' },
          type: { type: 'string', enum: ['insert', 'replace', 'delete'] },
          category: { type: 'string', enum: ['completion', 'improvement', 'style', 'grammar', 'clarity'] },
          confidence: { type: 'number' },
          reason: { type: 'string' },
        },
      },
      StyleFix: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          originalText: { type: 'string' },
          suggestedText: { type: 'string' },
          lineStart: { type: 'integer' },
          lineEnd: { type: 'integer' },
          category: { type: 'string', enum: ['consistency', 'formatting', 'terminology', 'tone'] },
          explanation: { type: 'string' },
        },
      },

      // Community schemas
      CommunityDiscussion: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          repositoryId: { type: 'string' },
          authorId: { type: 'string' },
          title: { type: 'string' },
          content: { type: 'string' },
          category: { type: 'string' },
          status: { type: 'string', enum: ['open', 'closed', 'resolved'] },
          upvotes: { type: 'integer' },
          replyCount: { type: 'integer' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      CommunityBadge: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          icon: { type: 'string' },
          category: { type: 'string' },
          tier: { type: 'string', enum: ['bronze', 'silver', 'gold', 'platinum'] },
          criteria: { type: 'object' },
        },
      },
      ContributorProfile: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          userId: { type: 'string' },
          displayName: { type: 'string' },
          avatarUrl: { type: 'string' },
          bio: { type: 'string' },
          contributionCount: { type: 'integer' },
          docPagesCreated: { type: 'integer' },
          docPagesEdited: { type: 'integer' },
          reviewsGiven: { type: 'integer' },
          helpfulVotes: { type: 'integer' },
          badges: { type: 'array', items: { $ref: '#/components/schemas/CommunityBadge' } },
          rank: { type: 'integer' },
          joinedAt: { type: 'string', format: 'date-time' },
        },
      },

      // Hub schemas
      HubNavigation: {
        type: 'object',
        properties: {
          hubId: { type: 'string' },
          title: { type: 'string' },
          sections: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      title: { type: 'string' },
                      path: { type: 'string' },
                      type: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      SearchResult: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          path: { type: 'string' },
          snippet: { type: 'string' },
          score: { type: 'number' },
          documentType: { type: 'string' },
        },
      },

      // Coverage Gate schemas
      CoverageStatus: {
        type: 'object',
        properties: {
          repositoryId: { type: 'string' },
          overallCoverage: { type: 'number' },
          functionsCovered: { type: 'integer' },
          functionsTotal: { type: 'integer' },
          classesCovered: { type: 'integer' },
          classesTotal: { type: 'integer' },
          modulesCovered: { type: 'integer' },
          modulesTotal: { type: 'integer' },
          passesGate: { type: 'boolean' },
          threshold: { type: 'number' },
          lastChecked: { type: 'string', format: 'date-time' },
        },
      },
      GateCheckResult: {
        type: 'object',
        properties: {
          passed: { type: 'boolean' },
          coverage: { type: 'number' },
          threshold: { type: 'number' },
          delta: { type: 'number' },
          newUndocumented: { type: 'array', items: { type: 'string' } },
          message: { type: 'string' },
        },
      },
      GateConfig: {
        type: 'object',
        properties: {
          repositoryId: { type: 'string' },
          enabled: { type: 'boolean' },
          threshold: { type: 'number' },
          failOnDecrease: { type: 'boolean' },
          excludePaths: { type: 'array', items: { type: 'string' } },
          requireForMerge: { type: 'boolean' },
        },
      },

      // Review Documentation schemas
      ReviewDocumentation: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          repositoryId: { type: 'string' },
          prNumber: { type: 'integer' },
          title: { type: 'string' },
          summary: { type: 'string' },
          keyChanges: { type: 'array', items: { type: 'string' } },
          codeSnippets: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                file: { type: 'string' },
                language: { type: 'string' },
                code: { type: 'string' },
                explanation: { type: 'string' },
              },
            },
          },
          reviewInsights: { type: 'array', items: { type: 'string' } },
          generatedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
};

// Swagger UI endpoint
docsApp.get('/docs', swaggerUI({ url: '/docs/openapi.json' }));

// OpenAPI JSON endpoint
docsApp.get('/docs/openapi.json', (c) => {
  return c.json(openApiSpec);
});

// Export the spec for testing
export { openApiSpec };
