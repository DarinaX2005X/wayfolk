/// <reference types="vite/client" />
/// <reference types="@iwsdk/vite-plugin-dev/client" />

interface ImportMetaEnv {
  /** "1" in the build for scenarios (npm run xr:prod): debug hooks and test parameters stay on. */
  readonly VITE_GW_TEST?: string;
}
