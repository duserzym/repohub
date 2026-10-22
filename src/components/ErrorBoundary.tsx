import { Component, type ReactNode } from "react";
import { crashText, recordCrash, type CrashRecord } from "../lib/crash";

interface Props {
  children: ReactNode;
  where: string;
  /** Change this (e.g. the route) to clear the error and try again. */
  resetKey?: string;
}

interface State {
  crash: CrashRecord | null;
  retried: number;
}

/**
 * Keeps one bad render from blanking the whole window. The first crash is
 * retried automatically (most are transient, e.g. data arriving mid-refresh);
 * a repeat shows the error with Retry / Reload / Copy.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { crash: null, retried: 0 };
  private lastCrashAt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  static getDerivedStateFromError(): Partial<State> {
    return {};
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    const crash = recordCrash(error, this.props.where, info.componentStack ?? undefined);
    const now = Date.now();
    const repeat = now - this.lastCrashAt < 60_000;
    this.lastCrashAt = now;
    this.setState({ crash });
    if (!repeat) this.timer = setTimeout(() => this.reset(), 1500);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.crash && prev.resetKey !== this.props.resetKey) this.reset();
  }

  componentWillUnmount() {
    clearTimeout(this.timer);
  }

  reset = () => {
    clearTimeout(this.timer);
    this.setState((s) => ({ crash: null, retried: s.retried + 1 }));
  };

  render() {
    const c = this.state.crash;
    if (!c) return <div key={this.state.retried} style={{ display: "contents" }}>{this.props.children}</div>;
    return (
      <div className="center-fill">
        <div className="card panel crash-card">
          <h3>Something went wrong</h3>
          <p className="muted small">RepoHub hit an error while drawing this view. Your data and settings are safe.</p>
          <pre className="crash-msg">{c.message}</pre>
          <div className="row gap wrap">
            <button className="btn primary small" onClick={this.reset}>Try again</button>
            <button className="btn small" onClick={() => location.reload()}>Reload window</button>
            <button className="btn ghost small" onClick={() => void navigator.clipboard?.writeText(crashText(c))}>Copy details</button>
          </div>
        </div>
      </div>
    );
  }
}
