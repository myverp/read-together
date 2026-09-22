"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './client';
import type { DrawingInput, DrawingState } from './drawings';
export function useDrawings(code: string) {
  const [state, setState] = useState<DrawingState>({ revision: -1, items: [] });
  const [error, setError] = useState('');
  const active = useRef(true);
  const fetching = useRef(false);
  const endpoint = `/api/rooms/${code}/drawings`;
  const accept = useCallback((next: DrawingState) => {
    if (active.current) { setState(current => next.revision > current.revision ? next : current); setError(''); }
  }, []);
  const refresh = useCallback(async () => {
    if (document.visibilityState !== 'visible' || !navigator.onLine || fetching.current) return;
    fetching.current = true;
    try { accept(await api<DrawingState>(endpoint, undefined, 'GET')); }
    catch { if (active.current) setError('Drawings could not sync. Reconnecting automatically…'); }
    finally { fetching.current = false; }
  }, [accept, endpoint]);
  useEffect(() => {
    active.current = true; void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    window.addEventListener('online', refresh); window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { active.current = false; clearInterval(timer); window.removeEventListener('online', refresh); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [refresh]);
  const save = async (input: DrawingInput) => accept(await api<DrawingState>(endpoint, input));
  const remove = async (id: string) => accept(await api<DrawingState>(endpoint, { id }, 'DELETE'));
  return { drawings: state.items, error, refresh, save, remove };
}
