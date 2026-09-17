import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';
import { Shell } from '@/components/layout/shell';
import { AuthProvider } from '@/contexts/auth-context';
import { AuthGate } from '@/components/auth-gate';
import { useGuardedLocation } from '@/hooks/use-unsaved-changes';
import Home from '@/pages/home';
import About from '@/pages/about';
import Student from '@/pages/student';
import Driver from '@/pages/driver';
import Admin from '@/pages/admin';
import Account from '@/pages/account';
import Setup from '@/pages/setup';

const queryClient = new QueryClient();

function Router() {
  return (
    <Shell>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/about" component={About} />

          <Route path="/account" component={Account} />
          <Route path="/setup" component={Setup} />

          <Route path="/student">
            <AuthGate allowedRoles={['student', 'staff', 'driver', 'admin']}>
              <Student />
            </AuthGate>
          </Route>
          <Route path="/student.html">
            <AuthGate allowedRoles={['student', 'staff', 'driver', 'admin']}>
              <Student />
            </AuthGate>
          </Route>

          <Route path="/driver">
            <AuthGate allowedRoles={['driver']}>
              <Driver />
            </AuthGate>
          </Route>
          <Route path="/driver.html">
            <AuthGate allowedRoles={['driver']}>
              <Driver />
            </AuthGate>
          </Route>

          <Route path="/admin">
            <AuthGate allowedRoles={['admin']}>
              <Admin />
            </AuthGate>
          </Route>
          <Route path="/admin.html">
            <AuthGate allowedRoles={['admin']}>
              <Admin />
            </AuthGate>
          </Route>

          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </Shell>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')} hook={useGuardedLocation}>
            <Router />
          </WouterRouter>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
