# VK MCP

Purpose: server-hosted MCP for VK community management, public reusable core.
Source of truth: docs/design.md, docs/implementation-plan.md, docs/onboarding.md, docs/troubleshooting.md and tested source.
Zones: src/catalog (pinned VK methods); src/vk (API client and token routing); src/policy (community/write gates); src/media (bounded media); src/server (MCP/HTTP transport); tests; deploy (generic deployment templates only).
Commands: npm ci; npm run build; npm test; npm run check. Runtime: Node.js >=22. No VK credentials are required for build or offline tests.
Acceptance: HTTPS authenticated MCP initialize/list/call works without VK tokens and reports not_configured; no anonymous access; writes disabled until explicitly enabled; GitHub SHA matches server release.
Privacy: public repository must contain only generic code and synthetic fixtures. Never commit owner identity, production hosts, private configuration, tokens, account/community IDs or real message/media data. Private infrastructure is maintained in server-fisenkov-learning.
Evidence: live group-token metadata/members/inbox and service-key wall/video reads were verified on one private deployment. ChatGPT owner OAuth login, cloud status/community/wall/video reads and automatic refresh after natural access expiry were verified on 2026-10-20. First browser-chat answer failed to render, then a short explicit-scope wall smoke-test completed with a matching post ID. Debt: remaining VK capabilities, real writes and Claude login are unverified; never imply all methods work. Preserve explicit upstream limitations; catalog coverage is not live API proof.

Credential onboarding: deploy/configure.py is Linux/VPS-only with a protected interactive TTY. Keep diagnostics read-only and results source-bound; distinguish documented token-type constraints from real API refusals. Agent runs must follow docs/onboarding.md and docs/troubleshooting.md before requesting new credentials.

Documentation contract: add each onboarding issue to docs/troubleshooting.md with date, symptom, layer (core or VK), credential kind, sanitized evidence, fix and read-back. Preserve pending limits. Generic examples must never include real deployment hosts, IDs, credentials or private conversation data.

0.3 workflow: docs/write-profile.md, docs/oauth-renewal.md and docs/releases/0.3.0.md describe current operations. Methods are generated from a pinned, explicit allowlist; never wrap arbitrary VK API or return upload/Callback/Long Poll secrets. Credential readiness is local policy, not live API proof. Enabling writes never removes per-plan owner receipts. Catalog refresh and OAuth refresh are separate acceptance surfaces.
Open retention/acceptance debt lives in docs/debt.md; never prune consumed/unknown evidence without a reviewed reconciliation design.
