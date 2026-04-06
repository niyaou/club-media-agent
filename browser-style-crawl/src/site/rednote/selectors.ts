export const REDNOTE_SELECTORS = {
  loginIndicators: [
    'button:has-text("登录")',
    'button:has-text("Log in")',
    '[class*="login"] button'
  ],
  authIndicators: [
    '[class*="avatar"] img',
    '[class*="user"] img',
    '[data-testid*="avatar"]'
  ],
  resultAnchors: [
    'a[href*="/explore/"]',
    'a[href*="/discovery/item/"]'
  ],
  newestSortTriggers: [
    'text=最新',
    'text=Newest'
  ],
  title: [
    "h1",
    'meta[property="og:title"]'
  ],
  authorName: [
    '[class*="author"]',
    '[class*="user-name"]',
    'a[href*="/user/profile"]'
  ],
  contentText: [
    '[class*="note-content"]',
    '[class*="content"]',
    "article"
  ],
  likeCount: [
    'button:has-text("赞")',
    'button:has-text("like")',
    '[class*="like"]'
  ],
  commentCount: [
    'button:has-text("评论")',
    'button:has-text("comment")',
    '[class*="comment"]'
  ],
  collectCount: [
    'button:has-text("收藏")',
    'button:has-text("collect")',
    '[class*="collect"]'
  ],
  publishedAt: [
    "time",
    '[class*="date"]',
    '[class*="time"]'
  ],
  commentItems: [
    '[class*="comment-item"]',
    '[class*="commentItem"]',
    '[class*="comment"] li'
  ],
  imageNodes: [
    "article img",
    'img[src*="sns-webpic"]',
    'img[srcset]'
  ],
  videoNodes: [
    "video",
    '[class*="video-player"] video'
  ]
} as const;
