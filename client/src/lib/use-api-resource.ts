import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiRequest } from './api';
import { useAuth } from './auth-context';

interface Resource<T> {
  data: T | null;
  setData: (next: T | null) => void;
  isLoading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Loads one API resource and keeps loading/error state in one place, so each
 * page does not re-implement the same effect. `reload` re-runs the request;
 * `setData` lets a page apply the object a mutation returned without refetching.
 */
export function useApiResource<T>(path: string): Resource<T> {
  const { token } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    let cancelled = false;

    if (!token) {
      setIsLoading(false);
      setError('Your session has expired. Please sign in again.');
      return;
    }

    setIsLoading(true);
    setError(null);

    apiRequest<T>(path, { token })
      .then((result) => {
        if (!cancelled) setData(result.data);
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        setError(
          requestError instanceof ApiError
            ? requestError.message
            : 'Something went wrong while loading this page.',
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [path, token, reloadKey]);

  return { data, setData, isLoading, error, reload };
}
