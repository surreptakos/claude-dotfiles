// gas self-deploy canary — the smallest host. Nothing here matters except that the library can deploy it,
// verify it through the hook below, and run `hello` on request.
function canaryCheck() {
  return 'canary ok at ' + GAS_DEPLOYED_SHA.slice(0, 7) + ' (' + new Date().toISOString() + ')';
}
function hello(name) {
  return 'hello ' + (name || 'world') + ' from ' + GAS_DEPLOYED_SHA.slice(0, 7);
}
