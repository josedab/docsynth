'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

interface OnboardingPath {
  id: string;
  title: string;
  description?: string;
  targetRole: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedHours: number;
  prerequisites: string[];
  stepsCount: number;
  completedCount: number;
  progress: number;
  isDefault: boolean;
}

interface OnboardingStep {
  id: string;
  orderIndex: number;
  title: string;
  description?: string;
  stepType: 'read_doc' | 'run_example' | 'quiz' | 'code_task';
  estimatedMins: number;
  isOptional: boolean;
  isCompleted: boolean;
  content: {
    documentId?: string;
    exampleCode?: string;
    quizQuestions?: { question: string; options: string[]; correct: number }[];
    taskDescription?: string;
  };
}

interface OnboardingPathsProps {
  repositoryId: string;
  token: string;
  userId: string;
  userRole?: string;
  userSkillLevel?: string;
}

export function OnboardingPaths({ repositoryId, token, userId, userRole, userSkillLevel }: OnboardingPathsProps) {
  const [paths, setPaths] = useState<OnboardingPath[]>([]);
  const [selectedPath, setSelectedPath] = useState<OnboardingPath | null>(null);
  const [steps, setSteps] = useState<OnboardingStep[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPaths = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiFetch<{ success: boolean; data: OnboardingPath[] }>(
        `/api/onboarding/repositories/${repositoryId}/paths?userId=${userId}`,
        { token }
      );
      setPaths(response.data);

      // Auto-select path in progress or recommended
      const inProgress = response.data.find(p => p.progress > 0 && p.progress < 100);
      const recommended = response.data.find(p => 
        p.targetRole === userRole || p.isDefault
      );
      if (inProgress) setSelectedPath(inProgress);
      else if (recommended) setSelectedPath(recommended);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load paths');
    } finally {
      setLoading(false);
    }
  }, [repositoryId, token, userId, userRole]);

  const fetchSteps = async (pathId: string) => {
    try {
      const response = await apiFetch<{ success: boolean; data: OnboardingStep[] }>(
        `/api/onboarding/paths/${pathId}/steps?userId=${userId}`,
        { token }
      );
      setSteps(response.data);

      // Find first incomplete step
      const firstIncomplete = response.data.findIndex(s => !s.isCompleted);
      setCurrentStepIndex(firstIncomplete >= 0 ? firstIncomplete : 0);
    } catch (err) {
      console.error('Failed to load steps:', err);
    }
  };

  const generatePersonalizedPath = async () => {
    try {
      setGenerating(true);
      setError(null);
      await apiFetch(`/api/onboarding/repositories/${repositoryId}/generate`, {
        method: 'POST',
        token,
        body: JSON.stringify({
          userId,
          role: userRole || 'fullstack',
          skillLevel: userSkillLevel || 'beginner',
        }),
      });
      fetchPaths();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate path');
    } finally {
      setGenerating(false);
    }
  };

  const handleCompleteStep = async (stepId: string) => {
    if (!selectedPath) return;

    try {
      await apiFetch(`/api/onboarding/paths/${selectedPath.id}/steps/${stepId}/complete`, {
        method: 'POST',
        token,
        body: JSON.stringify({ userId }),
      });

      // Update local state
      setSteps(prev => prev.map(s => 
        s.id === stepId ? { ...s, isCompleted: true } : s
      ));

      // Move to next step
      if (currentStepIndex < steps.length - 1) {
        setCurrentStepIndex(currentStepIndex + 1);
      }

      // Refresh path progress
      fetchPaths();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete step');
    }
  };

  useEffect(() => {
    fetchPaths();
  }, [fetchPaths]);

  useEffect(() => {
    if (selectedPath) {
      fetchSteps(selectedPath.id);
    }
  }, [selectedPath]);

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'beginner': return 'bg-green-100 text-green-800';
      case 'intermediate': return 'bg-yellow-100 text-yellow-800';
      case 'advanced': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStepTypeIcon = (type: string) => {
    switch (type) {
      case 'read_doc': return '📖';
      case 'run_example': return '▶️';
      case 'quiz': return '❓';
      case 'code_task': return '💻';
      default: return '📋';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  const currentStep = steps[currentStepIndex];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              🎓 Personalized Onboarding
            </h2>
            <p className="text-sm text-gray-500">
              AI-generated learning paths tailored to your role and experience
            </p>
          </div>
          <button
            onClick={generatePersonalizedPath}
            disabled={generating}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
          >
            {generating ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                Generating...
              </>
            ) : (
              <>
                <span>✨</span>
                Generate Path
              </>
            )}
          </button>
        </div>

        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
            {error}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Paths List */}
        <div className="space-y-3">
          <h3 className="font-medium text-gray-700">Available Paths</h3>
          {paths.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-4 text-center text-gray-500">
              <p>No paths available yet.</p>
              <p className="text-sm">Generate a personalized path to get started!</p>
            </div>
          ) : (
            paths.map((path) => (
              <div
                key={path.id}
                onClick={() => setSelectedPath(path)}
                className={`bg-white rounded-lg shadow p-4 cursor-pointer hover:shadow-md transition-shadow ${
                  selectedPath?.id === path.id ? 'ring-2 ring-blue-500' : ''
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="font-medium">{path.title}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`px-2 py-0.5 rounded text-xs ${getDifficultyColor(path.difficulty)}`}>
                        {path.difficulty}
                      </span>
                      <span className="text-xs text-gray-500">
                        {path.estimatedHours}h • {path.stepsCount} steps
                      </span>
                    </div>
                  </div>
                  {path.isDefault && (
                    <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                      Recommended
                    </span>
                  )}
                </div>

                {/* Progress bar */}
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Progress</span>
                    <span>{Math.round(path.progress)}%</span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all"
                      style={{ width: `${path.progress}%` }}
                    />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Current Step */}
        <div className="col-span-2">
          {selectedPath && currentStep ? (
            <div className="bg-white rounded-lg shadow">
              {/* Path header */}
              <div className="p-4 border-b bg-gradient-to-r from-blue-50 to-purple-50">
                <h3 className="font-semibold text-lg">{selectedPath.title}</h3>
                <p className="text-sm text-gray-600">{selectedPath.description}</p>
              </div>

              {/* Steps progress */}
              <div className="p-4 border-b">
                <div className="flex items-center gap-1">
                  {steps.map((step, i) => (
                    <div
                      key={step.id}
                      className={`flex-1 h-2 rounded-full cursor-pointer transition-colors ${
                        step.isCompleted ? 'bg-green-500' :
                        i === currentStepIndex ? 'bg-blue-500' : 'bg-gray-200'
                      }`}
                      onClick={() => setCurrentStepIndex(i)}
                      title={step.title}
                    />
                  ))}
                </div>
                <div className="text-sm text-gray-500 mt-2">
                  Step {currentStepIndex + 1} of {steps.length}
                </div>
              </div>

              {/* Current step content */}
              <div className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-2xl">{getStepTypeIcon(currentStep.stepType)}</span>
                  <div>
                    <h4 className="font-medium text-lg">{currentStep.title}</h4>
                    <div className="text-sm text-gray-500">
                      ~{currentStep.estimatedMins} mins
                      {currentStep.isOptional && ' • Optional'}
                    </div>
                  </div>
                </div>

                <p className="text-gray-700 mb-6">{currentStep.description}</p>

                {/* Step type specific content */}
                {currentStep.stepType === 'read_doc' && currentStep.content.documentId && (
                  <div className="bg-gray-50 rounded-lg p-4 mb-4">
                    <a
                      href={`#/documents/${currentStep.content.documentId}`}
                      className="text-blue-600 hover:underline flex items-center gap-2"
                    >
                      📄 Open documentation →
                    </a>
                  </div>
                )}

                {currentStep.stepType === 'run_example' && currentStep.content.exampleCode && (
                  <div className="bg-gray-900 rounded-lg p-4 mb-4 overflow-x-auto">
                    <pre className="text-green-400 text-sm font-mono">
                      {currentStep.content.exampleCode}
                    </pre>
                  </div>
                )}

                {currentStep.stepType === 'quiz' && currentStep.content.quizQuestions && (
                  <div className="space-y-4 mb-4">
                    {currentStep.content.quizQuestions.map((q, i) => (
                      <div key={i} className="bg-gray-50 rounded-lg p-4">
                        <div className="font-medium mb-2">{q.question}</div>
                        <div className="space-y-2">
                          {q.options.map((opt, j) => (
                            <label key={j} className="flex items-center gap-2 cursor-pointer">
                              <input type="radio" name={`quiz-${i}`} className="text-blue-600" />
                              <span>{opt}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {currentStep.stepType === 'code_task' && currentStep.content.taskDescription && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                    <div className="font-medium text-blue-800 mb-2">💡 Task</div>
                    <p className="text-blue-700">{currentStep.content.taskDescription}</p>
                  </div>
                )}

                {/* Navigation */}
                <div className="flex items-center justify-between pt-4 border-t">
                  <button
                    onClick={() => setCurrentStepIndex(Math.max(0, currentStepIndex - 1))}
                    disabled={currentStepIndex === 0}
                    className="px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50"
                  >
                    ← Previous
                  </button>

                  {currentStep.isCompleted ? (
                    <span className="text-green-600 flex items-center gap-1">
                      ✓ Completed
                    </span>
                  ) : (
                    <button
                      onClick={() => handleCompleteStep(currentStep.id)}
                      className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                    >
                      Mark Complete ✓
                    </button>
                  )}

                  <button
                    onClick={() => setCurrentStepIndex(Math.min(steps.length - 1, currentStepIndex + 1))}
                    disabled={currentStepIndex === steps.length - 1}
                    className="px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50"
                  >
                    Next →
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
              <div className="text-4xl mb-2">🎯</div>
              <div className="text-lg font-medium mb-2">Select a learning path</div>
              <div className="text-sm">
                Choose from available paths or generate a personalized one based on your profile
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
