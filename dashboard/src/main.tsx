import { StrictMode, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

import App from './app';
import { GraphQLClientProvider } from './gql/GraphQLClientProvider';
import { AuthProvider } from './contexts/auth/AuthContext';
import { SessionAwareApiProvider } from './contexts/api/SessionAwareApiProvider';
import { DebugProvider } from './contexts/debug/DebugContext';
import { SessionProvider } from './contexts/sessions';
import { ThemeProvider } from './components/theme-provider';
import { TooltipProvider } from './components/ui/tooltip';
import { Toaster } from './components/ui/toaster';
import '@fontsource/roboto-mono';
import '@fontsource/dm-mono';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

const router = createBrowserRouter(
  [
    {
      path: '*',
      element: (
        <ThemeProvider defaultTheme="dark" storageKey="pioneer-hq-theme">
          <TooltipProvider>
            <Suspense>
              <GraphQLClientProvider>
                <AuthProvider>
                  <DebugProvider>
                    <SessionProvider>
                      <SessionAwareApiProvider>
                        <App />
                        <Toaster />
                      </SessionAwareApiProvider>
                    </SessionProvider>
                  </DebugProvider>
                </AuthProvider>
              </GraphQLClientProvider>
            </Suspense>
          </TooltipProvider>
        </ThemeProvider>
      ),
    },
  ],
  { future: { v7_relativeSplatPath: true } }
);

root.render(
  <StrictMode>
    <HelmetProvider>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </HelmetProvider>
  </StrictMode>
);
