'use client';
import { useEffect, useRef, useState } from 'react';

interface SavedChat<T> { id: string; title: string; updated: string; snapshot: T }

/** Browser-local, repository-scoped conversations. Never stores provider credentials. */
export function useChatHistory<T>(key: string, snapshot: T, title: string, restore: (snapshot: T) => void) {
  const [chats, setChats] = useState<SavedChat<T>[]>([]);
  const [activeId, setActiveId] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const store = useRef<{ activeId: string; chats: SavedChat<T>[] } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const data = JSON.parse(raw);
        if (!Array.isArray(data.chats) || !data.chats.every((c: SavedChat<T>) =>
          typeof c.id === 'string' && typeof c.title === 'string' && c.snapshot && typeof c.updated === 'string')) {
          throw new Error('Invalid chat history');
        }
        const active = data.chats.find((c: SavedChat<T>) => c.id === data.activeId);
        if (active) restoreRef.current(active.snapshot);
        setChats(data.chats);
        setActiveId(active?.id || crypto.randomUUID());
      } else setActiveId(crypto.randomUUID());
      setReady(true);
    } catch {
      setError('Chat history could not be loaded. Existing saved data has been preserved.');
    }
  }, [key]);

  useEffect(() => {
    if (!ready || !activeId) return;
    const entry = { id: activeId, title: title || 'New chat', updated: new Date().toISOString(), snapshot };
    store.current = { activeId, chats: [entry, ...chats.filter(c => c.id !== activeId)] };
    const save = () => {
      try { localStorage.setItem(key, JSON.stringify(store.current)); setError(''); }
      catch { setError('Chat history could not be saved. Browser storage may be full or unavailable.'); }
    };
    const timer = setTimeout(save, 200);
    const flush = () => { clearTimeout(timer); save(); };
    window.addEventListener('pagehide', flush);
    return () => { clearTimeout(timer); window.removeEventListener('pagehide', flush); save(); };
  }, [key, snapshot, title, ready, activeId, chats]);

  const select = (id: string) => {
    const list = store.current?.chats || chats;
    const chat = list.find(c => c.id === id);
    if (!chat) return;
    restoreRef.current(chat.snapshot);
    setChats(list);
    setActiveId(id);
  };
  const startNew = () => {
    setChats(store.current?.chats || chats);
    setActiveId(crypto.randomUUID());
  };
  return { chats: store.current?.chats || chats, activeId, error, select, startNew };
}
