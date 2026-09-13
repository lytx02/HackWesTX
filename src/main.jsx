import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.jsx';
import { ThemeProvider } from './theme/ThemeProvider.jsx';
import AuthProvider from './auth/AuthProvider.jsx';
import './theme/global.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 10_000, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          {/* AuthProvider = Auth0 (when configured) + SessionProvider */}
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>
);
