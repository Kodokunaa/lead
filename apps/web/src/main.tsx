import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthStore } from './auth/auth-store';
import { AuthProvider } from './auth/session';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

const store = new AuthStore();
// In development, a hot reload replaces this module; stop the old store listening to other tabs.
import.meta.hot?.dispose(() => store.close());

createRoot(container).render(
  <StrictMode>
    <AuthProvider store={store}>
      <App />
    </AuthProvider>
  </StrictMode>,
);
