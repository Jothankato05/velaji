import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, OfflineError } from '../lib/api';
import { StatusPill } from './ui';

interface Result {
  chin: string;
  fullName: string;
  dateOfBirth: string;
  status: string;
  facility: string | null;
  caregiverName: string | null;
  caregiverPhone: string | null;
}

/** Looks like a whole CHIN, e.g. NG-25-07-43668961. */
const FULL_CHIN = /^[A-Z]{2}-?\d{2}-?\d{2}-?\d{6,}$/i;

function ageLabel(dob: string): string {
  const days = Math.floor((Date.now() - new Date(dob).getTime()) / 86_400_000);
  if (days < 7) return 'newborn';
  if (days < 60) return `${Math.floor(days / 7)} weeks`;
  const months = Math.floor(days / 30.44);
  if (months < 24) return `${months} months`;
  return `${Math.floor(months / 12)} years`;
}

/**
 * The top-bar search. Staff and admins find a child by name, caregiver, phone
 * or part of the CHIN, with results as they type. A verifier can't see
 * records, so for them it takes a CHIN to the verification check.
 */
export function SearchBox({ canSearchRecords }: { canSearchRecords: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [more, setMore] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'offline' | 'error'>('idle');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const query = q.trim();

  // Results as they type, a moment after they pause. Only the latest answer counts.
  useEffect(() => {
    if (!canSearchRecords || query.length < 2) {
      setResults([]);
      setState('idle');
      return;
    }
    setState('loading');
    let live = true;
    const t = window.setTimeout(() => {
      api.get<{ results: Result[]; more: boolean }>(`/api/children/search?q=${encodeURIComponent(query)}`)
        .then((r) => { if (live) { setResults(r.results); setMore(r.more); setActive(0); setState('done'); } })
        .catch((err) => { if (live) { setResults([]); setState(err instanceof OfflineError ? 'offline' : 'error'); } });
    }, 220);
    return () => { live = false; window.clearTimeout(t); };
  }, [query, canSearchRecords]);

  // Close when the page changes or on a click elsewhere.
  // biome-ignore lint/correctness/useExhaustiveDependencies: close on navigation
  useEffect(() => { setOpen(false); }, [location.pathname, location.search]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // "/" jumps to the search from anywhere that isn't a text field.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      input.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function go(chin: string) {
    const screen = canSearchRecords ? '/care' : '/terminal';
    navigate(`${screen}?chin=${encodeURIComponent(chin.toUpperCase())}`);
    setQ('');
    setOpen(false);
    input.current?.blur();
  }

  function submit() {
    if (!query) return;
    if (canSearchRecords && results[active] && state === 'done') return go(results[active].chin);
    // No list to pick from (a verifier, or offline): a whole CHIN still works.
    if (FULL_CHIN.test(query.replace(/\s+/g, '')) || !canSearchRecords) return go(query.replace(/\s+/g, ''));
    setOpen(true);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault(); setOpen(true); setActive((a) => (a + 1) % results.length);
    } else if (e.key === 'ArrowUp' && results.length) {
      e.preventDefault(); setOpen(true); setActive((a) => (a - 1 + results.length) % results.length);
    } else if (e.key === 'Escape') {
      if (open) setOpen(false); else { setQ(''); input.current?.blur(); }
    }
  }

  const showPanel = open && canSearchRecords && query.length >= 2;
  const optionId = (i: number) => `${listId}-opt-${i}`;

  return (
    <div className="search" ref={box}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input
          ref={input}
          className="search-input"
          type="search"
          placeholder={canSearchRecords ? 'Search child, parent, phone or CHIN' : 'Check a card by CHIN'}
          aria-label={canSearchRecords ? 'Search for a child by name, parent, phone or CHIN' : 'Check a card by CHIN'}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showPanel && results[active] ? optionId(active) : undefined}
        />
        <kbd className="search-kbd" aria-hidden>/</kbd>
      </form>

      {showPanel && (
        <div className="search-panel">
          {state === 'loading' && !results.length && <div className="search-msg">Searching…</div>}
          {state === 'done' && !results.length && (
            <div className="search-msg">No child matches “{query}”. Try the parent’s phone or part of the CHIN.</div>
          )}
          {state === 'offline' && (
            <div className="search-msg">Search needs a connection. Type the whole CHIN and press Enter to open a child saved on this device.</div>
          )}
          {state === 'error' && <div className="search-msg">Search isn’t working right now. Try again.</div>}
          {results.length > 0 && (
            <div className="search-list" id={listId} role="listbox" aria-label="Children">
              {results.map((r, i) => (
                <div
                  key={r.chin}
                  tabIndex={-1}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  className={`search-item${i === active ? ' active' : ''}`}
                  onMouseMove={() => i !== active && setActive(i)}
                  onMouseDown={(e) => { e.preventDefault(); go(r.chin); }}
                >
                  <div className="search-item-top">
                    <span className="search-name">{r.fullName}</span>
                    <StatusPill status={r.status} />
                  </div>
                  <div className="search-meta">
                    {ageLabel(r.dateOfBirth)} · {r.chin}{r.facility ? ` · ${r.facility}` : ''}
                  </div>
                  {r.caregiverName && (
                    <div className="search-meta">
                      {r.caregiverName}{r.caregiverPhone ? `, ${r.caregiverPhone}` : ''}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {more && results.length > 0 && <div className="search-msg search-more">Showing the first {results.length}. Add more of the name, or the phone, to narrow it down.</div>}
        </div>
      )}
    </div>
  );
}
