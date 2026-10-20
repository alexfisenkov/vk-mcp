# Recovery

Inspect actual state after an interrupted or failed installation; do not replay
first-install blindly or regenerate credentials. The installer deliberately
refuses pre-existing unmanaged units/configs and an already staged SHA.

1. Read systemctl status and sanitized journal for mcp-vk, current/previous
   symlink targets, release.json and the selected release's mcp-vk.service.
2. Verify the unit matches the staged exact SHA and config paths; verify the
   port is not occupied, the state directory is service-owned 0700 and config
   root:service 0640. Do not print credential contents.
3. If only runtime configuration/port readiness failed after first install,
   correct that specific issue through the private infrastructure release,
   then start/restart the already verified mcp-vk unit and repeat authenticated
   health, initialize, catalog and status checks. Preserve the existing secret.
4. A first install has no previous release. If abandoning it, stop/disable only
   the new service/timer and remove only its new reverse-proxy includes after
   config-test. Preserve state/config/artifact for investigation.
5. Later code rollback: install.py --rollback --apply using the same root,
   config-dir, state-dir and public-host arguments. A failed rollback attempts
   to restore the previously active release. Inspect health after either path.

Never roll config/state backwards across an incompatible schema without its
explicit recovery plan. Version 0.1 has no automatic data migration or cleanup.
