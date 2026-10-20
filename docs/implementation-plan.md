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
- [x] 1. Core: tests first for not_configured, token routing, parameter/community validation, write plan binding/replay. Implement pinned catalog, API client, policy and journal. Files src/catalog, src/vk, src/policy, tests/core.test.ts. API createRuntime(config) with status/search/read/plan/execute methods; errors sanitized.
- [x] 2. Media: fixed VK upload/save flows and bounded server-side downloads; tests private IP/DNS rebinding, redirects, size, MIME and path boundaries. Public API only server URL inputs, no client-selected arbitrary server file path.
- [x] 3. MCP/HTTP: official SDK stateless Streamable HTTP, named tools and generic read/write interface; health and metadata, bearer auth on all data routes, allowed Host/Origin and input bounds. Tests real initialize/list/status and anonymous denial.
- [x] 4. Deployment: generic systemd/install/update/rollback templates in public core; owner-specific routing and OAuth additions from clean private infrastructure checkout. Tests and dry-run precede mutations. Exact SHA release and rollback receipt.
- [x] 5. Review/docs: README onboarding, limitations, licenses, dependency/secret scan, independent code/risk/skeptic review and fixes. npm run check must pass.
- [x] 6. Publish/deploy: public GitHub repository, immutable release build, final CI/local-release evidence; dedicated systemd service and HTTPS route, OAuth discovery, authenticated remote initialize/list/status, anonymous denial. Record live SHA and remaining owner client acceptance.

Execution ruling: owner explicitly approved implementation, publication and server installation; proceed continuously without repeating architecture/execution approval. Specialists may work on non-overlapping modules. Main agent owns integration and deploy.

## Initial 0.1 acceptance (historical)

Infrastructure is deployed and verified: authenticated external HTTPS initialize,
list26 and statusnot_configured; anonymous denial, OAuth discovery, isolated
cloud UID→core compatibility, protected filesystem approval with synthetic
transport, real rollback and return. Final application suite39PASS and private
infrastructure checks14PASS. No real VK calls or message sends were performed.

Deferred by owner: community IDs and VK credentials. Separate external acceptance
remains for actual VK permissions and ChatGPT/Claude OAuth login, catalog refresh
and revocation. OAuth discovery is not a completed client login. The publication
checkbox records source/release/deployment readiness, not those external logins.

The public core is a native implementation informed by three researched MCP
projects and pinned official VK metadata; their runtime/login code is not merged.
Operator deployment evidence and host-specific pins belong in private infrastructure.

## 0.3 expansion and OAuth acceptance

Current scope approved by owner: verify actual ChatGPT automatic renewal,
expand reviewed community reads/writes including deletion/moderation, enable
the owner's write profile and release through GitHub. Use the existing
TypeScript SDK/runtime/plan/receipt architecture; add no arbitrary API proxy.
Missing upstream user credentials remain explicit limitations.

Work streams: pinned catalog generator and scalar/scope validation; local
community/credential readiness tools and frequent aliases; operator write
profile with backup/rollback; private OAuth rotation/persistence regression
tests; public generic guides and release notes; exact-SHA final CI and deploy;
source/HTTPS/ChatGPT catalog read-back. Actual OAuth expiry/renewal is already
verified. Code/transport, configured profile and actual upstream writes are
separate evidence; do not publish synthetic posts or messages for acceptance.
