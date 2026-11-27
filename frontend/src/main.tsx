// Must stay the first import: fills in crypto.randomUUID before any module uses it.
import './lib/polyfills';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { ErrorBoundary } from './components/ErrorBoundary';
import App from './App';
import { initApiBase, initAndroidCredentials } from './lib/api';
import { initAnalytics } from './lib/analytics';
import './index.css';

function applyTheme() {
  try {
    const raw = localStorage.getItem('openjarvis-settings');
    const settings = raw ? JSON.parse(raw) : {};
    const theme = settings.theme || 'system';
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else if (theme === 'light') {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    }
  } catch { /* use system default */ }
}

applyTheme();

// Render the interface immediately. Native credential storage can occasionally
// take longer during Android process recreation; it must never hold the WebView
// on a blank launch screen. API requests independently tolerate missing keys.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);

// Initialize native services in the background after the first paint.
void initApiBase()
  .then(() => initAndroidCredentials())
  .catch((error) => console.warn('JARVIS startup services were not fully initialized:', error));
void initAnalytics();
