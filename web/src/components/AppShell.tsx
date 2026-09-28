import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { SearchBox } from './SearchBox';
import './AppShell.css';

type Role = 'admin' | 'staff' | 'verifier';
type NavItem = { to: string; label: string; roles: readonly Role[]; badge?: 'followUps' };

const NAV: Array<{ title?: string; items: NavItem[] }> = [
  { items: [{ to: '/dashboard', label: 'Overview', roles: ['admin'] }] },
  {
    title: 'At the clinic',
    items: [
      { to: '/care', label: 'Point of care', roles: ['staff', 'admin'] },
      { to: '/register', label: 'Register a child', roles: ['staff', 'admin'] },
      { to: '/terminal', label: 'Verify a card', roles: ['verifier', 'staff', 'admin'] }
    ]
  },
  {
    title: 'Families',
    items: [
      { to: '/escalations', label: 'Follow-up queue', roles: ['staff', 'admin'], badge: 'followUps' },
      { to: '/ussd', label: 'USSD access', roles: ['staff', 'admin'] }
    ]
  }
];

const ROLE_LABEL: Record<string, string> = { admin: 'Programme admin', staff: 'Health worker', verifier: 'Verifier' };

/** Fired by screens that change the follow-up queue, so the badge stays current. */
export const FOLLOW_UPS_CHANGED = 'velaji:follow-ups-changed';

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [followUps, setFollowUps] = useState<number | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);

  const role = (user?.role ?? '') as Role;
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((n) => n.roles.includes(role)) })).filter((g) => g.items.length);
  const seesFollowUps = role === 'staff' || role === 'admin';

  // The open follow-up count, refreshed on each navigation and whenever a
  // case is resolved. A failure just hides the badge.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-fetch on navigation
  useEffect(() => {
    if (!seesFollowUps) return;
    let live = true;
    const load = () =>
      api.get<{ open: number }>('/api/escalations/count')
        .then((r) => live && setFollowUps(r.open))
        .catch(() => live && setFollowUps(null));
    load();
    window.addEventListener(FOLLOW_UPS_CHANGED, load);
    return () => { live = false; window.removeEventListener(FOLLOW_UPS_CHANGED, load); };
  }, [seesFollowUps, location.pathname]);

  // Close the phone menu whenever the page changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: close on navigation
  useEffect(() => { setMenuOpen(false); }, [location.pathname, location.search]);

  // While the phone menu is open: Escape closes it, the page behind doesn't
  // scroll, and focus moves into the menu (and back to the button after).
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.classList.add('menu-open');
    sidebar.current?.querySelector<HTMLElement>('a, button')?.focus();
    const button = menuButton.current;
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('menu-open');
      button?.focus();
    };
  }, [menuOpen]);

  return (
    <div className="shell">
      <aside id="sidebar" ref={sidebar} className={`sidebar${menuOpen ? ' open' : ''}`} aria-label="Main menu">
        <div className="brand">Velaji</div>
        <nav className="nav">
          {groups.map((g) => (
            <div key={g.title ?? 'top'} className="nav-group">
              {g.title && <div className="nav-group-title">{g.title}</div>}
              {g.items.map((n) => (
                <NavLink key={n.to} to={n.to} className="nav-link">
                  <span>{n.label}</span>
                  {n.badge === 'followUps' && followUps !== null && followUps > 0 && (
                    <span className="nav-badge" title={`${followUps} open`}>{followUps}</span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="sidebar-user">
            <span className="user-name">{user?.fullName}</span>
            <span className="user-role">{ROLE_LABEL[role] ?? role}</span>
          </div>
          <button type="button" className="btn btn-sm sidebar-signout" onClick={logout}>Sign out</button>
        </div>
      </aside>
      {menuOpen && <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} aria-hidden />}

      <div className="main">
        <header className="topbar">
          <button
            ref={menuButton}
            type="button"
            className="menu-btn"
            aria-expanded={menuOpen}
            aria-controls="sidebar"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span className="menu-icon" aria-hidden />
            Menu
          </button>
          <SearchBox canSearchRecords={seesFollowUps} />
          <span className="topbar-date">{new Date().toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
