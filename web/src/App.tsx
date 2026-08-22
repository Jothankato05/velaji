import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { AppShell } from './components/AppShell';
import { Login } from './screens/Login';
import { Dashboard } from './screens/Dashboard';
import { PointOfCare } from './screens/PointOfCare';
import { Register } from './screens/Register';
import { Escalations } from './screens/Escalations';
import { Terminal } from './screens/Terminal';
import { MyChildApp } from './mychild/MyChildApp';
import type { ReactNode } from 'react';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
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
      {/* MyChild — the family app. A separate world, no staff login; the
          parent's card is their key. */}
      <Route path="/mychild" element={<MyChildApp />} />
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <AppShell>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/care" element={<PointOfCare />} />
                <Route path="/register" element={<Register />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/terminal" element={<Terminal />} />
                <Route path="/escalations" element={<Escalations />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AppShell>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
