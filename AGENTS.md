# VK MCP

Purpose: server-hosted MCP for VK community management, public reusable core.
Source of truth: docs/design.md, docs/implementation-plan.md and tested source.
Zones: src/catalog (pinned VK methods); src/vk (API client and token routing); src/policy (community/write gates); src/media (bounded media); src/server (MCP/HTTP transport); tests; deploy (generic deployment templates only).
Commands: npm ci; npm run build; npm test; npm run check. Runtime: Node.js >=22. No VK credentials are required for build or offline tests.
Acceptance: HTTPS authenticated MCP initialize/list/call works without VK tokens and reports not_configured; no anonymous access; writes disabled until explicitly enabled; GitHub SHA matches server release.
Privacy: public repository must contain only generic code and synthetic fixtures. Never commit owner identity, production hosts, private configuration, tokens, account/community IDs or real message/media data. Private infrastructure is maintained in server-fisenkov-learning.
Debt: real VK credentials, community IDs and cloud-client login acceptance are deferred by owner. Preserve explicit upstream limitations; catalog coverage is not live API proof.
