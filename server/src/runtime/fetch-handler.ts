import { getApp } from "./app-instance";
import { extractImageWithMetadata } from "../utils/image";
import { stripMarkdown } from "../utils/markdown";

const ROOT_FEED_PATTERN = /^\/(rss\.xml|atom\.xml|rss\.json|feed\.json|feed\.xml)$/;
const APP_PUBLIC_ROUTE_PATTERN = /^\/(favicon|favicon\.ico)(?:\/|$)/;
// 由 Worker 直接处理的元数据路由（sitemap / robots），需在静态资源分支之前路由到 Hono 应用
const APP_META_ROUTE_PATTERN = /^\/(sitemap\.xml|robots\.txt)$/;

// 需要注入 SEO meta 的前端路由
const FEED_PAGE_PATTERN = /^\/feed\/([\w-]+)\/?$/;
const HOME_PAGE_PATTERN = /^\/$/;
const HASHTAG_PAGE_PATTERN = /^\/hashtag\/([^/]+)\/?$/;
const ALIAS_PAGE_PATTERN = /^\/([\w-]+)\/?$/;
// 与前端路由同名的保留段：这些单段路径是应用页面，不是文章别名
const RESERVED_SEGMENTS = new Set([
  "timeline",
  "moments",
  "friends",
  "hashtags",
  "hashtag",
  "search",
  "login",
  "profile",
  "callback",
  "admin",
  "user",
  "api",
  "feed",
]);
const SITE_NAME = "SmartPick Tech";
const SITE_DESCRIPTION = "Spot the Gems. Skip the Flops. Your no-BS guide to Amazon finds, filtered with a QC eye.";

// 搜索引擎爬虫与社交平台抓取器（它们不执行 JS，需要服务端直接给出 meta）
const BOT_UA_PATTERN =
  /bot|crawl|spider|slurp|mediapartners|baiduspider|yandex|sogou|exabot|facebot|facebookexternalhit|twitterbot|linkedinbot|embedly|quora link preview|pinterest|slackbot|telegrambot|whatsapp|discordbot|google-inspection-tool|adsbot-google|duckduckbot/i;

