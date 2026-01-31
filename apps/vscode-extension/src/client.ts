import * as vscode from 'vscode';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface DiffChange {
  type: 'added' | 'removed' | 'modified';
  startLine: number;
  endLine: number;
  content: string;
}

interface DiffResponse {
  changes: DiffChange[];
  documentationImpact: {
    requiresUpdate: boolean;
    affectedDocTypes: string[];
    suggestedActions: string[];
  };
}

interface PreviewResponse {
  wouldGenerateDocs: boolean;
  documentTypes: string[];
  preview: Array<{
    type: string;
    title: string;
    contentPreview: string;
    affectedSections: string[];
    estimatedLength: number;
  }>;
  suggestions: Array<{
    type: string;
    message: string;
    location: { line: number; character: number };
    severity: 'info' | 'warning' | 'error';
    quickFix?: { title: string; replacement: string };
  }>;
  styleWarnings: Array<{
    rule: string;
    message: string;
    location: { line: number; character: number };
    expected: string;
    actual: string;
  }>;
  confidence: number;
}

interface HealthResponse {
  repositoryId: string;
  summary: {
    fresh: number;
    aging: number;
    stale: number;
  };
  documents: Array<{
    path: string;
    type: string;
    status: 'fresh' | 'aging' | 'stale';
    daysSinceUpdate: number;
  }>;
}

interface Repository {
  id: string;
  name: string;
  githubFullName: string;
}

interface StyleResult {
  filePath: string;
  warnings: Array<{
    rule: string;
    message: string;
    location: { line: number; character: number };
    expected: string;
    actual: string;
  }>;
  compliant: boolean;
}

interface GenerateDocsResult {
  documentsGenerated: number;
}

interface InlineDocResult {
  documentation: string;
  confidence: number;
}

interface ChatResponse {
  answer: string;
  sources?: Array<{ path: string; title: string; relevance: number }>;
  suggestedFollowUp?: string[];
}

export class DocSynthClient {
  private apiUrl: string;
  private globalState: vscode.Memento;
  private token: string | undefined;
  private currentRepositoryId: string | undefined;

  constructor(apiUrl: string, globalState: vscode.Memento) {
    this.apiUrl = apiUrl;
    this.globalState = globalState;
    this.token = globalState.get('docsynth.token');
    this.currentRepositoryId = globalState.get('docsynth.repositoryId');
  }

  isAuthenticated(): boolean {
    return !!this.token;
  }

  async authenticate(token: string): Promise<void> {
    // Validate token by making a test request
    const response = await this.request<{ valid: boolean }>('/auth/validate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.success) {
      this.token = token;
      await this.globalState.update('docsynth.token', token);
    } else {
      throw new Error(response.error?.message || 'Invalid token');
    }
  }

  async getCurrentRepositoryId(): Promise<string | undefined> {
    return this.currentRepositoryId;
  }

  async setCurrentRepository(repositoryId: string): Promise<void> {
    this.currentRepositoryId = repositoryId;
    await this.globalState.update('docsynth.repositoryId', repositoryId);
  }

  async listRepositories(): Promise<Repository[]> {
    const response = await this.request<Repository[]>('/api/repositories');
    return response.data || [];
  }

  async getPreview(
    repositoryId: string,
    filePath: string,
    fileContent: string
  ): Promise<PreviewResponse> {
    const response = await this.request<PreviewResponse>('/api/ide/preview', {
      method: 'POST',
      body: JSON.stringify({ repositoryId, filePath, fileContent }),
    });
    return response.data!;
  }

  async getHealth(repositoryId: string): Promise<HealthResponse> {
    const response = await this.request<HealthResponse>(`/api/ide/health/${repositoryId}`);
    return response.data!;
  }

  async checkStyle(
    repositoryId: string,
    filePath: string,
    content: string
  ): Promise<StyleResult> {
    const response = await this.request<StyleResult>('/api/ide/style', {
      method: 'POST',
      body: JSON.stringify({ repositoryId, filePath, content }),
    });
    return response.data!;
  }

  async generateDocs(repositoryId: string, filePath: string): Promise<GenerateDocsResult> {
    const response = await this.request<GenerateDocsResult>(
      `/api/documents/repository/${repositoryId}/generate`,
      { method: 'POST', body: JSON.stringify({ filePath }) }
    );
    return response.data!;
  }

  async generateInlineDoc(
    repositoryId: string,
    filePath: string,
    codeBlock: string,
    style: 'jsdoc' | 'tsdoc' | 'docstring' = 'jsdoc'
  ): Promise<InlineDocResult> {
    const response = await this.request<InlineDocResult>('/api/ide/inline/ai', {
      method: 'POST',
      body: JSON.stringify({ repositoryId, filePath, codeBlock, style }),
    });
    return response.data!;
  }

  async getDiff(
    repositoryId: string,
    filePath: string,
    originalContent: string,
    modifiedContent: string
  ): Promise<DiffResponse> {
    const response = await this.request<DiffResponse>('/api/ide/diff', {
      method: 'POST',
      body: JSON.stringify({ repositoryId, filePath, originalContent, modifiedContent }),
    });
    return response.data ?? { changes: [], documentationImpact: { requiresUpdate: false, affectedDocTypes: [], suggestedActions: [] } };
  }

  async chatWithDocs(
    repositoryId: string,
    message: string,
    context?: { filePath?: string; selection?: string }
  ): Promise<ChatResponse> {
    const response = await this.request<ChatResponse>('/api/chat/query', {
      method: 'POST',
      body: JSON.stringify({ repositoryId, message, context }),
    });
    return response.data ?? { answer: 'No response available', sources: [], suggestedFollowUp: [] };
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.apiUrl}${endpoint}`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      const data = await response.json();
      return data as ApiResponse<T>;
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'REQUEST_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }
}
