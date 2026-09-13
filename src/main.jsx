import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { ThemeProvider } from './theme/ThemeProvider.jsx';
import { SessionProvider } from './state/SessionContext.jsx';
import { DataProvider } from './state/DataContext.jsx';
import './theme/global.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <SessionProvider>
        <DataProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </DataProvider>
      </SessionProvider>
    </ThemeProvider>
  </React.StrictMode>
);
