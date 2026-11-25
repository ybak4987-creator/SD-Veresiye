/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API proxy kök adresi. Aynı alan adındaysa boş bırakılır. */
  readonly VITE_API_BASE_URL?: string;
  /** 'true' ise arayüz sahte veriyle çalışır. Production'da 'false'. */
  readonly VITE_DEMO_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
