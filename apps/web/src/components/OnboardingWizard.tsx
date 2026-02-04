'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

type OnboardingStep = 'welcome' | 'github-app' | 'repository' | 'doc-types' | 'style' | 'integrations' | 'complete';

interface OnboardingWizardProps {
  onComplete: () => void;
  onSkip: () => void;
}

const ONBOARDING_KEY = 'docsynth_onboarding_complete';

export function OnboardingWizard({ onComplete, onSkip }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('welcome');
  const [preferences, setPreferences] = useState({
    docTypes: {
      readme: true,
      apiDocs: true,
      changelog: true,
      guides: false,
    },
    style: {
      tone: 'technical' as 'technical' | 'casual' | 'formal',
      includeExamples: true,
    },
    integrations: {
      jira: false,
      slack: false,
      linear: false,
    },
  });
  const [githubAppInstalled, setGithubAppInstalled] = useState(false);
  const [loading, setLoading] = useState(false);

  const steps: { id: OnboardingStep; title: string; icon: string }[] = [
    { id: 'welcome', title: 'Welcome', icon: '👋' },
    { id: 'github-app', title: 'GitHub App', icon: '🔗' },
    { id: 'repository', title: 'Repository', icon: '📁' },
    { id: 'doc-types', title: 'Doc Types', icon: '📄' },
    { id: 'style', title: 'Style', icon: '✍️' },
    { id: 'integrations', title: 'Integrations', icon: '🔌' },
    { id: 'complete', title: 'Complete', icon: '🎉' },
  ];

  const currentStepIndex = steps.findIndex((s) => s.id === currentStep);

  const goNext = () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < steps.length) {
      setCurrentStep(steps[nextIndex].id);
    }
  };

  const goBack = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(steps[prevIndex].id);
    }
  };

  const handleComplete = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('docsynth_token');
      if (token) {
        // Save preferences to backend
        await fetch(
          `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/user/preferences`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ onboardingPreferences: preferences }),
          }
        );
      }
      localStorage.setItem(ONBOARDING_KEY, 'true');
      onComplete();
    } catch {
      // Continue anyway
      localStorage.setItem(ONBOARDING_KEY, 'true');
      onComplete();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
        {/* Progress Bar */}
        <div className="h-1 bg-gray-200 dark:bg-gray-700">
          <div
            className="h-full bg-blue-600 transition-all duration-300"
            style={{ width: `${((currentStepIndex + 1) / steps.length) * 100}%` }}
          />
        </div>

        {/* Step Indicators */}
        <div className="flex justify-center gap-2 p-4 border-b border-gray-200 dark:border-gray-700">
          {steps.map((step, index) => (
            <div
              key={step.id}
              className={`flex items-center gap-1 text-xs ${
                index === currentStepIndex
                  ? 'text-blue-600 font-medium'
                  : index < currentStepIndex
                  ? 'text-green-600'
                  : 'text-gray-400'
              }`}
            >
              <span>{step.icon}</span>
              <span className="hidden sm:inline">{step.title}</span>
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {/* Welcome Step */}
          {currentStep === 'welcome' && (
            <div className="text-center">
              <span className="text-6xl block mb-4">📚</span>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                Welcome to DocSynth
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Let's set up automatic documentation generation for your repositories.
                This wizard will guide you through the initial configuration.
              </p>
              <div className="grid grid-cols-3 gap-4 text-center text-sm">
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <span className="text-2xl block mb-1">🤖</span>
                  <span className="text-gray-700 dark:text-gray-300">AI-Powered</span>
                </div>
                <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                  <span className="text-2xl block mb-1">🔄</span>
                  <span className="text-gray-700 dark:text-gray-300">Always Current</span>
                </div>
                <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                  <span className="text-2xl block mb-1">✍️</span>
                  <span className="text-gray-700 dark:text-gray-300">Human Quality</span>
                </div>
              </div>
            </div>
          )}

          {/* GitHub App Step */}
          {currentStep === 'github-app' && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                Install GitHub App
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                DocSynth uses a GitHub App to receive webhook events when PRs are merged.
              </p>
              <div className="space-y-4">
                <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <h3 className="font-medium mb-2">The GitHub App allows DocSynth to:</h3>
                  <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                    <li>✅ Receive notifications when PRs are merged</li>
                    <li>✅ Read repository contents to analyze changes</li>
                    <li>✅ Create PRs with generated documentation</li>
                  </ul>
                </div>
                <a
                  href="https://github.com/apps/docsynth"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setGithubAppInstalled(true)}
                  className="block w-full py-3 px-4 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-center font-medium"
                >
                  <span className="mr-2">🔗</span>
                  Install GitHub App
                </a>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={githubAppInstalled}
                    onChange={(e) => setGithubAppInstalled(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-gray-600 dark:text-gray-400">
                    I've already installed the GitHub App
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* Repository Step */}
          {currentStep === 'repository' && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                Add Your First Repository
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                You can add repositories now or later from the Repositories page.
              </p>
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg mb-4">
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  💡 Tip: After installing the GitHub App, your repositories will appear
                  automatically in the Repositories page.
                </p>
              </div>
              <Link
                href="/dashboard/repositories"
                className="block w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-center font-medium"
              >
                Go to Repositories →
              </Link>
              <p className="text-center text-sm text-gray-500 mt-4">
                Or continue to configure preferences first
              </p>
            </div>
          )}

          {/* Doc Types Step */}
          {currentStep === 'doc-types' && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                Documentation Types
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Select which types of documentation you want DocSynth to generate.
              </p>
              <div className="space-y-3">
                {[
                  { key: 'readme', label: 'README Updates', desc: 'Keep README files current with code changes' },
                  { key: 'apiDocs', label: 'API Documentation', desc: 'Generate OpenAPI specs and endpoint docs' },
                  { key: 'changelog', label: 'Changelog', desc: 'Automatic changelog entries from PRs' },
                  { key: 'guides', label: 'Guides & Tutorials', desc: 'Step-by-step guides for new features' },
                ].map((item) => (
                  <label
                    key={item.key}
                    className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={preferences.docTypes[item.key as keyof typeof preferences.docTypes]}
                      onChange={(e) =>
                        setPreferences((prev) => ({
                          ...prev,
                          docTypes: { ...prev.docTypes, [item.key]: e.target.checked },
                        }))
                      }
                      className="mt-1 rounded border-gray-300"
                    />
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">{item.label}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">{item.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Style Step */}
          {currentStep === 'style' && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                Writing Style
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Choose the tone and style for generated documentation.
              </p>
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Tone
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { value: 'technical', label: 'Technical', desc: 'Precise and detailed' },
                      { value: 'casual', label: 'Casual', desc: 'Friendly and approachable' },
                      { value: 'formal', label: 'Formal', desc: 'Professional and structured' },
                    ].map((tone) => (
                      <button
                        key={tone.value}
                        onClick={() =>
                          setPreferences((prev) => ({
                            ...prev,
                            style: { ...prev.style, tone: tone.value as typeof preferences.style.tone },
                          }))
                        }
                        className={`p-3 rounded-lg border text-left ${
                          preferences.style.tone === tone.value
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                            : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        <div className="font-medium text-gray-900 dark:text-white">{tone.label}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{tone.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={preferences.style.includeExamples}
                    onChange={(e) =>
                      setPreferences((prev) => ({
                        ...prev,
                        style: { ...prev.style, includeExamples: e.target.checked },
                      }))
                    }
                    className="rounded border-gray-300"
                  />
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">Include Code Examples</div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      Add practical examples to generated documentation
                    </div>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* Integrations Step */}
          {currentStep === 'integrations' && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                Optional Integrations
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Connect additional tools to provide more context for documentation.
              </p>
              <div className="space-y-3">
                {[
                  { key: 'jira', label: 'Jira', desc: 'Pull context from linked Jira tickets' },
                  { key: 'slack', label: 'Slack', desc: 'Gather context from related discussions' },
                  { key: 'linear', label: 'Linear', desc: 'Link issues for better context' },
                ].map((item) => (
                  <label
                    key={item.key}
                    className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={preferences.integrations[item.key as keyof typeof preferences.integrations]}
                      onChange={(e) =>
                        setPreferences((prev) => ({
                          ...prev,
                          integrations: { ...prev.integrations, [item.key]: e.target.checked },
                        }))
                      }
                      className="mt-1 rounded border-gray-300"
                    />
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">{item.label}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">{item.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
              <p className="text-sm text-gray-500 mt-4">
                You can configure these integrations later in Settings → Integrations
              </p>
            </div>
          )}

          {/* Complete Step */}
          {currentStep === 'complete' && (
            <div className="text-center">
              <span className="text-6xl block mb-4">🎉</span>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                You're All Set!
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                DocSynth is ready to start generating documentation for your repositories.
              </p>
              <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg text-left mb-6">
                <h3 className="font-medium text-green-800 dark:text-green-200 mb-2">Next Steps:</h3>
                <ul className="text-sm text-green-700 dark:text-green-300 space-y-1">
                  <li>1. Add repositories from the Repositories page</li>
                  <li>2. Merge a PR to trigger automatic documentation</li>
                  <li>3. Review and approve generated docs</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-between">
          <div>
            {currentStep !== 'welcome' && currentStep !== 'complete' && (
              <button
                onClick={goBack}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              >
                ← Back
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {currentStep !== 'complete' && (
              <button
                onClick={onSkip}
                className="px-4 py-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                Skip Setup
              </button>
            )}
            {currentStep === 'complete' ? (
              <button
                onClick={handleComplete}
                disabled={loading}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Get Started'}
              </button>
            ) : (
              <button
                onClick={goNext}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
              >
                Continue →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function useOnboarding() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const completed = localStorage.getItem(ONBOARDING_KEY);
    if (!completed) {
      setShowOnboarding(true);
    }
    setChecked(true);
  }, []);

  const completeOnboarding = () => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    setShowOnboarding(false);
  };

  const skipOnboarding = () => {
    localStorage.setItem(ONBOARDING_KEY, 'skipped');
    setShowOnboarding(false);
  };

  return { showOnboarding, checked, completeOnboarding, skipOnboarding };
}
