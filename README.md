# gas-canary

An orphan branch, not part of the dotfiles. It is the smallest consumer of `gas/` (the Apps Script
self-deploy package on `master`): `gas.json` at the root, the deployable set under `gas/`, and nothing else.
`deploy/test`, `deploy/prod` and `deploy/run` on this repo point at commits of this branch; the canary
script `1Wy3TlnSt3-8Q-8LXadNv3-2QsETOi0ElDAdZNRBpVs34D7FrkOXgla8U` ("gas self-deploy canary") ticks against them.
