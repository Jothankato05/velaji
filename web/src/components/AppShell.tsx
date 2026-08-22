import { useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import './AppShell.css';

const OPERATIONS = [
  { to: '/dashboard', label: 'Command Centre', roles: ['admin'] },
  { to: '/care', label: 'Point of Care', roles: ['staff', 'admin'] },
  { to: '/register', label: 'Child Registry', roles: ['staff', 'admin'] },
  { to: '/terminal', label: 'Verify Card', roles: ['verifier', 'staff', 'admin'] },
  { to: '/escalations', label: 'Follow-up Queue', roles: ['staff', 'admin'] }
] as const;

function initials(name?: string) {
  if (!name) return '··';
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const ops = OPERATIONS.filter((n) => user && (n.roles as readonly string[]).includes(user.role));

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const v = search.trim();
    if (!v) return;
    // A CHIN goes straight to point of care; the system does the rest.
    navigate(`/care?chin=${encodeURIComponent(v.toUpperCase())}`);
    setSearch('');
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>◈</span>
          <div>
            <div className="brand-name">NCIHAP</div>
            <div className="brand-sub">National Health Network</div>
          </div>
        </div>

        <div className="nav-section">Operations</div>
        <nav className="nav">
          {ops.map((n) => (
            <NavLink key={n.to} to={n.to} className="nav-link">
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="status-card">
          <div className="status-dot" aria-hidden />
          <div>
            <div className="status-title">National Registry</div>
            <div className="status-sub">All services operational</div>
          </div>
        </div>
        <div className="sidebar-foot-note">Federal health infrastructure · Authorised access only</div>
      </aside>

      <div className="main">
        <header className="topbar">
          <form className="search" onSubmit={onSearch}>
            <span className="search-icon" aria-hidden>⌕</span>
            <input
              className="search-input"
              placeholder="Search CHIN, child or guardian…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search"
            />
          </form>
          <div className="topbar-right">
            <span className="topbar-date">{new Date().toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
            <button className="user-chip" onClick={logout} title="Sign out">
              <span className="user-av">{initials(user?.fullName)}</span>
              <span className="user-meta">
                <span className="user-name">{user?.fullName}</span>
                <span className="user-role">{user?.role}</span>
              </span>
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
