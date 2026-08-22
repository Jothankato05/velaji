import type { ReactNode } from 'react';

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="ui-loading muted mono">{label}</div>;
}

export function ErrorNote({ message }: { message: string }) {
  return <div className="banner error" role="alert">{message}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="ui-empty muted">{children}</div>;
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill ${status}`}>{status}</span>;
}

export function fmt(n: number): string {
  return n.toLocaleString('en-NG');
}
export function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
