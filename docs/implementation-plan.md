# VK MCP Implementation Plan

Goal: publish and deploy an authenticated extensible remote MCP, initially without VK credentials.
Architecture: TypeScript core + isolated HTTP service, private existing OAuth facade. Public generic core and private infrastructure have separate ownership.
Tech: Node >=22, official MCP TypeScript SDK, Zod, node:test, TypeScript.
Spec: docs/design.md (owner approved architecture; credentials deferred).

## Constraints
No local MCP installation/autostart; source checkout is for development. No live VK sends/posts during verification. Preserve upstream attribution and pin schema commit. One final hosted CI (workflow_dispatch only) or current authorized local-release fallback. No changes to existing MCP grants/keys.

## Review focus
- unconfigured tokens: explicit not_configured and no outbound API calls
- generic executor cannot escape community/write policy or inject token/version
- transport rejects anonymous/wrong credentials and malformed/large input
- unknown write outcome/restart: no replay, exact plan binding and expiry
- media redirects/private addresses and server file access cannot expose secrets

## Tasks
- [ ] 1. Core: tests first for not_configured, token routing, parameter/community validation, write plan binding/replay. Implement pinned catalog, API client, policy and journal. Files src/catalog, src/vk, src/policy, tests/core.test.ts. API createRuntime(config) with status/search/read/plan/execute methods; errors sanitized.
- [ ] 2. Media: fixed VK upload/save flows and bounded server-side downloads; tests private IP/DNS rebinding, redirects, size, MIME and path boundaries. Public API only server URL inputs, no client-selected arbitrary server file path.
- [ ] 3. MCP/HTTP: official SDK stateless Streamable HTTP, named tools and generic read/write interface; health and metadata, bearer auth on all data routes, allowed Host/Origin and input bounds. Tests real initialize/list/status and anonymous denial.
- [ ] 4. Deployment: generic systemd/install/update/rollback templates in public core; owner-specific routing and OAuth additions from clean private infrastructure checkout. Tests and dry-run precede mutations. Exact SHA release and rollback receipt.
- [ ] 5. Review/docs: README onboarding, limitations, licenses, dependency/secret scan, independent code/risk/skeptic review and fixes. npm run check must pass.
- [ ] 6. Publish/deploy: public GitHub repository, immutable release build, final CI/local-release evidence; dedicated systemd service and HTTPS route, OAuth discovery, authenticated remote initialize/list/status, anonymous denial. Record live SHA and remaining owner client acceptance.

Execution ruling: owner explicitly approved implementation, publication and server installation; proceed continuously without repeating architecture/execution approval. Specialists may work on non-overlapping modules. Main agent owns integration and deploy.
