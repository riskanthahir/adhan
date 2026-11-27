import React from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  resetKey?: string | number;
  onResetToHome?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

function sanitizeUiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || 'Unexpected rendering error');
  return raw
    .replace(/https?:\/\/([a-zA-Z0-9.-]+)\/[^\s"'`<>]+/g, 'https://$1/[redacted-path]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]')
    .slice(0, 260);
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
    };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: sanitizeUiError(error),
    };
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, errorMessage: '' });
    }
  }

  componentDidCatch(error: unknown): void {
    // Intentionally concise sanitized log without sensitive state
    console.error('[UI ErrorBoundary]', sanitizeUiError(error));
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, errorMessage: '' });
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <section
        role="alert"
        className="mx-auto my-4 max-w-2xl rounded-3xl border border-rose-300 bg-rose-50/90 p-5 sm:p-6 text-rose-950 dark:border-rose-800/70 dark:bg-rose-950/40 dark:text-rose-100"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0 text-rose-700 dark:text-rose-300"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1 space-y-2">
            <h2 className="text-base font-semibold">This view encountered an unexpected error</h2>
            <p className="text-xs leading-relaxed text-rose-900/90 dark:text-rose-200/90 break-words">
              {this.state.errorMessage || 'An unexpected interface error occurred.'}
            </p>
            <div className="flex flex-wrap gap-2.5 pt-2">
              <button
                type="button"
                onClick={this.handleRetry}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-rose-800 px-3.5 text-xs font-semibold text-white hover:bg-rose-900 dark:bg-rose-700"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Retry View</span>
              </button>
              {this.props.onResetToHome && (
                <button
                  type="button"
                  onClick={() => {
                    this.setState({ hasError: false, errorMessage: '' });
                    this.props.onResetToHome?.();
                  }}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-rose-300 bg-white px-3.5 text-xs font-semibold text-rose-900 hover:bg-rose-100 dark:border-rose-700 dark:bg-slate-900 dark:text-rose-200"
                >
                  <Home className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Back to Today</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }
}
