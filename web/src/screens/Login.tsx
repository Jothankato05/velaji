import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
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
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  const demoEdited = IS_DEMO && (username !== DEMO_USERNAME || password !== DEMO_PASSWORD);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
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
      } else if (err instanceof ApiError && err.status === 401) {
        setError('That username and password don’t match. Check them and try again.');
        setPassword('');
        passwordRef.current?.focus();
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not sign in. Try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  function restoreDemo() {
    setUsername(DEMO_USERNAME);
    setPassword(DEMO_PASSWORD);
    setError('');
  }

  return (
    <div className="login">
      <div className="login-col">
        <form className="login-form" onSubmit={onSubmit}>
          <div className="login-brand">Velaji</div>
          <h1>Staff sign in</h1>
          <p className="muted login-form-sub">For health facility staff and programme administrators.</p>

          {IS_DEMO && (
            <div className="banner demo-note">
              {demoEdited ? (
                <>
                  This is a demo with invented children.{' '}
                  <button type="button" className="login-linkbtn" onClick={restoreDemo}>Fill in the demo login again</button>
                </>
              ) : (
                <>This is a demo with invented children. The login is filled in, so press <strong>Sign in</strong>.</>
              )}
            </div>
          )}

          {error && <div className="banner error" role="alert">{error}</div>}

          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              className="input"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus={!IS_DEMO}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="login-pw">
              <input
                id="password"
                ref={passwordRef}
                className="input"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="login-pw-toggle"
                onClick={() => setShowPassword((s) => !s)}
                aria-pressed={showPassword}
                aria-controls="password"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <button type="submit" className="btn btn-primary login-submit" disabled={busy} autoFocus={IS_DEMO}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="login-note muted">Forgot your password or need an account? Ask your programme administrator.</p>
        </form>

        <Link to="/mychild" className="login-parent">
          <span>
            <strong>Parent or caregiver?</strong>
            <span className="muted"> See your child’s vaccines with the card from the clinic.</span>
          </span>
          <span aria-hidden className="login-parent-arrow">→</span>
        </Link>

        <p className="login-credit muted">Built by Team Primers</p>
      </div>
    </div>
  );
}
