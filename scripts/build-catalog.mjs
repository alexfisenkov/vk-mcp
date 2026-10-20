#!/usr/bin/env node
// Rebuild only the reviewed allowlist. This is not an automatic VK API import.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const COMMIT='333481bd082ad747d4873ef4a77f9247097eeef0';
const SOURCE_SHA256={
  "board": "e986995c0472bef1a8a091be46762133f42cbc3c6fe916758232df0bda0bcd5a",
  "docs": "0523ae704a0fb64bd1be64e22c4df53573b86342839fb2f681871bf1761207d4",
  "groups": "d4710021caadf5c46deec8f84cc97ca5b8f58ae0c74245a98f2c6ab089196d7f",
  "market": "8510f5eb7093b030f28282695f83cc64540341c4073f02a14e7bef9e37b08e6e",
  "messages": "86ce48b28b6533885d90068309739426393fa7a9416e13f4ceaaf596d8075392",
  "photos": "0c2596b7ada1394ad31815a1618a5e50db0c80ce5c4f036ef7544d75f40b34c6",
  "polls": "60419d30081fce98636a6571468a1597f016c2c907e2e13fa73f203496d27e31",
  "stats": "aa4a290013f703ac1ca71159fc997d0affe4616c5ff5390dabec6d35cebf4c44",
  "stories": "d0a97f42afda0724c37ef9ee220c06f1fecaae6f0c674f55efcfeb9d916bc7d6",
  "video": "7fb055e4ecaa36e18a201647b426f8e3b49779aca2c988a7baf45c402baee6b5",
  "wall": "5e95860f78c3991990565e305c3ccb5319c6cc943fbd420afb44a18c5d1502a5"
};
const ALLOWLIST=[
  {
    "name": "wall.get",
    "mode": "read",
    "scope": "owner_id",
    "params": [
      "offset",
      "count",
      "filter",
      "extended",
      "fields",
      "owner_id"
    ]
  },
  {
    "name": "wall.getComments",
    "mode": "read",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "post_id",
      "need_likes",
      "start_comment_id",
      "offset",
      "count",
      "sort",
      "preview_length",
      "extended",
      "fields"
    ],
    "require": [
      "post_id"
    ]
  },
  {
    "name": "wall.post",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "from_group",
      "message",
      "attachments",
      "signed",
      "publish_date",
      "close_comments",
      "donut_paid_duration",
      "mute_notifications"
    ]
  },
  {
    "name": "wall.edit",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "post_id",
      "message",
      "attachments",
      "signed",
      "close_comments"
    ]
  },
  {
    "name": "wall.createComment",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "post_id",
      "from_group",
      "message",
      "reply_to_comment",
      "attachments"
    ]
  },
  {
    "name": "wall.editComment",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "comment_id",
      "message",
      "attachments"
    ]
  },
  {
    "name": "groups.getById",
    "mode": "read",
    "scope": "group_id",
    "params": [
      "group_id",
      "fields"
    ]
  },
  {
    "name": "groups.getMembers",
    "mode": "read",
    "scope": "group_id",
    "params": [
      "group_id",
      "sort",
      "offset",
      "count",
      "fields",
      "filter"
    ]
  },
  {
    "name": "groups.getSettings",
    "mode": "read",
    "scope": "group_id",
    "params": [
      "group_id"
    ]
  },
  {
    "name": "messages.getConversations",
    "mode": "read",
    "scope": "group_id",
    "params": [
      "offset",
      "count",
      "filter",
      "extended",
      "fields",
      "group_id"
    ]
  },
  {
    "name": "messages.getHistory",
    "mode": "read",
    "scope": "group_id",
    "params": [
      "offset",
      "count",
      "peer_id",
      "start_message_id",
      "rev",
      "extended",
      "fields",
      "group_id"
    ],
    "require": [
      "peer_id"
    ]
  },
  {
    "name": "messages.getConversationMembers",
    "mode": "read",
    "scope": "group_id",
    "params": [
      "peer_id",
      "extended",
      "fields",
      "group_id"
    ]
  },
  {
    "name": "messages.send",
    "mode": "write",
    "scope": "group_id",
    "params": [
      "peer_id",
      "message",
      "attachment",
      "reply_to",
      "forward_messages",
      "group_id",
      "dont_parse_links",
      "disable_mentions"
    ],
    "require": [
      "peer_id"
    ]
  },
  {
    "name": "messages.markAsRead",
    "mode": "write",
    "scope": "group_id",
    "params": [
      "peer_id",
      "start_message_id",
      "group_id"
    ],
    "require": [
      "peer_id"
    ]
  },
  {
    "name": "photos.getAlbums",
    "mode": "read",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "album_ids",
      "offset",
      "count",
      "need_system",
      "need_covers",
      "photo_sizes"
    ]
  },
  {
    "name": "photos.get",
    "mode": "read",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "album_id",
      "photo_ids",
      "rev",
      "extended",
      "feed_type",
      "photo_sizes",
      "offset",
      "count"
    ]
  },
  {
    "name": "photos.getComments",
    "mode": "read",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "photo_id",
      "need_likes",
      "start_comment_id",
      "offset",
      "count",
      "sort",
      "access_key",
      "extended",
      "fields"
    ]
  },
  {
    "name": "photos.createAlbum",
    "mode": "write",
    "scope": "group_id",
    "params": [
      "title",
      "group_id",
      "description",
      "upload_by_admins_only",
      "comments_disabled"
    ]
  },
  {
    "name": "photos.editAlbum",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "album_id",
      "title",
      "description",
      "owner_id",
      "upload_by_admins_only",
      "comments_disabled"
    ]
  },
  {
    "name": "video.get",
    "mode": "read",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "album_id",
      "count",
      "offset",
      "extended"
    ]
  },
  {
    "name": "video.getAlbums",
    "mode": "read",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "offset",
      "count",
      "extended",
      "need_system"
    ]
  },
  {
    "name": "video.getComments",
    "mode": "read",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "video_id",
      "need_likes",
      "start_comment_id",
      "offset",
      "count",
      "sort",
      "extended",
      "fields"
    ]
  },
  {
    "name": "video.edit",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "video_id",
      "name",
      "desc",
      "no_comments",
      "repeat"
    ]
  },
  {
    "name": "docs.get",
    "mode": "read",
    "scope": "owner_id",
    "params": [
      "count",
      "offset",
      "type",
      "owner_id"
    ]
  },
  {
    "name": "stats.get",
    "mode": "read",
    "scope": "group_id",
    "params": [
      "group_id",
      "timestamp_from",
      "timestamp_to",
      "interval",
      "intervals_count",
      "filters",
      "stats_groups",
      "extended"
    ]
  },
  {
    "name": "stats.getPostReach",
    "mode": "read",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "post_ids"
    ]
  },
  {
    "name": "market.get",
    "mode": "read",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "album_id",
      "count",
      "offset",
      "extended"
    ]
  },
  {
    "name": "market.getAlbums",
    "mode": "read",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "offset",
      "count"
    ]
  },
  {
    "name": "market.getComments",
    "mode": "read",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "item_id",
      "need_likes",
      "start_comment_id",
      "offset",
      "count",
      "sort",
      "extended",
      "fields"
    ]
  },
  {
    "name": "market.add",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "name",
      "description",
      "category_id",
      "price",
      "main_photo_id",
      "photo_ids",
      "sku"
    ]
  },
  {
    "name": "market.edit",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "item_id",
      "name",
      "description",
      "category_id",
      "price",
      "main_photo_id",
      "photo_ids",
      "sku"
    ]
  },
  {
    "name": "wall.getComment",
    "mode": "read",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "comment_id",
      "extended",
      "fields"
    ],
    "require": [
      "comment_id"
    ]
  },
  {
    "name": "wall.delete",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "post_id"
    ],
    "require": [
      "post_id"
    ]
  },
  {
    "name": "wall.deleteComment",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "post_id",
      "comment_id"
    ],
    "require": [
      "post_id",
      "comment_id"
    ]
  },
  {
    "name": "wall.restore",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "post_id"
    ],
    "require": [
      "post_id"
    ]
  },
  {
    "name": "wall.restoreComment",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "comment_id"
    ],
    "require": [
      "comment_id"
    ]
  },
  {
    "name": "wall.pin",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "post_id"
    ]
  },
  {
    "name": "wall.unpin",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "post_id"
    ]
  },
  {
    "name": "wall.closeComments",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "post_id"
    ]
  },
  {
    "name": "wall.openComments",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "post_id"
    ]
  },
  {
    "name": "groups.getAddresses",
    "mode": "read",
    "scope": "group_id",
    "params": [
      "group_id",
      "offset",
      "count",
      "fields"
    ]
  },
  {
    "name": "groups.getBanned",
    "mode": "read",
    "scope": "group_id",
    "params": [
      "group_id",
      "offset",
      "count",
      "fields"
    ]
  },
  {
    "name": "groups.getRequests",
    "mode": "read",
    "scope": "group_id",
    "params": [
      "group_id",
      "offset",
      "count",
      "fields"
    ]
  },
  {
    "name": "groups.getOnlineStatus",
    "mode": "read",
    "scope": "group_id",
    "params": [
      "group_id"
    ]
  },
  {
    "name": "groups.getTagList",
    "mode": "read",
    "scope": "group_id",
    "params": [
      "group_id"
    ]
  },
  {
    "name": "groups.ban",
    "mode": "write",
    "scope": "group_id",
    "params": [
      "group_id",
      "owner_id",
      "end_date",
      "reason",
      "comment",
      "comment_visible"
    ],
    "require": [
      "owner_id"
    ]
  },
  {
    "name": "groups.unban",
    "mode": "write",
    "scope": "group_id",
    "params": [
      "group_id",
      "owner_id"
    ],
    "require": [
      "owner_id"
    ]
  },
  {
    "name": "groups.approveRequest",
    "mode": "write",
    "scope": "group_id",
    "params": [
      "group_id",
      "user_id"
    ]
  },
  {
    "name": "groups.tagAdd",
    "mode": "write",
    "scope": "group_id",
    "params": [
      "group_id",
      "tag_name",
      "tag_color"
    ]
  },
  {
    "name": "groups.tagBind",
    "mode": "write",
    "scope": "group_id",
    "params": [
      "group_id",
      "tag_id",
      "user_id",
      "act"
    ]
  },
  {
    "name": "groups.tagUpdate",
    "mode": "write",
    "scope": "group_id",
    "params": [
      "group_id",
      "tag_id",
      "tag_name"
    ]
  },
  {
    "name": "groups.tagDelete",
    "mode": "write",
    "scope": "group_id",
    "params": [
      "group_id",
      "tag_id"
    ]
  },
  {
    "name": "messages.getByConversationMessageId",
    "mode": "read",
    "scope": "group_id",
    "params": [
      "group_id",
      "peer_id",
      "conversation_message_ids",
      "extended",
      "fields"
    ]
  },
  {
    "name": "messages.getHistoryAttachments",
    "mode": "read",
    "scope": "group_id",
    "params": [
      "group_id",
      "peer_id",
      "cmid",
      "offset",
      "count",
      "extended",
      "fields",
      "media_type"
    ],
    "require": [
      "peer_id"
    ]
  },
  {
    "name": "messages.search",
    "mode": "read",
    "scope": "group_id",
    "params": [
      "group_id",
      "peer_id",
      "q",
      "offset",
      "count",
      "extended",
      "fields"
    ],
    "require": [
      "peer_id"
    ]
  },
  {
    "name": "messages.edit",
    "mode": "write",
    "scope": "group_id",
    "params": [
      "group_id",
      "peer_id",
      "cmid",
      "message",
      "attachment",
      "keep_forward_messages",
      "keep_snippets",
      "dont_parse_links",
      "disable_mentions"
    ],
    "require": [
      "peer_id",
      "cmid"
    ]
  },
  {
    "name": "messages.delete",
    "mode": "write",
    "scope": "group_id",
    "params": [
      "group_id",
      "peer_id",
      "cmids",
      "delete_for_all"
    ],
    "require": [
      "peer_id",
      "cmids"
    ]
  },
  {
    "name": "messages.markAsAnsweredConversation",
    "mode": "write",
    "scope": "group_id",
    "params": [
      "group_id",
      "peer_id",
      "answered"
    ],
    "require": [
      "peer_id",
      "answered"
    ]
  },
  {
    "name": "photos.getAll",
    "mode": "read",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "extended",
      "offset",
      "count",
      "photo_sizes",
      "no_service_albums",
      "need_hidden",
      "skip_hidden"
    ]
  },
  {
    "name": "photos.getAlbumsCount",
    "mode": "read",
    "scope": "group_id",
    "params": [
      "group_id",
      "need_system"
    ]
  },
  {
    "name": "photos.createComment",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "photo_id",
      "message",
      "attachments",
      "from_group",
      "reply_to_comment"
    ]
  },
  {
    "name": "photos.edit",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "photo_id",
      "caption"
    ]
  },
  {
    "name": "photos.delete",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "photo_id"
    ],
    "require": [
      "photo_id"
    ]
  },
  {
    "name": "photos.deleteAlbum",
    "mode": "write",
    "scope": "group_id",
    "params": [
      "group_id",
      "album_id"
    ]
  },
  {
    "name": "photos.deleteComment",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "comment_id"
    ]
  },
  {
    "name": "video.getAlbumById",
    "mode": "read",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "album_id"
    ]
  },
  {
    "name": "video.createComment",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "video_id",
      "message",
      "attachments",
      "from_group",
      "reply_to_comment"
    ]
  },
  {
    "name": "video.delete",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "video_id",
      "target_id"
    ],
    "require": [
      "target_id"
    ]
  },
  {
    "name": "video.deleteAlbum",
    "mode": "write",
    "scope": "group_id",
    "params": [
      "group_id",
      "album_id"
    ]
  },
  {
    "name": "video.editAlbum",
    "mode": "write",
    "scope": "group_id",
    "params": [
      "group_id",
      "album_id",
      "title"
    ]
  },
  {
    "name": "video.deleteComment",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "comment_id"
    ]
  },
  {
    "name": "video.restore",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "video_id"
    ]
  },
  {
    "name": "board.getTopics",
    "mode": "read",
    "scope": "group_id",
    "params": [
      "group_id",
      "topic_ids",
      "order",
      "offset",
      "count",
      "extended",
      "preview",
      "preview_length"
    ]
  },
  {
    "name": "board.getComments",
    "mode": "read",
    "scope": "group_id",
    "params": [
      "group_id",
      "topic_id",
      "need_likes",
      "start_comment_id",
      "offset",
      "count",
      "extended",
      "sort"
    ]
  },
  {
    "name": "board.addTopic",
    "mode": "write",
    "scope": "group_id",
    "params": [
      "group_id",
      "title",
      "text",
      "from_group",
      "attachments"
    ]
  },
  {
    "name": "board.createComment",
    "mode": "write",
    "scope": "group_id",
    "params": [
      "group_id",
      "topic_id",
      "message",
      "attachments",
      "from_group"
    ]
  },
  {
    "name": "board.editTopic",
    "mode": "write",
    "scope": "group_id",
    "params": [
      "group_id",
      "topic_id",
      "title"
    ]
  },
  {
    "name": "board.editComment",
    "mode": "write",
    "scope": "group_id",
    "params": [
      "group_id",
      "topic_id",
      "comment_id",
      "message",
      "attachments"
    ]
  },
  {
    "name": "board.deleteTopic",
    "mode": "write",
    "scope": "group_id",
    "params": [
      "group_id",
      "topic_id"
    ]
  },
  {
    "name": "board.deleteComment",
    "mode": "write",
    "scope": "group_id",
    "params": [
      "group_id",
      "topic_id",
      "comment_id"
    ]
  },
  {
    "name": "board.closeTopic",
    "mode": "write",
    "scope": "group_id",
    "params": [
      "group_id",
      "topic_id"
    ]
  },
  {
    "name": "board.openTopic",
    "mode": "write",
    "scope": "group_id",
    "params": [
      "group_id",
      "topic_id"
    ]
  },
  {
    "name": "polls.getById",
    "mode": "read",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "poll_id",
      "is_board",
      "extended",
      "fields"
    ]
  },
  {
    "name": "polls.getVoters",
    "mode": "read",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "poll_id",
      "answer_ids",
      "is_board",
      "offset",
      "count",
      "fields"
    ]
  },
  {
    "name": "polls.create",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "question",
      "is_anonymous",
      "is_multiple",
      "end_date",
      "add_answers",
      "disable_unvote"
    ],
    "require": [
      "question",
      "add_answers"
    ]
  },
  {
    "name": "polls.edit",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "poll_id",
      "question",
      "add_answers",
      "edit_answers",
      "delete_answers",
      "end_date"
    ]
  },
  {
    "name": "stories.get",
    "mode": "read",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "extended",
      "fields"
    ]
  },
  {
    "name": "stories.getReplies",
    "mode": "read",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "story_id",
      "extended",
      "fields"
    ]
  },
  {
    "name": "stories.getStats",
    "mode": "read",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "story_id"
    ]
  },
  {
    "name": "stories.getViewers",
    "mode": "read",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "story_id",
      "count",
      "offset",
      "extended",
      "fields"
    ]
  },
  {
    "name": "stories.delete",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "story_id"
    ],
    "require": [
      "story_id"
    ]
  },
  {
    "name": "market.getCategories",
    "mode": "read",
    "scope": "group_id",
    "params": [
      "group_id",
      "album_id"
    ]
  },
  {
    "name": "market.getProperties",
    "mode": "read",
    "scope": "group_id",
    "params": [
      "group_id"
    ]
  },
  {
    "name": "market.getGroupOrders",
    "mode": "read",
    "scope": "group_id",
    "params": [
      "group_id",
      "offset",
      "count"
    ]
  },
  {
    "name": "market.delete",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "item_id"
    ]
  },
  {
    "name": "market.createComment",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "item_id",
      "message",
      "attachments",
      "from_group",
      "reply_to_comment"
    ]
  },
  {
    "name": "market.addAlbum",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "title",
      "main_album",
      "is_hidden"
    ]
  },
  {
    "name": "docs.edit",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "doc_id",
      "title",
      "tags"
    ]
  },
  {
    "name": "docs.delete",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "doc_id"
    ]
  },
  {
    "name": "docs.restore",
    "mode": "write",
    "scope": "owner_id",
    "params": [
      "owner_id",
      "doc_id"
    ]
  }
];

