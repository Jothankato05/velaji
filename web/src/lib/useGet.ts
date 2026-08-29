import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, OfflineError } from './api';

interface State<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Small GET hook: fetches `path` (re-fetching when it changes), with
 *  loading/error state and a manual reload. */
export function useGet<T>(path: string | null): State<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(path));
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .get<T>(path)
      .then((d) => alive && setData(d))
      // Now that a session survives the app closing, a worker can reach these
      // panels with no signal, so "failed" has to distinguish a server that said
      // no from one that was never reached.
      .catch(
        (e) =>
          alive &&
          setError(
            e instanceof OfflineError
              ? 'No connection. This panel needs the network; recorded doses still sync when you are back in range.'
              : e instanceof ApiError
                ? e.message
                : 'Failed to load'
          )
      )
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path, nonce]);

  return { data, error, loading, reload };
}
