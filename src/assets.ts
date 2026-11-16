import { defineAssets } from '@iwsdk/core';

// Groundwork builds every object in code (src/kit/) and loads no models, sounds or
// panels, so the manifest stays empty. The file has to exist: iwsdk.config.json names
// it and both the runtime and the editor import it. Keep it free of side effects.
export default defineAssets({});