const allowedKeys=new Set(['description','type','required','minimum','maximum','minLength','maxLength','minItems','maxItems','enum','items']);
function metadata(p) {
 const result={name:p.name};
 for(const [key,value] of Object.entries(p))if(allowedKeys.has(key))result[key]=value;
 if(result.type==='array') {
  result.maxItems=Math.min(result.maxItems??100,100);
  if(!result.items?.type)result.items={type:'string'};
 }
 if(result.type==='string')result.maxLength=Math.min(result.maxLength??16000,16000);
 // All local entity IDs are positive scalars; the primary owner scope is the
 // single explicit exception. Compound owner_id_item_id selectors are absent.
 if(/^(post_id|comment_id|photo_id|video_id|doc_id|story_id|poll_id|topic_id|item_id|user_id|tag_id|cmid|peer_id)$/u.test(p.name))result.minimum=Math.max(result.minimum??1,1);
 if(['post_ids','album_ids','topic_ids','answer_ids','conversation_message_ids','cmids'].includes(p.name)) {
  result.minItems=1;result.maxItems=Math.min(result.maxItems??100,100);
  result.items={type:'integer',minimum:1};
 }
 return result;
}
const args=process.argv.slice(2);
let sourceDir,check=false;
for(let i=0;i<args.length;i++) {
 if(args[i]==='--source-dir'&&args[i+1])sourceDir=resolve(args[++i]);
 else if(args[i]==='--check')check=true;
 else throw new Error('Usage: node scripts/build-catalog.mjs [--source-dir DIRECTORY] [--check]');
}
const sources=new Map();
for(const [family,expected] of Object.entries(SOURCE_SHA256)) {
 let bytes;
 if(sourceDir)bytes=await readFile(resolve(sourceDir,`${family}.json`));
 else {
  const response=await fetch(`https://raw.githubusercontent.com/VKCOM/vk-api-schema/${COMMIT}/${family}/methods.json`,{redirect:'error'});
  if(!response.ok)throw new Error(`Cannot fetch pinned schema family ${family}`);
  bytes=Buffer.from(await response.arrayBuffer());
 }
 if(createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error(`Pinned source hash mismatch: ${family}`);
 sources.set(family,JSON.parse(bytes.toString('utf8')));
}
const catalog=ALLOWLIST.map(spec=>{
 const family=spec.name.split('.')[0];
 const upstream=sources.get(family)?.methods.find(method=>method.name===spec.name);
 if(!upstream)throw new Error(`Allowlisted method missing in pinned schema: ${spec.name}`);
 const parameters=spec.params.map(name=>{
  let p=upstream.parameters?.find(param=>param.name===name);
  // Official VK PHP SDK Wall.get documents owner_id; pinned JSON omitted it.
  if(!p&&spec.name==='wall.get'&&name==='owner_id')p={name,type:'integer',description:'Negative community owner ID; compatibility parameter documented in the official VK PHP SDK.'};
  if(!p)throw new Error(`Allowlisted parameter missing: ${spec.name}.${name}`);
  const result=metadata(p);
  if(name===spec.scope){result.type='integer';result.required=true;if(name==='group_id')result.minimum=1;else {delete result.minimum;result.maximum=-1;}}
  if(spec.require?.includes(name))result.required=true;
  if(spec.mode==='write'&&name==='album_id')result.minimum=1;
  if(spec.name.startsWith('groups.')&&name==='owner_id'){result.minimum=1;result.required=true;}
  if(spec.name==='photos.get'&&name==='photo_ids'){result.items={type:'string',minLength:1,maxLength:20};result.minItems=1;}
  return result;
 });
 for(const p of upstream.parameters??[])if(p.required&&!spec.params.includes(p.name))throw new Error(`Required upstream parameter excluded: ${spec.name}.${p.name}`);
 let tokenTypes=[...(upstream.access_token_type??[])];
 // Source-bound live read compatibility override, never extended to writes.
 if(spec.name==='video.get')tokenTypes.push('service');
 if(spec.name.startsWith('messages.'))tokenTypes=tokenTypes.filter(type=>type==='group');
 const kind=tokenTypes.includes('group')?'group':'user';
 return {name:spec.name,mode:spec.mode,scope:spec.scope,description:upstream.description??spec.name,parameters,token:kind,tokenTypes,liveVerified:false};
});
if(new Set(catalog.map(method=>method.name)).size!==catalog.length)throw new Error('Duplicate allowlist entry');
const output=JSON.stringify(catalog,null,2)+'\n';
const destination=fileURLToPath(new URL('../src/catalog/methods.json',import.meta.url));
if(check){if(await readFile(destination,'utf8')!==output)throw new Error('Catalog differs from pinned source + explicit allowlist');}
else await writeFile(destination,output);
console.log(`${check?'Verified':'Built'} ${catalog.length} VK API methods from pinned SHA-256 checked sources`);
