import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  onReset?: () => void;
};

type State = {
  hasError: boolean;
  error: Error | null;
  info: string | null;
};

// Catches render-time errors in the subtree (e.g. the Studio) so the app shows
// a readable message instead of a blank screen. Without this, any thrown error
// during render unmounts the whole tree and leaves an empty page.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface the full stack in the console for debugging.
    console.error('[Studio crash]', error, info.componentStack);
    this.setState({ info: info.componentStack ?? null });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const { error, info } = this.state;
    return (
      <div className="min-h-screen flex items-center justify-center p-6"
        style={{ background: 'var(--hero-bg-gradient)', color: 'var(--text-strong)' }}>
        <div className="max-w-lg w-full rounded-2xl border p-6"
          style={{ background: 'var(--surface-elevated)', borderColor: 'var(--surface-glass-border)' }}>
          <h2 className="text-lg font-bold mb-2">Studio failed to load</h2>
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            Something threw during render. The details below identify the cause.
          </p>
          <pre className="text-xs rounded-lg p-3 overflow-auto max-h-64 mb-4"
            style={{ background: 'rgba(0,0,0,0.35)', color: '#fca5a5' }}>
            {error?.name}: {error?.message}
            {info ? `\n${info.split('\n').slice(0, 6).join('\n')}` : ''}
          </pre>
          <button
            onClick={() => { this.setState({ hasError: false, error: null, info: null }); this.props.onReset?.(); }}
            className="h-9 px-4 rounded-lg text-sm font-semibold text-white"
            style={{ background: 'var(--hero-cta-gradient)' }}>
            Back to home
          </button>
        </div>
      </div>
    );
  }
}
