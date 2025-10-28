
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@/App';
import '@/index.css';
import { AuthProvider } from '@/contexts/SupabaseAuthContext.jsx';
import { ThemeProvider } from '@/contexts/ThemeProvider';
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
            <App />
            <Toaster />
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </>
);
