import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import './AppShell.css';

const NAV = [
  { to: '/care', label: 'Point of Care', roles: ['staff', 'admin'] },
  { to: '/register', label: 'Register a Child', roles: ['staff', 'admin'] },
  { to: '/terminal', label: 'Verify Card', roles: ['verifier', 'staff', 'admin'] },
  { to: '/escalations', label: 'Follow-up Queue', roles: ['staff', 'admin'] },
  { to: '/dashboard', label: 'Command Dashboard', roles: ['admin'] }
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const items = NAV.filter((n) => user && (n.roles as readonly string[]).includes(user.role));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>◈</span>
          <div>
            <div className="brand-name">Velaji</div>
            <div className="brand-sub">Child Health Assurance</div>
          </div>
        </div>

        <nav className="nav">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} className="nav-link">
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="who">
            <div className="who-name">{user?.fullName}</div>
            <div className="who-role mono">{user?.role}</div>
          </div>
          <button className="btn" onClick={logout}>Sign out</button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="crumbs mono">
            {location.pathname === '/' ? 'command-dashboard' : location.pathname.slice(1)}
          </div>
          <div className="topbar-note eyebrow">Velaji · NCIHAP platform · prototype</div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
