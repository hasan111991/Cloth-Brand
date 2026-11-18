import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message || 'An unexpected error occurred.' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Application ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(this.state.errorMessage);
      } catch {
        parsed = null;
      }

      return (
        <div className="min-h-screen bg-[#FAF9F6] text-[#141413] flex items-center justify-center p-6">
          <div className="max-w-xl w-full bg-white border border-[#E6E1D6] rounded-xl p-8 space-y-4">
            <h1 className="font-serif text-2xl font-semibold text-[#141413]">
              Operation Interrupted
            </h1>
            <p className="text-sm text-[#57534E] leading-relaxed">
              {parsed
                ? 'A database permission or validation rule blocked this request. Details are shown below for verification.'
                : this.state.errorMessage}
            </p>
            {parsed && (
              <pre className="text-xs font-mono bg-[#F5F2EB] border border-[#E6E1D6] rounded-lg p-4 overflow-x-auto text-[#141413]">
                {JSON.stringify(parsed, null, 2)}
              </pre>
            )}
            <div className="pt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-4 py-2 text-xs font-medium bg-[#0F3D2E] text-white rounded-lg hover:opacity-90 transition-opacity whitespace-nowrap"
              >
                Reload Application
              </button>
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, errorMessage: '' })}
                className="px-4 py-2 text-xs font-medium border border-[#E6E1D6] text-[#141413] rounded-lg hover:bg-[#F5F2EB] transition-colors whitespace-nowrap"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
