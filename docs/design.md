# VK MCP design

A standalone public TypeScript MCP core manages VK communities via a pinned official VK API schema. Community and service/user tokens remain server-side, routed by method/token capability and an explicit community allowlist. Tools distinguish reads, write plans and write execution; writes and destructive actions are disabled by default. Unsupported capabilities are visible, never reported as successful.

The server offers Streamable HTTP and an authenticated health route, runs under a dedicated Unix identity and exposes no arbitrary filesystem or network proxy. Upstream VK calls use fixed API hosts, bounded timeouts and sanitized errors. Unknown write outcomes are never retried automatically; an operation journal prevents replay. Media transfers enforce host/IP, size and MIME limits.

Common actions have named tools; the pinned catalog supports discovery and policy-controlled execution without bypassing community or write checks. New code is released through GitHub with tests, immutable SHA artifacts, health/catalog verification and rollback compatibility. Private deployment and OAuth identity are configured separately from this public core.

Initial deployment may have no communities or VK tokens: diagnostics and catalog must work; data tools return not_configured. Live VK and client OAuth login acceptance require later credentials/owner login. Server release does not imply refreshed client catalogs.
