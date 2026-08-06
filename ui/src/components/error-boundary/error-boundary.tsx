import { Component, ErrorInfo, ReactNode } from "react";
import { useLocation } from "react-router-dom";
import "./error-boundary.css";

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * When this value changes after an error was caught, the boundary
   * clears its error state and renders children again. Lets callers
   * recover from transient failures (e.g. a lazy-chunk load error)
   * without a full page reload.
   */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Catches render errors anywhere below it and shows a recoverable message
 * instead of a blank white page.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Render error:", error, info);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <p>Something went wrong displaying this page.</p>
          <button
            className="error-boundary-reload"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * ErrorBoundary that resets itself whenever the route changes, so a
 * transient failure on one page (e.g. a dynamic-import chunk that
 * failed to load) doesn't keep showing the error screen after the
 * visitor navigates elsewhere. Must be rendered inside a router.
 */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>;
}
