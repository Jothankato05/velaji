import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { AppShell } from './components/AppShell';
import { Login } from './screens/Login';
import { Dashboard } from './screens/Dashboard';
import { PointOfCare } from './screens/PointOfCare';
import { Register } from './screens/Register';
import { Escalations } from './screens/Escalations';
import { Terminal } from './screens/Terminal';
import { UssdSim } from './screens/UssdSim';
import { MyChildApp } from './mychild/MyChildApp';
import type { ReactNode } from 'react';

const STAFF = ['staff', 'admin'];

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Screens a role can't use send it home rather than showing a page whose
 *  data calls would all be refused (the same roles the menu shows them to). */
function RoleRoute({ roles, children }: { roles: string[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Land each role on the screen that matters to them: admins on the national
 *  command dashboard, everyone else on point of care. */
function Home() {
  const { user } = useAuth();
  if (user?.role === 'admin') return <Navigate to="/dashboard" replace />;
  if (user?.role === 'verifier') return <Navigate to="/terminal" replace />;
  return <Navigate to="/care" replace />;
}

export function App() {
  const { user } = useAuth();

  return (
    <Routes>
      {/* MyChild, the family app. A separate world, no staff login; the
          parent's card is their key. */}
      <Route path="/mychild/*" element={<MyChildApp />} />
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <AppShell>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/care" element={<RoleRoute roles={STAFF}><PointOfCare /></RoleRoute>} />
                <Route path="/register" element={<RoleRoute roles={STAFF}><Register /></RoleRoute>} />
                <Route path="/dashboard" element={<RoleRoute roles={['admin']}><Dashboard /></RoleRoute>} />
                <Route path="/terminal" element={<Terminal />} />
                <Route path="/escalations" element={<RoleRoute roles={STAFF}><Escalations /></RoleRoute>} />
                <Route path="/ussd" element={<RoleRoute roles={STAFF}><UssdSim /></RoleRoute>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AppShell>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
