import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';

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
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : 'Failed to load'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path, nonce]);

  return { data, error, loading, reload };
}
