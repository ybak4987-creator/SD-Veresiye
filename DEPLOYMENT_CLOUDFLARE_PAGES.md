# Silopi Dijital Veresiye 0.2.9 — Cloudflare Pages kurulumu

Bu sürüm, Vite ile oluşturulan statik arayüzü ve Cloudflare Pages Function API rotalarını aynı alan adında çalıştırır. Tarayıcı yalnızca `/api/veresiye/...` adreslerine istek gönderir. Cloudflare Function sunucu tarafında kişisel Yunus ProPOS Supabase projesine iletir.

## Cloudflare Pages projesi

1. Cloudflare hesabında **Workers & Pages → Create application → Pages → Connect to Git** yolunu aç.
2. GitHub'da `yinreat1/veresiye-silopidijital` deposunu seç ve üretim dalı olarak `main` belirle.
3. Proje adını `silopidijital-veresiye` yap. Bu ad `wrangler.toml` içindeki adla aynı olmalıdır.
4. Build ayarları:
   - Framework preset: **Vite**
   - Root directory: `/` (depo kökü)
   - Build command: `npm run check` (typecheck + lint + regression/API tests + production build)
   - Build output directory: `dist`
   - Environment variable: `NODE_VERSION=22` (Production ve Preview için); depo kökündeki `.nvmrc` da 22 olarak ayarlı
5. Save and Deploy seçeneğiyle ilk dağıtımı başlat.

`functions/` klasörü depo kökünde bulunmalıdır; `dist/` içine taşınmamalıdır. Cloudflare Pages, bu klasörden API rotalarını otomatik oluşturur.

## API rotaları

- `GET /api/veresiye/health` — gerçek Supabase Edge Function'a boş giriş isteği gönderir; yalnızca beklenen HTTP 401 ve geçersiz giriş kodu yanıtını görünce `success: true` döndürür.
- `POST /api/veresiye/veresiye-portal-login` — müşteri girişini iletir.
- `POST /api/veresiye/veresiye-portal-admin` — yönetici PIN ve müşteri erişim işlemlerini iletir.

## Yayın sonrası kontrol

1. `https://<proje-adı>.pages.dev/api/veresiye/health` adresini aç. Beklenen cevap HTTP 200 ve `success: true` içeren JSON'dur.
2. Müşteri ekranında var olan altı haneli kodla giriş yap.
3. Yönetici ekranında var olan ProPOS yönetici PIN koduyla giriş yap.
4. Yönetici panelinde müşteri listesini, kod göster/gizle, kod yenile ve erişimi aç/kapat işlevlerini test et.
5. Telefon tarayıcısından da giriş ve çıkışı kontrol et.

Sağlık kontrolü HTTP 502 dönerse müşteri kodları veya veritabanı şemasını değiştirme. Cloudflare Pages **Functions → Logs** ekranındaki `/api/veresiye/health` kaydını ve Supabase Edge Function loglarını karşılaştır.

## Güvenlik ve veri kapsamı

- Hedef Supabase projesi `ukfeuojhigxxxlnhsmls` (kişisel Yunus ProPOS).
- Tarayıcı kaynaklarına yalnızca Supabase publishable key konur; bu anahtar public-client anahtarıdır.
- `service_role` / secret key hiçbir zaman bu depoya veya tarayıcıya konmaz; mevcut Supabase Edge Function sunucu sırları Supabase'de kalır.
- API yalnızca iki izinli Edge Function rotasını kabul eder; bilinmeyen rotalar 404, yanlış HTTP yöntemi 405 ve JSON dışı istekler 415 döndürür.
- Müşteri alışverişi ve yönetici sorguları mevcut Edge Function'ların sunucu tarafındaki doğrulama ve işletme kapsamı kontrollerinden geçer.
- Bu paket Supabase tablolarına, migration'lara, müşteri verilerine veya canlı Edge Function sürümlerine dokunmaz.

## Yerel kontrol

- `npm ci`
- `npm run check`

Pages Functions'ı Cloudflare'ın yerel çalışma ortamında denemek için, `npm run build` sonrasında `npx wrangler pages dev dist` kullanılabilir. Bu yerel testte de API rotalarının aynı origin'den çalışması gerekir.
