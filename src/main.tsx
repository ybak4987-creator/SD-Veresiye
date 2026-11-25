import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

/**
 * Uygulama adı: SD Veresiye
 * Rota /admin ise sekme başlığı yönetim olarak ayarlanır.
 */
function Root() {
  useEffect(() => {
    const isAdmin = window.location.pathname.replace(/\/+$/, '') === '/admin';
    document.title = isAdmin ? 'SD Veresiye · Yönetim' : 'SD Veresiye';
  }, []);

  return <App />;
}

createRoot(document.getElementById('root')!).render(<Root />);
