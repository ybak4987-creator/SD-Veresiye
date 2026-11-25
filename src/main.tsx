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
    // index.html'in <title>'ı "SD Veresiye · Ferhat Büfe"; sekme başlığı burada
    // sadeleştiriliyor. Boş sayfa görünmemesi için <div id="root"> içindeki
    // açılış yazısını React ilk render'ı temizler.
  }, []);

  return <App />;
}

createRoot(document.getElementById('root')!).render(<Root />);
