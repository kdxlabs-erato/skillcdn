---
"@skillcdn/serve": patch
---

Requires the releases of its HTTP framework that carry security fixes: `hono` 4.13.18 and `@hono/node-server` 2.1.8 at least. The fixes are in helpers the package does not use itself: the validator, the body limit, `mount` with a `getPath` of its own, and the static file middleware with `allowPercentInPath`. An application that puts `registerAddressRoutes` on a Hono app of its own and uses one of them gets the fix with the update. `@hono/node-server` 2.1.8 also cancels the body of a response whose client has already disconnected. Nothing changes in how `skillcdn serve` and the library are used.
