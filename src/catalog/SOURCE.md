# Catalog provenance

The catalog contains **100 VK API methods** plus two local media composites. It selects a reviewed parameter subset from the official [VKCOM/vk-api-schema](https://github.com/VKCOM/vk-api-schema/tree/333481bd082ad747d4873ef4a77f9247097eeef0), commit `333481bd082ad747d4873ef4a77f9247097eeef0`, schema API version 5.199, retrieved 2026-10-20. Upstream license: MIT; see the repository third-party notices. Catalog metadata is not live API acceptance or a guarantee that a token has the required permissions.

`node scripts/build-catalog.mjs` reproducibly fetches the fixed commit, verifies every source file against the SHA-256 manifest embedded in that script, and generates `methods.json` from its explicit method/parameter allowlist. No dependencies or credentials are needed. `--check` compares generated content with the checked-in catalog without writing. For an offline source cache, pass `--source-dir DIRECTORY`; files must be named `wall.json`, `groups.json`, etc. and still match the pinned hashes. Do not import new methods by name pattern or copy the complete upstream API surface.

| Source path | SHA-256 |
| --- | --- |
| `board/methods.json` | `e986995c0472bef1a8a091be46762133f42cbc3c6fe916758232df0bda0bcd5a` |
| `docs/methods.json` | `0523ae704a0fb64bd1be64e22c4df53573b86342839fb2f681871bf1761207d4` |
| `groups/methods.json` | `d4710021caadf5c46deec8f84cc97ca5b8f58ae0c74245a98f2c6ab089196d7f` |
| `market/methods.json` | `8510f5eb7093b030f28282695f83cc64540341c4073f02a14e7bef9e37b08e6e` |
| `messages/methods.json` | `86ce48b28b6533885d90068309739426393fa7a9416e13f4ceaaf596d8075392` |
| `photos/methods.json` | `0c2596b7ada1394ad31815a1618a5e50db0c80ce5c4f036ef7544d75f40b34c6` |
| `polls/methods.json` | `60419d30081fce98636a6571468a1597f016c2c907e2e13fa73f203496d27e31` |
| `stats/methods.json` | `aa4a290013f703ac1ca71159fc997d0affe4616c5ff5390dabec6d35cebf4c44` |
| `stories/methods.json` | `d0a97f42afda0724c37ef9ee220c06f1fecaae6f0c674f55efcfeb9d916bc7d6` |
| `video/methods.json` | `7fb055e4ecaa36e18a201647b426f8e3b49779aca2c988a7baf45c402baee6b5` |
| `wall/methods.json` | `5e95860f78c3991990565e305c3ccb5319c6cc943fbd420afb44a18c5d1502a5` |

The expansion covers wall moderation and deletion/restoration, community bans/requests/tags, conversation-local message editing/deletion, photo/video metadata and moderation, board topics/comments, polls, stories, market collections/comments/deletion, and document edits/deletion/restoration. The local catalog currently has 43 API reads and 57 API mutations; the media composites add two mutations.

## Local safety contracts

Only listed parameters are accepted. Every operation requires a positive numeric `group_id` or negative numeric `owner_id` belonging to the configured allowlist. The generator strengthens optional upstream scope/target IDs into required fields, enforces positive local entity IDs and bounded arrays, and retains upstream token types. Every `messages.*` entry is restricted to the selected community's group token; it never falls back to a personal user credential.

New message edit/delete methods require a positive `peer_id` and conversation-local `cmid`/`cmids`. Global `message_id`/`message_ids`, arbitrary recipient arrays, and unscoped by-ID lookups are excluded. `messages.search` also requires a selected peer. Group bans/unbans currently support positive user targets only. `video.delete` requires `target_id` equal to the same negative `owner_id`, avoiding removal from an implicit personal collection. Video album edits/deletes use the documented positive `group_id` selector. Numeric-looking photo IDs are owner-local strings; compound IDs and non-safe integer strings are rejected.

Deletion and moderation are mutations. They use the same write-enable, exact plan, owner approval, single-use execution and no-automatic-retry controls as posting. A catalog addition does not execute a mutation, enable production writes or create a VK permission grant.

Arbitrary `execute`, token/version overrides, account-wide search, unscoped ID batches, credential-returning Long Poll servers, Callback confirmation codes/servers, role delegation, raw upload-server/save methods and arbitrary API passthrough are unavailable. Three direct upload-server reads from the older catalog were removed because they return signed upload endpoints; use the fixed media composites instead. Adding another upload flow requires a reviewed server-side executor.

Metadata references are descriptive only. The generator retains reviewed scalar bounds/enums and normalizes unresolved array item references to strings; it does not claim full upstream JSON Schema validation. There are no live production IDs, response contents or credentials in fixtures.

## Compatibility overrides

`wall.get` requires a negative numeric `owner_id`. The pinned JSON omits this parameter, while the [official VK PHP SDK Wall.get documentation](https://github.com/VKCOM/vk-php-sdk/blob/master/src/VK/Actions/Wall.php) explicitly documents it. It is sent unchanged as `owner_id`, never inferred from a short name or switched to `domain`. A source-bound community wall read was verified on 2026-10-20 with a service key; this does not prove every operation.

`video.get` permits `service` credentials in addition to its pinned schema types. An authenticated live read of an allowlisted community accepted the service key while a group-token read failed. Regression tests preserve service routing, reject group-only routing and non-allowlisted owners, and do not extend this override to uploads or mutations.

`media.uploadWallPhoto` and `media.uploadVideo` are local composite actions, not VK API methods. They are protected by the same mutation controls. A separately configured executor performs their fixed bounded download/upload/save flow.
