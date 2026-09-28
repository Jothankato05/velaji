import { useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import './AppShell.css';

const OPERATIONS = [
  { to: '/dashboard', label: 'Overview', roles: ['admin'] },
  { to: '/care', label: 'Point of care', roles: ['staff', 'admin'] },
  { to: '/register', label: 'Register a child', roles: ['staff', 'admin'] },
  { to: '/terminal', label: 'Verify a card', roles: ['verifier', 'staff', 'admin'] },
  { to: '/escalations', label: 'Follow-up queue', roles: ['staff', 'admin'] },
  { to: '/ussd', label: 'USSD access', roles: ['staff', 'admin'] }
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const ops = OPERATIONS.filter((n) => user && (n.roles as readonly string[]).includes(user.role));

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const v = search.trim();
    if (!v) return;
    // A CHIN goes straight to point of care; a verifier, who can't use point of
    // care, gets the verification check instead.
    const screen = user?.role === 'verifier' ? '/terminal' : '/care';
    navigate(`${screen}?chin=${encodeURIComponent(v.toUpperCase())}`);
    setSearch('');
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Velaji</div>
        <nav className="nav">
          {ops.map((n) => (
            <NavLink key={n.to} to={n.to} className="nav-link">
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="main">
        <header className="topbar">
          <form className="search" onSubmit={onSearch}>
            <input
              className="search-input"
              placeholder="Find a child by CHIN"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Find a child by CHIN"
            />
          </form>
          <div className="topbar-right">
            <span className="topbar-date">{new Date().toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
            <span className="user-meta">
              <span className="user-name">{user?.fullName}</span>
              <span className="user-role">{user?.role}</span>
            </span>
            <button type="button" className="btn btn-sm" onClick={logout}>Sign out</button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
