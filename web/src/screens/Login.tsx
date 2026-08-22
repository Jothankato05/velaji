import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import './Login.css';

export function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <section className="login-brand">
        <div className="login-mark" aria-hidden>◈</div>
        <h1>NCIHAP</h1>
        <p className="login-tagline">
          One child. One record. Every vaccine. Everywhere.
        </p>
        <p className="login-desc">
          National Child Immunisation &amp; Health Assurance Programme — a
          lifelong, verifiable immunisation record for every Nigerian child.
        </p>
      </section>

      <section className="login-form-wrap">
        <form className="login-form" onSubmit={onSubmit}>
          <div className="eyebrow">Authorised access</div>
          <h2>Sign in to the registry</h2>
          <p className="muted login-form-sub">
            For registered facility staff and programme administrators.
          </p>

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

          <button className="btn btn-primary login-submit" disabled={busy || !username || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="login-note muted">
            No self-registration. Accounts are issued by a programme administrator.
          </p>
        </form>
      </section>
    </div>
  );
}
