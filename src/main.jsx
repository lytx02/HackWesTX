import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.jsx';
import { ThemeProvider } from './theme/ThemeProvider.jsx';
import { SessionProvider } from './state/SessionContext.jsx';
import './theme/global.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 10_000, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>
);
