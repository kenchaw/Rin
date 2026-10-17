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

function pickDescription(feed: any, plain: string): string {
  const s = typeof feed.summary === "string" ? feed.summary.trim() : "";
  // 摘要字段有时被复用存放联盟披露行，不适合作为搜索摘要
  if (s && !/as an amazon associate/i.test(s)) return s;
  return plain.replace(/\*As an Amazon Associate[^\n]*/gi, "").trim();
}

function buildFeedMetaHtml(feed: any, origin: string): string {
  const title = `${feed.title ?? "Article"} - ${SITE_NAME}`;
  const plain = stripMarkdown(feed.content ?? "");
  const description = truncateText(pickDescription(feed, plain), 160) || SITE_DESCRIPTION;
  const imageUrl = extractImageWithMetadata(feed.content ?? "") ?? `${origin}/favicon.ico`;
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
    }
  }

  const indexResponse = await serveSpaEntry(request, env);
  if (indexResponse) {
    return indexResponse;
  }

  return new Response("Hi", { status: 200 });
}
