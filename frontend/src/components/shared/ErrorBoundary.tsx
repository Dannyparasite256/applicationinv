import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI crash:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-950">
          <div className="max-w-lg w-full rounded-xl border border-red-200 bg-white dark:bg-slate-900 p-6 shadow-lg">
            <h1 className="text-xl font-bold text-red-600 mb-2">Something went wrong</h1>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
              The page crashed. Try clearing session and reloading.
            </p>
            <pre className="text-xs bg-slate-100 dark:bg-slate-800 p-3 rounded-lg overflow-auto max-h-40 mb-4">
              {this.state.error.message}
            </pre>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  localStorage.removeItem('eims-auth');
                  window.location.href = '/login';
                }}
              >
                Clear session & go to Login
              </Button>
              <Button variant="outline" onClick={() => window.location.reload()}>
                Reload
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