function isBotRequest(request: Request): boolean {
  const ua = request.headers.get("user-agent") || "";
  return BOT_UA_PATTERN.test(ua);
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncateText(value: string, maxLen: number): string {
  const t = value.replace(/\s+/g, " ").trim();
  return t.length > maxLen ? `${t.slice(0, maxLen).trimEnd()}…` : t;
}

function metaTag(attr: "name" | "property", key: string, value: string): string {
  return `<meta ${attr}="${escapeHtmlAttr(key)}" content="${escapeHtmlAttr(value)}" />`;
}

async function fetchFeedForMeta(
  request: Request,
  env: Env,
  executionContext: ExecutionContext | undefined,
  feedParam: string,
): Promise<any | null> {
  try {
    const apiUrl = new URL(request.url);
    apiUrl.pathname = `/feed/${feedParam}`;
    apiUrl.search = "";
    const apiRes = await getApp().fetch(new Request(apiUrl.toString(), request), env, executionContext);
    if (!apiRes.ok) return null;
    const feed = (await apiRes.json()) as any;
    if (!feed || typeof feed !== "object" || feed.draft) return null;
    return feed;
  } catch {
    return null;
  }
}

// 校验文章（id 或别名）是否真实存在：存在返回 true，明确不存在返回 false，
// 接口异常等无法判定时返回 null（调用方按“存在”处理，避免误伤真实页面）。
// 与 fetchFeedForMeta 不同，这里不排除草稿：带登录态的请求能查到自己的草稿，不算 404。
async function feedExists(
  request: Request,
  env: Env,
  executionContext: ExecutionContext | undefined,
  feedParam: string,
): Promise<boolean | null> {
  try {
    const apiUrl = new URL(request.url);
    apiUrl.pathname = `/feed/${feedParam}`;
    apiUrl.search = "";
    const apiRes = await getApp().fetch(new Request(apiUrl.toString(), request), env, executionContext);
    if (apiRes.status === 404) return false;
    if (!apiRes.ok) return null;
    const feed = (await apiRes.json()) as any;
    return feed && typeof feed === "object" && "id" in feed ? true : null;
  } catch {
    return null;
  }
}

function pickDescription(feed: any, plain: string): string {
  const s = typeof feed.summary === "string" ? feed.summary.trim() : "";
  // 摘要字段有时被复用存放联盟披露行，不适合作为搜索摘要
  if (s && !/as an amazon associate/i.test(s)) return s;
  return plain.replace(/\*As an Amazon Associate[^\n]*/gi, "").trim();
}

// Pinterest 要求图钉图片为竖版或正方形（2:3 到 1:1），横版或过窄图会被拒。
// 对 Pinterest 抓取器，把 og:image 经 weserv 代理裁成 1000x1500（2:3）。
function toPinterestImage(url: string): string {
  const stripped = url.replace(/^https?:\/\//i, "");
  return `https://images.weserv.nl/?url=ssl:${encodeURIComponent(stripped)}&w=1000&h=1500&fit=cover`;
}

function buildFeedMetaHtml(feed: any, origin: string): string {
  const title = `${feed.title ?? "Article"} - ${SITE_NAME}`;
  const plain = stripMarkdown(feed.content ?? "");
  const description = truncateText(pickDescription(feed, plain), 160) || SITE_DESCRIPTION;
  const rawImage = extractImageWithMetadata(feed.content ?? "") ?? `${origin}/favicon.ico`;
  // 所有社交/搜索抓取器统一给 2:3 竖版图（Pinterest 拒收横版与过窄图）
  const imageUrl = toPinterestImage(rawImage);
  const canonical = `${origin}/feed/${feed.id}`;
  const feedTitle = String(feed.title ?? "");
  return [
    `<title>${escapeHtmlAttr(title)}</title>`,
    `<meta name="description" content="${escapeHtmlAttr(description)}" />`,
    `<link rel="canonical" href="${escapeHtmlAttr(canonical)}" />`,
    metaTag("property", "og:type", "article"),
    metaTag("property", "og:site_name", SITE_NAME),
    metaTag("property", "og:title", feedTitle),
    metaTag("property", "og:description", description),
    metaTag("property", "og:url", canonical),
    metaTag("property", "og:image", imageUrl),
    metaTag("name", "twitter:card", "summary_large_image"),
    metaTag("name", "twitter:title", feedTitle),
    metaTag("name", "twitter:description", description),
    metaTag("name", "twitter:image", imageUrl),
  ].join("\n    ");
}

function buildHomeMetaHtml(origin: string): string {
  const title = `${SITE_NAME} - ${SITE_DESCRIPTION}`;
  return [
    `<title>${escapeHtmlAttr(title)}</title>`,
    `<meta name="description" content="${escapeHtmlAttr(SITE_DESCRIPTION)}" />`,
    `<link rel="canonical" href="${escapeHtmlAttr(origin)}/" />`,
    metaTag("property", "og:type", "website"),
    metaTag("property", "og:site_name", SITE_NAME),
    metaTag("property", "og:title", SITE_NAME),
    metaTag("property", "og:description", SITE_DESCRIPTION),
    metaTag("property", "og:url", `${origin}/`),
    metaTag("name", "twitter:card", "summary"),
    metaTag("name", "twitter:title", SITE_NAME),
    metaTag("name", "twitter:description", SITE_DESCRIPTION),
  ].join("\n    ");
}

// 聚合页面的独立标题：没有独立 title/canonical 时，所有聚合页在爬虫眼里都是同一个空壳，会被判重复
const AGGREGATE_PAGES: Record<string, { title: string; description: string }> = {
  "/timeline": { title: `Timeline - ${SITE_NAME}`, description: SITE_DESCRIPTION },
  "/moments": { title: `Moments - ${SITE_NAME}`, description: SITE_DESCRIPTION },
  "/friends": { title: `Friends - ${SITE_NAME}`, description: SITE_DESCRIPTION },
  "/hashtags": { title: `Hashtags - ${SITE_NAME}`, description: SITE_DESCRIPTION },
};

function buildPageMetaHtml(origin: string, path: string, title: string, description: string): string {
  const canonical = `${origin}${path}`;
  return [
    `<title>${escapeHtmlAttr(title)}</title>`,
    `<meta name="description" content="${escapeHtmlAttr(description)}" />`,
    `<link rel="canonical" href="${escapeHtmlAttr(canonical)}" />`,
    metaTag("property", "og:type", "website"),
    metaTag("property", "og:site_name", SITE_NAME),
    metaTag("property", "og:title", title),
    metaTag("property", "og:description", description),
    metaTag("property", "og:url", canonical),
    metaTag("name", "twitter:card", "summary"),
    metaTag("name", "twitter:title", title),
    metaTag("name", "twitter:description", description),
  ].join("\n    ");
}

// 前端真实存在的非内容路由（与 client/src/app/routes.tsx 对照），命中这些路径不算 404
function isKnownClientPath(pathname: string): boolean {
  if (pathname === "/") return true;
  if (/^\/(timeline|moments|friends|hashtags|login|profile|callback)$/.test(pathname)) return true;
  if (/^\/hashtag\/[^/]+$/.test(pathname)) return true;
  if (/^\/search\/[^/]+$/.test(pathname)) return true;
  if (/^\/admin(\/.*)?$/.test(pathname)) return true;
  if (/^\/user\/github(\/callback)?$/.test(pathname)) return true;
  if (/^\/[^/]+\/user\/github$/.test(pathname)) return true;
  return false;
}

// 真 404：状态码给对，正文仍用 SPA 入口，用户打开能看到应用内的未找到页面
async function serveNotFound(request: Request, env: Env): Promise<Response> {
  const shell = await serveSpaEntry(request, env);
  if (shell) {
    const html = await shell.text();
    return new Response(html, {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  return new Response("404 Not Found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function injectMetaIntoHead(html: string, metaHtml: string): string | null {
  if (!html.includes("</head>")) return null;
  return html.replace("</head>", `    ${metaHtml}\n  </head>`);
}

async function servePageWithMeta(
  request: Request,
  env: Env,
  executionContext: ExecutionContext | undefined,
  metaHtml: string,
): Promise<Response | null> {
  try {
    const indexResponse = await serveSpaEntry(request, env);
    if (!indexResponse) return null;
    const html = await indexResponse.text();
    const injected = injectMetaIntoHead(html, metaHtml);
    if (!injected) return indexResponse;
    return new Response(injected, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  } catch {
    return null;
  }
}

function isApiRequest(pathname: string) {
  return pathname.startsWith("/api/");
}

function rewriteApiRequest(request: Request) {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/^\/api(?=\/|$)/, "") || "/";
  return new Request(url, request);
}

function isRootFeedRequest(pathname: string) {
  return ROOT_FEED_PATTERN.test(pathname);
}

function isAppPublicRoute(pathname: string) {
  return APP_PUBLIC_ROUTE_PATTERN.test(pathname);
}

function isMetaRoute(pathname: string) {
  return APP_META_ROUTE_PATTERN.test(pathname);
}

function isStaticAssetRequest(pathname: string) {
  return /\.\w+$/.test(pathname);
}

async function tryServeAsset(request: Request, env: Env) {
  if (!env.ASSETS) {
    return null;
  }

  try {
    const asset = await env.ASSETS.fetch(request);
    if (asset.status === 200 || (asset.status >= 300 && asset.status < 400)) {
      return asset;
    }
  } catch {}

  return null;
}

async function serveSpaEntry(request: Request, env: Env) {
  if (!env.ASSETS) {
    return null;
  }

  try {
    const url = new URL(request.url);
    const indexRequest = new Request(new URL("/", url.origin), request);
    const indexResponse = await env.ASSETS.fetch(indexRequest);
    if (indexResponse.status === 200 || (indexResponse.status >= 300 && indexResponse.status < 400)) {
      return indexResponse;
    }
  } catch {}

  return null;
}

export async function handleFetch(
  request: Request,
  env: Env,
  executionContext?: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // http 与 https 是同一内容的两个地址，会被搜索引擎判为重复页：统一 301 到 https（本地开发除外）
  const isLocalHost =
    url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol === "http:" && !isLocalHost) {
    url.protocol = "https:";
    return Response.redirect(url.toString(), 301);
  }

  // 末尾斜杠与无斜杠也是两个地址：统一去掉末尾斜杠（根路径与 /api/ 除外）
  if (pathname.length > 1 && pathname.endsWith("/") && !isApiRequest(pathname)) {
    url.pathname = pathname.replace(/\/+$/, "");
    return Response.redirect(url.toString(), 301);
  }

  if (isRootFeedRequest(pathname)) {
    return getApp().fetch(request, env, executionContext);
  }

  if (isApiRequest(pathname)) {
    return getApp().fetch(rewriteApiRequest(request), env, executionContext);
  }

  if (isAppPublicRoute(pathname)) {
    return getApp().fetch(request, env, executionContext);
  }

  if (isMetaRoute(pathname)) {
    return getApp().fetch(request, env);
  }

  if (isStaticAssetRequest(pathname)) {
    const asset = await tryServeAsset(request, env);
    if (asset) {
      return asset;
    }
  }

  // 搜索引擎爬虫与社交抓取器不执行 JS：对文章页和首页直接注入 SEO meta，
  // 否则它们只能看到空的 SPA 壳。普通用户仍走纯 SPA（避免访问统计重复计数）。
  if (isBotRequest(request)) {
    const feedMatch = pathname.match(FEED_PAGE_PATTERN);
    if (feedMatch) {
      try {
        const feed = await fetchFeedForMeta(request, env, executionContext, feedMatch[1]);
        if (feed) {
          const withMeta = await servePageWithMeta(
            request,
            env,
            executionContext,
            buildFeedMetaHtml(feed, new URL(request.url).origin),
          );
          if (withMeta) return withMeta;
        }
      } catch {
        // 降级：走默认 SPA 入口
      }
    } else if (HOME_PAGE_PATTERN.test(pathname)) {
      const withMeta = await servePageWithMeta(
        request,
        env,
        executionContext,
        buildHomeMetaHtml(new URL(request.url).origin),
      );
      if (withMeta) return withMeta;
    } else if (HASHTAG_PAGE_PATTERN.test(pathname)) {
      const rawName = pathname.match(HASHTAG_PAGE_PATTERN)?.[1] ?? "";
      let tagName = rawName;
      try {
        tagName = decodeURIComponent(rawName);
      } catch {}
      const withMeta = await servePageWithMeta(
        request,
        env,
        executionContext,
        buildPageMetaHtml(
          new URL(request.url).origin,
          pathname,
          `#${tagName} - ${SITE_NAME}`,
          SITE_DESCRIPTION,
        ),
      );
      if (withMeta) return withMeta;
    } else if (AGGREGATE_PAGES[pathname]) {
      const page = AGGREGATE_PAGES[pathname];
      const withMeta = await servePageWithMeta(
        request,
        env,
        executionContext,
        buildPageMetaHtml(new URL(request.url).origin, pathname, page.title, page.description),
      );
      if (withMeta) return withMeta;
    } else {
      // 别名文章页（/about 这类单段路径）：与 /feed/:id 同样注入文章 meta，canonical 统一指向 /feed/<id>
      const aliasMatch = pathname.match(ALIAS_PAGE_PATTERN);
      if (aliasMatch && !RESERVED_SEGMENTS.has(aliasMatch[1])) {
        try {
          const feed = await fetchFeedForMeta(request, env, executionContext, aliasMatch[1]);
          if (feed) {
            const withMeta = await servePageWithMeta(
              request,
              env,
              executionContext,
              buildFeedMetaHtml(feed, new URL(request.url).origin),
            );
            if (withMeta) return withMeta;
          }
        } catch {
          // 降级：走默认 SPA 入口
        }
      }
    }
  }

  // 软 404 修复：不存在的文章/别名与未知路径，不再用 200 返回 SPA 空壳，改为真 404
  let notFound = false;
  const feedMatchAll = pathname.match(FEED_PAGE_PATTERN);
  const aliasMatchAll = pathname.match(ALIAS_PAGE_PATTERN);
  if (feedMatchAll) {
    notFound = (await feedExists(request, env, executionContext, feedMatchAll[1])) === false;
  } else if (aliasMatchAll && !RESERVED_SEGMENTS.has(aliasMatchAll[1])) {
    notFound = (await feedExists(request, env, executionContext, aliasMatchAll[1])) === false;
  } else if (!isKnownClientPath(pathname)) {
    notFound = true;
  }
  if (notFound) {
    return serveNotFound(request, env);
  }

  const indexResponse = await serveSpaEntry(request, env);
  if (indexResponse) {
    return indexResponse;
  }

  return new Response("Hi", { status: 200 });
}
