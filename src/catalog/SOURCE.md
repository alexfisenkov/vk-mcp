# Catalog provenance

The allowlist contains selected parameter metadata from the official [VKCOM/vk-api-schema](https://github.com/VKCOM/vk-api-schema/tree/333481bd082ad747d4873ef4a77f9247097eeef0), commit `333481bd082ad747d4873ef4a77f9247097eeef0`, schema API version 5.199, retrieved 2026-10-20. Source paths: `{wall,groups,messages,photos,video,docs,stats,market}/methods.json`. Upstream license: MIT; see repository third-party notices.

Only listed parameters are accepted. Unlisted methods, arbitrary `execute`, token/version overrides and destructive deletion methods are unavailable. Metadata references into the full schema are descriptive; runtime validates local scalar/array types and explicitly scopes every method to an allowlisted community. Metadata coverage is not a claim of real token/API compatibility.

Compatibility extension: `wall.get` requires negative numeric `owner_id`. The pinned JSON omits this parameter, while the [official VK PHP SDK Wall.get documentation](https://github.com/VKCOM/vk-php-sdk/blob/master/src/VK/Actions/Wall.php) explicitly documents it. It is sent unchanged as `owner_id`, never inferred from a short name or switched to `domain`. Live behavior remains unverified until credentials are configured.

`media.uploadWallPhoto` and `media.uploadVideo` are local composite actions, not VK API methods. They are protected by the same plan/confirmation/single-use gates. A separately configured media executor performs their fixed upload flow.
