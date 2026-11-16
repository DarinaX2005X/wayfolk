import { defineComponents } from '@iwsdk/core';

// The product declares no ECS components of its own: systems are registered with
// world.registerSystem and object state lives in plain Maps inside feature modules
// (PLAN, "Architecture"). The file has to exist because iwsdk.config.json names it.
export default defineComponents([]);
