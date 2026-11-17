import { defineAssets } from '@iwsdk/core';

// The modules (world, life) load their own models, so the manifest stays empty. The file has to exist: iwsdk.config.json names
// it and both the runtime and the editor import it. Keep it free of side effects.
export default defineAssets({});
