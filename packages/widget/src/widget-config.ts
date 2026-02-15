// ============================================================================
// Widget Configuration
// ============================================================================

export interface WidgetConfig {
  apiUrl: string;
  apiKey: string;
  theme: 'light' | 'dark' | 'auto';
  position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  primaryColor: string;
  title: string;
  placeholder: string;
  features: {
    search: boolean;
    chat: boolean;
    contextualHelp: boolean;
    feedback: boolean;
  };
  branding: boolean;
  maxHeight: string;
  zIndex: number;
}

export const DEFAULT_WIDGET_CONFIG: WidgetConfig = {
  apiUrl: 'https://api.docsynth.dev',
  apiKey: '',
  theme: 'auto',
  position: 'bottom-right',
  primaryColor: '#6366f1',
  title: 'Documentation',
  placeholder: 'Search docs or ask a question...',
  features: { search: true, chat: true, contextualHelp: true, feedback: true },
  branding: true,
  maxHeight: '600px',
  zIndex: 9999,
};
