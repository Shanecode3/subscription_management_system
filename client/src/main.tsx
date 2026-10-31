import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './lib/auth-context';
import './index.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root container #root is missing from index.html.');
}

createRoot(container).render(
  <StrictMode>
    {/* v7 future flags keep the console free of removal warnings on v6.26. */}
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
