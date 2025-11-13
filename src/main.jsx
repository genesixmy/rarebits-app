
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@/App';
import '@/index.css';
import { AuthProvider } from '@/contexts/SupabaseAuthContext.jsx';
import { ThemeProvider } from '@/contexts/ThemeProvider';
import { EditingStateProvider } from '@/contexts/EditingStateContext';
import { Toaster } from '@/components/ui/toaster';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider storageKey="rarebits-theme">
          <AuthProvider>
            <EditingStateProvider>
              <App />
              <Toaster />
            </EditingStateProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </>
);
