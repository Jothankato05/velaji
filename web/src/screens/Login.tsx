import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { ApiError, OfflineError } from '../lib/api';
import './Login.css';

/**
 * Demo credentials, pre-filled into the form so a reviewer can sign in without
 * being handed a username out of band.
 *
 * Deliberately driven by build-time env vars rather than hardcoded: they are
 * only ever set on the public demo instance, whose data is entirely invented.
 * A real deployment builds without them and the fields come up empty, so this
 * convenience cannot follow the app to somewhere it would be a vulnerability.
 */
const DEMO_USERNAME = import.meta.env.VITE_DEMO_USERNAME ?? '';
const DEMO_PASSWORD = import.meta.env.VITE_DEMO_PASSWORD ?? '';
const IS_DEMO = Boolean(DEMO_USERNAME && DEMO_PASSWORD);

export function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState(DEMO_USERNAME);
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      // Being unreachable is not the same as being refused. Signing in is the
      // one action the offline shell cannot complete, so say so plainly rather
      // than leaving someone retrying a password that was never the problem.
      if (err instanceof OfflineError) {
        setError(
          'No connection, so signing in is not possible right now. ' +
            'The app opens offline, but the first sign-in on this device needs a network.'
        );
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not sign in. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <section className="login-brand">
        <div className="login-mark" aria-hidden>◈</div>
        <h1>Velaji</h1>
        <p className="login-tagline">
          One child. One record. Every vaccine. Everywhere.
        </p>
        <p className="login-desc">
          The platform delivering NCIHAP, Nigeria&rsquo;s National Child
          Immunisation &amp; Health Assurance Programme: a lifelong, verifiable
          immunisation record for every child.
        </p>
      </section>

      <section className="login-form-wrap">
        <form className="login-form" onSubmit={onSubmit}>
          <div className="eyebrow">Authorised access</div>
          <h2>Sign in to the registry</h2>
          <p className="muted login-form-sub">
            For registered facility staff and programme administrators.
          </p>

          {IS_DEMO && (
            <div className="banner demo-note">
              <strong>Demo instance.</strong> Credentials are filled in, so just
              press Sign in. Every child in this dataset is invented.
            </div>
          )}

          {error && <div className="banner error" role="alert">{error}</div>}

          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              className="input"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button type="submit" className="btn btn-primary login-submit" disabled={busy || !username || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="login-note muted">
            No self-registration. Accounts are issued by a programme administrator.
          </p>
          {/* Maker credit, kept small and singular: the product is Velaji, the
              team is Primers, and only one of those belongs in a product header. */}
          <p className="muted login-built-by">
            Built by Team Primers.
          </p>
        </form>
      </section>
    </div>
  );
}
