'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

interface TemplateSection {
  name: string;
  required: boolean;
  description: string;
  defaultContent?: string;
}

interface TemplateVariable {
  name: string;
  description: string;
  defaultValue?: string;
}

interface TemplateStyle {
  tone: 'formal' | 'casual' | 'technical';
  useEmojis: boolean;
  codeBlockStyle: 'fenced' | 'indented';
}

interface DocTemplate {
  id: string;
  name: string;
  description: string;
  documentType: string;
  sections: TemplateSection[];
  variables: TemplateVariable[];
  style: TemplateStyle;
  template: string;
  isDefault: boolean;
  organizationId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TemplateEditorProps {
  token: string;
  initialTemplateId?: string;
  onSave?: (template: DocTemplate) => void;
}

export function TemplateEditor({ token, initialTemplateId, onSave }: TemplateEditorProps) {
  const [templates, setTemplates] = useState<DocTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<DocTemplate | null>(null);
  const [editedTemplate, setEditedTemplate] = useState<Partial<DocTemplate>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'sections' | 'variables' | 'style' | 'preview'>('sections');

  const documentTypes = [
    'README', 'API_REFERENCE', 'CHANGELOG', 'GUIDE', 
    'TUTORIAL', 'ARCHITECTURE', 'ADR', 'INLINE_COMMENT'
  ];

  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true);
      const response = await apiFetch<{ success: boolean; data: DocTemplate[] }>(
        '/api/templates',
        { token }
      );
      setTemplates(response.data);
      
