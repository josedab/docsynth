/**
 * DocSynth API Client for MCP Server
 *
 * Thin HTTP client that communicates with the DocSynth REST API.
 */

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export class DocsynthClient {
  constructor(
    private baseUrl: string,
    private token: string
  ) {}

  private async request<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...(options.headers as Record<string, string> ?? {}),
    };

    const response = await fetch(url, { ...options, headers });
    return response.json() as Promise<ApiResponse<T>>;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Health & Status
  // ──────────────────────────────────────────────────────────────────────────

  async getHealth(): Promise<ApiResponse> {
    return this.request('/health');
  }

  async getHealthDashboard(repositoryId: string): Promise<ApiResponse> {
    return this.request(`/api/health-dashboard/${repositoryId}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Repositories
  // ──────────────────────────────────────────────────────────────────────────

  async listRepositories(orgId: string): Promise<ApiResponse> {
    return this.request(`/api/repositories?organizationId=${orgId}`);
  }

  async getRepository(repositoryId: string): Promise<ApiResponse> {
    return this.request(`/api/repositories/${repositoryId}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Documents
  // ──────────────────────────────────────────────────────────────────────────

  async listDocuments(repositoryId: string): Promise<ApiResponse> {
    return this.request(`/api/documents?repositoryId=${repositoryId}`);
  }

  async getDocument(documentId: string): Promise<ApiResponse> {
    return this.request(`/api/documents/${documentId}`);
  }

  async searchDocuments(repositoryId: string, query: string): Promise<ApiResponse> {
    return this.request(`/api/citations/search`, {
      method: 'POST',
      body: JSON.stringify({ repositoryId, query, limit: 10 }),
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Documentation Generation
  // ──────────────────────────────────────────────────────────────────────────

  async triggerGeneration(repositoryId: string, docType?: string): Promise<ApiResponse> {
    return this.request(`/api/jobs`, {
      method: 'POST',
      body: JSON.stringify({
        repositoryId,
        type: 'doc-generation',
        docType: docType ?? 'README',
      }),
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Knowledge Graph
  // ──────────────────────────────────────────────────────────────────────────

  async queryKnowledgeGraph(repositoryId: string, query: string): Promise<ApiResponse> {
    return this.request(`/api/knowledge-graph/${repositoryId}/search?q=${encodeURIComponent(query)}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Coverage
  // ──────────────────────────────────────────────────────────────────────────

  async getCoverage(repositoryId: string): Promise<ApiResponse> {
    return this.request(`/api/coverage/${repositoryId}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Drift Detection
  // ──────────────────────────────────────────────────────────────────────────

  async getDriftPredictions(repositoryId: string): Promise<ApiResponse> {
    return this.request(`/api/drift-prediction/${repositoryId}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Chat
  // ──────────────────────────────────────────────────────────────────────────

  async chatWithDocs(repositoryId: string, message: string, sessionId?: string): Promise<ApiResponse> {
    return this.request(`/api/chat`, {
      method: 'POST',
      body: JSON.stringify({ repositoryId, message, sessionId }),
    });
  }
}
