import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Optional callback when an error is caught (e.g., to reset context state). */
  onError?: (error: Error) => void;
  /** Label for logging — identifies which boundary caught the error. */
  label?: string;
}

interface State {
  hasError: boolean;
}

/**
 * A silent error boundary that catches render errors and renders nothing.
 * Used for non-critical overlays (e.g., MatchSplash) where a crash should
 * be swallowed rather than crashing the entire app.
 */
export default class SilentErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const label = this.props.label || 'SilentErrorBoundary';
    console.warn(`[${label}] Swallowed render error:`, error.message);
    this.props.onError?.(error);
  }

  render() {
    if (this.state.hasError) {
      // Render nothing — the feature gracefully disappears
      return null;
    }
    return this.props.children;
  }
}
