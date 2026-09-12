/* Cloudflare Pages Functions · GET /api/ai/summaries
 * 文章 AI 摘要批量只读接口（公开、不触发生成、不消耗 AI 额度）。
 *  ?slugs=a,b,c&lang=zh-CN → { ok:true, summaries:{ slug: summary|null } }
 *  · 用途：首页多张卡片原本各发一个 GET /api/ai/summary，合并为一次请求（N→1）；
 *  · 每篇只查 KV 缓存（sum:{slug}:{lang}），未生成的返回 null，前端决定是否替换默认摘要；
 *  · 全部命中 → 可缓存 86400s；任一未命中 → no-store（避免把"尚未生成"也缓存住）。
 */
import { json, corsPreflight } from '../../_lib/api-core.js';
import { aiEnabled, aiCacheGet, normalizeLang } from '../../_lib/ai.js';

const CHUNK = 40;   // URL 长度兜底：一次最多查 40 篇，超出分片（前端再发一次即可）

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return corsPreflight(request, env);
  if (!aiEnabled(env)) return json({ ok: false, error: 'AI 未启用' }, 404, request, env);
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, request, env);

  const u = new URL(request.url);
  const lang = normalizeLang(u.searchParams.get('lang'));
  const slugs = (u.searchParams.get('slugs') || '')
    .split(',')
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, CHUNK);
  if (!slugs.length) return json({ error: '缺少 slugs' }, 400, request, env);

  const out = {};
  let hits = 0;
  for (const slug of slugs) {
    const cached = await aiCacheGet(env, 'sum:' + slug + ':' + lang);
    if (cached) { out[slug] = cached; hits++; }
    else out[slug] = null;
  }
  const headers = hits ? { 'Cache-Control': 'public, max-age=86400' } : { 'Cache-Control': 'no-store' };
  return json({ ok: true, summaries: out }, 200, request, env, headers);
}