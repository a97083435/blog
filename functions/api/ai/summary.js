/* Cloudflare Pages Functions · POST /api/ai/summary
 * 文章 AI 摘要（公开、限流 + 缓存；加密/受保护文章不做）。
 *  body: { slug, lang?, force? }   force 需作者会话（防止刷掉缓存） */
import { json, corsPreflight, isWriteAuthed } from '../../_lib/api-core.js';
import {
  aiEnabled, aiChat, aiRate, aiCacheGet, aiCachePut,
  buildSummaryMessages, normalizeLang, clientIp
} from '../../_lib/ai.js';

const CACHE_TTL = 60 * 60 * 24 * 30;   // 摘要缓存 30 天
const IP_WINDOW = 3600, IP_LIMIT = 8;  // 每 IP 每小时 8 次
const DAY_WINDOW = 86400, DAY_LIMIT = 300; // 全站每日 300 次（防刷爆免费额度）

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return corsPreflight(request, env);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, request, env);
  if (!aiEnabled(env)) return json({ ok: false, error: 'AI 未启用' }, 404, request, env);

  const body = await request.json().catch(() => null);
  if (!body || !body.slug) return json({ error: '缺少 slug' }, 400, request, env);
  const slug = String(body.slug);
  const lang = normalizeLang(body.lang);
  const force = !!(body.force);

  const ck = 'sum:' + slug + ':' + lang;
  if (!force) {
    const cached = await aiCacheGet(env, ck);
    if (cached) return json({ ok: true, summary: cached, cached: true }, 200, request, env, { 'Cache-Control': 'public, max-age=86400' });
  }

  const post = await env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(slug).first().catch(() => null);
  if (!post || !post.content) return json({ error: '未找到该内容' }, 404, request, env);
  // 加密/受保护文章内容不外泄给模型
  if (post.enc || Number(post.protected || 0) === 1) return json({ error: '该文章不支持 AI 摘要' }, 400, request, env);

  // 强制重生成需要作者会话（防止他人反复触发刷新缓存）
  if (force && !(await isWriteAuthed(request, env))) return json({ error: '未授权：请先登录' }, 401, request, env);

  const ip = clientIp(request);
  const r1 = await aiRate(env, 'sum:ip', ip, IP_LIMIT, IP_WINDOW);
  if (!r1.ok) return json({ error: 'AI 摘要请求太频繁，请稍后再试' }, 429, request, env);
  const r2 = await aiRate(env, 'sum:day', 'g', DAY_LIMIT, DAY_WINDOW);
  if (!r2.ok) return json({ error: 'AI 摘要今日用量已达上限' }, 429, request, env);

  const text = await aiChat(env, buildSummaryMessages(post.content, lang));
  if (!text) return json({ error: 'AI 服务暂不可用，请稍后再试' }, 502, request, env);

  await aiCachePut(env, ck, text, CACHE_TTL);
  return json({ ok: true, summary: text, cached: false }, 200, request, env, { 'Cache-Control': 'no-store' });
}