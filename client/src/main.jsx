import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { BrowserRouter } from 'react-router-dom'
import { store } from './app/store.js'
import { Provider } from 'react-redux'
import { ClerkProvider } from '@clerk/clerk-react'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!PUBLISHABLE_KEY) {
  throw new Error('Missing Publishable Key')
}

// Suppress unhandled errors from injected browser extensions (e.g. 200.js M_ID or malformed extension JSON parsing)
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const msg = event.reason?.message || '';
    const stack = event.reason?.stack || '';
    if (
      msg.includes("M_ID") ||
      stack.includes('200.js') ||
      msg.includes("Unexpected end of JSON input")
    ) {
      event.preventDefault();
    }
  });

  window.addEventListener('error', (event) => {
    const msg = event.message || '';
    const file = event.filename || '';
    if (
      file.includes('200.js') ||
      msg.includes("M_ID") ||
      msg.includes("Unexpected end of JSON input")
    ) {
      event.preventDefault();
    }
  });
}

createRoot(document.getElementById('root')).render(
    <BrowserRouter>
        <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
            <Provider store={store}>
                <App />
            </Provider>
        </ClerkProvider>
    </BrowserRouter>,
)