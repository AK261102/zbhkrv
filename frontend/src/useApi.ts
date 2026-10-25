import { useEffect, useRef, useState } from 'react'

/**
 * Fetch whenever `key` changes (null = don't fetch). The previous value is kept while
 * a new one loads, so charts dim instead of flashing a skeleton.
 */
export function useApi<T>(key: string | null, load: () => Promise<T>) {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>(
    { key: null, data: null, error: null })
  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load })
  useEffect(() => {
    if (key === null) return
    let stale = false
    loadRef.current()
      .then((data) => { if (!stale) setState({ key, data, error: null }) })
      .catch((e: Error) => { if (!stale) setState((s) => ({ ...s, key, error: e.message })) })
    return () => { stale = true }
  }, [key])
  return { data: state.data, error: state.error, loading: key !== null && state.key !== key }
}
