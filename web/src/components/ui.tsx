import type { ReactNode } from 'react';

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="ui-loading muted">{label}</div>;
}

export function ErrorNote({ message }: { message: string }) {
  return <div className="banner error" role="alert">{message}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="ui-empty muted">{children}</div>;
}

const STATUS_LABEL: Record<string, string> = {
  GREEN: 'On track', AMBER: 'Due soon', RED: 'Overdue', BLUE: 'Complete', GREY: 'Needs review'
};

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill ${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function fmt(n: number): string {
  return n.toLocaleString('en-NG');
}
export function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
