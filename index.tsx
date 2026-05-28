
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Dynamically inject the Google Maps API Script
const loadGoogleMapsScript = () => {
  if (typeof window !== 'undefined' && !(window as any).google) {
    let key = '';
    
    // Check import.meta.env for VITE variable
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      key = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) || '';
    }
    
    // Fallback to process.env safely
    if (!key) {
      try {
        if (typeof process !== 'undefined' && process.env) {
          key = (process.env as any).GOOGLE_MAPS_API_KEY || '';
        }
      } catch (e) {
        // Safe catch
      }
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=geometry,places`;
    script.async = true;
    script.defer = true;
    script.id = 'google-maps-api-script';
    document.head.appendChild(script);
  }
};

loadGoogleMapsScript();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
