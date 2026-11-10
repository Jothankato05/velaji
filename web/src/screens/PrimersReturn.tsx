import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { finishPrimersSignIn } from '../lib/primersId';

/** Where Primers ID sends staff back with a one-time code (to sign in, or to connect it). */
export function PrimersReturn() {
  const { primers } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [back, setBack] = useState('/login');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // a code works once
    ran.current = true;
    let mode: 'signin' | 'link' = 'signin';
    (async () => {
      try {
        const r = finishPrimersSignIn();
        mode = r.mode;
        await primers(r.mode, r.code, r.verifier);
        navigate(r.returnTo, { replace: true });
      } catch (err) {
        setBack(mode === 'link' ? '/' : '/login');
        setError(err instanceof Error ? err.message : "Couldn't finish with Primers ID");
      }
    })();
  }, [primers, navigate]);

  return (
    <div className="login">
      <div className="login-col">
        <div className="login-form">
          <div className="login-brand">Velaji</div>
          {error ? (
            <>
              <h1>That didn’t finish</h1>
              <div className="banner error" role="alert">{error}</div>
              <Link to={back} className="btn btn-primary login-submit">Go back</Link>
            </>
          ) : (
            <p className="muted">Connecting with Primers ID…</p>
          )}
        </div>
      </div>
    </div>
  );
}
