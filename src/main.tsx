import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Açılış ekranı (index.html içindeki #boot-screen) React ilk render'ında
// otomatik olarak silinir: createRoot kökün içeriğini temizler.
createRoot(document.getElementById('root')!).render(<App />);

// Service worker: uygulama kabuğunu önbelleğe alır, ikinci açılışı hızlandırır.
// Yalnızca üretimde ve destekleyen tarayıcılarda devreye girer.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* Kayıt başarısız olsa da uygulama normal çalışır. */
    });
  });
}