      if (initialTemplateId) {
        const template = response.data.find(t => t.id === initialTemplateId);
        if (template) {
          setSelectedTemplate(template);
          setEditedTemplate(template);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, [token, initialTemplateId]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleSelectTemplate = (template: DocTemplate) => {
    setSelectedTemplate(template);
    setEditedTemplate({ ...template });
    setPreview(null);
    setActiveTab('sections');
  };

  const handleCreateNew = () => {
    const newTemplate: Partial<DocTemplate> = {
      name: 'New Template',
      description: '',
      documentType: 'README',
      sections: [
        { name: 'Overview', required: true, description: 'Project overview' },
        { name: 'Installation', required: true, description: 'Installation steps' },
      ],
      variables: [
        { name: 'projectName', description: 'Name of the project' },
        { name: 'version', description: 'Current version' },
      ],
      style: {
        tone: 'technical',
        useEmojis: false,
        codeBlockStyle: 'fenced',
      },
      template: '# {{projectName}}\n\n## Overview\n\n## Installation\n',
      isDefault: false,
    };
    setSelectedTemplate(null);
    setEditedTemplate(newTemplate);
    setPreview(null);
    setActiveTab('sections');
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);

      const method = selectedTemplate ? 'PUT' : 'POST';
      const endpoint = selectedTemplate 
        ? `/api/templates/${selectedTemplate.id}` 
        : '/api/templates';

      const response = await apiFetch<{ success: boolean; data: DocTemplate }>(endpoint, {
        method,
        token,
        body: JSON.stringify(editedTemplate),
      });

      onSave?.(response.data);
      await fetchTemplates();
      setSelectedTemplate(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    try {
      setPreviewing(true);
      setError(null);

      const response = await apiFetch<{ success: boolean; data: { preview: string } }>(
        '/api/templates/preview',
        {
          method: 'POST',
          token,
          body: JSON.stringify({
            template: editedTemplate.template,
            variables: {
              projectName: 'Example Project',
              version: '1.0.0',
              ...Object.fromEntries(
                (editedTemplate.variables || []).map(v => [v.name, v.defaultValue || `{{${v.name}}}`])
              ),
            },
          }),
        }
      );

      setPreview(response.data.preview);
      setActiveTab('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate preview');
    } finally {
      setPreviewing(false);
    }
  };

  const updateSection = (index: number, updates: Partial<TemplateSection>) => {
    const sections = [...(editedTemplate.sections || [])];
    sections[index] = { ...sections[index], ...updates } as TemplateSection;
    setEditedTemplate({ ...editedTemplate, sections });
  };

  const addSection = () => {
    const sections = [...(editedTemplate.sections || [])];
    sections.push({ name: 'New Section', required: false, description: '' });
    setEditedTemplate({ ...editedTemplate, sections });
  };

  const removeSection = (index: number) => {
    const sections = [...(editedTemplate.sections || [])];
    sections.splice(index, 1);
    setEditedTemplate({ ...editedTemplate, sections });
  };

  const updateVariable = (index: number, updates: Partial<TemplateVariable>) => {
    const variables = [...(editedTemplate.variables || [])];
    variables[index] = { ...variables[index], ...updates } as TemplateVariable;
    setEditedTemplate({ ...editedTemplate, variables });
  };

  const addVariable = () => {
    const variables = [...(editedTemplate.variables || [])];
    variables.push({ name: 'newVariable', description: '' });
    setEditedTemplate({ ...editedTemplate, variables });
  };

  const removeVariable = (index: number) => {
    const variables = [...(editedTemplate.variables || [])];
    variables.splice(index, 1);
    setEditedTemplate({ ...editedTemplate, variables });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Sidebar - Template List */}
      <div className="w-64 border-r bg-gray-50 flex flex-col">
        <div className="p-4 border-b">
          <button
            onClick={handleCreateNew}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            + New Template
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {templates.map((template) => (
            <button
              key={template.id}
              onClick={() => handleSelectTemplate(template)}
              className={`w-full px-4 py-3 text-left border-b hover:bg-gray-100 ${
                selectedTemplate?.id === template.id ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
              }`}
            >
              <div className="font-medium truncate">{template.name}</div>
              <div className="text-xs text-gray-500">
                {template.documentType.replace('_', ' ')}
                {template.isDefault && ' • Default'}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Main Editor */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {editedTemplate.name ? (
          <>
            {/* Header */}
            <div className="p-4 border-b bg-white">
              <div className="flex items-center justify-between">
                <div className="flex-1 mr-4">
                  <input
                    type="text"
                    value={editedTemplate.name || ''}
                    onChange={(e) => setEditedTemplate({ ...editedTemplate, name: e.target.value })}
                    className="text-xl font-semibold w-full border-0 focus:ring-0 p-0"
                    placeholder="Template Name"
                  />
                  <input
                    type="text"
                    value={editedTemplate.description || ''}
                    onChange={(e) => setEditedTemplate({ ...editedTemplate, description: e.target.value })}
                    className="text-sm text-gray-500 w-full border-0 focus:ring-0 p-0"
                    placeholder="Description"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={editedTemplate.documentType || 'README'}
                    onChange={(e) => setEditedTemplate({ ...editedTemplate, documentType: e.target.value })}
                    className="text-sm border rounded-lg px-3 py-1.5"
                  >
                    {documentTypes.map((type) => (
                      <option key={type} value={type}>{type.replace('_', ' ')}</option>
                    ))}
                  </select>
                  <button
                    onClick={handlePreview}
                    disabled={previewing}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm"
                  >
                    {previewing ? '...' : '👁 Preview'}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>

              {error && (
                <div className="mt-2 text-sm text-red-600">{error}</div>
              )}
            </div>

            {/* Tabs */}
            <div className="border-b bg-white px-4">
              <div className="flex gap-4">
                {(['sections', 'variables', 'style', 'preview'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`py-2 px-1 text-sm border-b-2 capitalize ${
                      activeTab === tab
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
              {/* Sections Tab */}
              {activeTab === 'sections' && (
                <div className="space-y-4">
                  {(editedTemplate.sections || []).map((section, index) => (
                    <div key={index} className="bg-white rounded-lg p-4 border">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 space-y-2">
                          <input
                            type="text"
                            value={section.name}
                            onChange={(e) => updateSection(index, { name: e.target.value })}
                            className="font-medium w-full border rounded px-2 py-1"
                            placeholder="Section name"
                          />
                          <input
                            type="text"
                            value={section.description}
                            onChange={(e) => updateSection(index, { description: e.target.value })}
                            className="text-sm text-gray-500 w-full border rounded px-2 py-1"
                            placeholder="Description"
                          />
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={section.required}
                              onChange={(e) => updateSection(index, { required: e.target.checked })}
                            />
                            Required
                          </label>
                        </div>
                        <button
                          onClick={() => removeSection(index)}
                          className="text-red-500 hover:text-red-700"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={addSection}
                    className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-blue-500 hover:text-blue-500"
                  >
                    + Add Section
                  </button>
                </div>
              )}

              {/* Variables Tab */}
              {activeTab === 'variables' && (
                <div className="space-y-4">
                  {(editedTemplate.variables || []).map((variable, index) => (
                    <div key={index} className="bg-white rounded-lg p-4 border">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 grid grid-cols-3 gap-2">
                          <input
                            type="text"
                            value={variable.name}
                            onChange={(e) => updateVariable(index, { name: e.target.value })}
                            className="font-mono text-sm border rounded px-2 py-1"
                            placeholder="variableName"
                          />
                          <input
                            type="text"
                            value={variable.description}
                            onChange={(e) => updateVariable(index, { description: e.target.value })}
                            className="text-sm border rounded px-2 py-1"
                            placeholder="Description"
                          />
                          <input
                            type="text"
                            value={variable.defaultValue || ''}
                            onChange={(e) => updateVariable(index, { defaultValue: e.target.value })}
                            className="text-sm border rounded px-2 py-1"
                            placeholder="Default value"
                          />
                        </div>
                        <button
                          onClick={() => removeVariable(index)}
                          className="text-red-500 hover:text-red-700"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={addVariable}
                    className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-blue-500 hover:text-blue-500"
                  >
                    + Add Variable
                  </button>
                </div>
              )}

              {/* Style Tab */}
              {activeTab === 'style' && (
                <div className="bg-white rounded-lg p-4 border space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Tone</label>
                    <select
                      value={editedTemplate.style?.tone || 'technical'}
                      onChange={(e) => setEditedTemplate({
                        ...editedTemplate,
                        style: { ...editedTemplate.style!, tone: e.target.value as TemplateStyle['tone'] },
                      })}
                      className="w-full border rounded-lg px-3 py-2"
                    >
                      <option value="formal">Formal</option>
                      <option value="casual">Casual</option>
                      <option value="technical">Technical</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Code Block Style</label>
                    <select
                      value={editedTemplate.style?.codeBlockStyle || 'fenced'}
                      onChange={(e) => setEditedTemplate({
                        ...editedTemplate,
                        style: { ...editedTemplate.style!, codeBlockStyle: e.target.value as TemplateStyle['codeBlockStyle'] },
                      })}
                      className="w-full border rounded-lg px-3 py-2"
                    >
                      <option value="fenced">Fenced (```)</option>
                      <option value="indented">Indented</option>
                    </select>
                  </div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editedTemplate.style?.useEmojis || false}
                      onChange={(e) => setEditedTemplate({
                        ...editedTemplate,
                        style: { ...editedTemplate.style!, useEmojis: e.target.checked },
                      })}
                    />
                    Use emojis in headings
                  </label>
                </div>
              )}

              {/* Preview Tab */}
              {activeTab === 'preview' && (
                <div className="bg-white rounded-lg border overflow-hidden">
                  {preview ? (
                    <pre className="p-4 text-sm font-mono overflow-x-auto whitespace-pre-wrap">
                      {preview}
                    </pre>
                  ) : (
                    <div className="p-8 text-center text-gray-500">
                      Click "Preview" to see the rendered template
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Template Content Editor */}
            <div className="h-64 border-t bg-white">
              <div className="px-4 py-2 border-b bg-gray-50 text-sm font-medium">
                Template Content
              </div>
              <textarea
                value={editedTemplate.template || ''}
                onChange={(e) => setEditedTemplate({ ...editedTemplate, template: e.target.value })}
                className="w-full h-full p-4 font-mono text-sm resize-none focus:outline-none"
                placeholder="# {{projectName}}&#10;&#10;## Overview&#10;&#10;..."
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            Select a template or create a new one
          </div>
        )}
      </div>
    </div>
  );
}
