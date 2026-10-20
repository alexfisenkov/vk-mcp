# VK MCP

Purpose: server-hosted MCP for VK community management, public reusable core.
Source of truth: docs/design.md, docs/implementation-plan.md, docs/onboarding.md, docs/troubleshooting.md and tested source.
Zones: src/catalog (pinned VK methods); src/vk (API client and token routing); src/policy (community/write gates); src/media (bounded media); src/server (MCP/HTTP transport); tests; deploy (generic deployment templates only).
Commands: npm ci; npm run build; npm test; npm run check. Runtime: Node.js >=22. No VK credentials are required for build or offline tests.
Acceptance: HTTPS authenticated MCP initialize/list/call works without VK tokens and reports not_configured; no anonymous access; writes disabled until explicitly enabled; GitHub SHA matches server release.
Privacy: public repository must contain only generic code and synthetic fixtures. Never commit owner identity, production hosts, private configuration, tokens, account/community IDs or real message/media data. Private infrastructure is maintained in server-fisenkov-learning.
Evidence: live group-token metadata/members/inbox and service-key wall/video reads were verified on one private deployment. ChatGPT owner OAuth login and cloud connector status/community/wall/video reads were verified on 2026-10-20; first browser-chat answer failed to render, cause unverified, then a short explicit-scope wall smoke-test completed with a matching post ID. Debt: remaining VK capabilities, refresh-token acceptance and Claude login are unverified; never imply all methods work. Preserve explicit upstream limitations; catalog coverage is not live API proof.

Credential onboarding: deploy/configure.py is Linux/VPS-only with a protected interactive TTY. Keep diagnostics read-only and results source-bound; distinguish documented token-type constraints from real API refusals. Agent runs must follow docs/onboarding.md and docs/troubleshooting.md before requesting new credentials.

Documentation contract: add each onboarding issue to docs/troubleshooting.md with date, symptom, layer (core or VK), credential kind, sanitized evidence, fix and read-back. Preserve pending limits. Generic examples must never include real deployment hosts, IDs, credentials or private conversation data.
