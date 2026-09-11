/* ============================================================
 * 媒体模块（Cloudflare R2 直传 + D1 元数据）
 * ------------------------------------------------------------
 * 背景：图片上传原为 base64 存 D1（超大图会拖垮页面/数据库），
 * 迁移为 R2 直传（与音乐模块同款 S3 预签名模式）：
 *   · 浏览器 XHR PUT 直传 R2（不占 Worker 带宽）
 *   · R2 egress 免费 → 图片读取流量不额外计费
 *   · D1 media 表只存元数据（url 为 R2 公开地址）
 * 依赖环境变量（R2 凭据与音乐共用；**媒体桶独立**，不与音乐同桶）：
 *   R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ENDPOINT   （通用凭据）
 *   R2_MEDIA_BUCKET        媒体专用桶名（如 qingyu-media）
 *   R2_MEDIA_PUBLIC_BASE   媒体桶绑定的自定义域名（如 https://media.2024921.xyz）
 * 降级：未配置 R2 媒体桶时，api/media/upload-url 返回 503；
 *       读取列表 / 旧 base64 记录兼容显示（不迁移）。
 * 旧数据：已存在的 base64 记录保留可读；仅新上传走 R2。
 * ============================================================ */
import { getCorsHeaders, json, corsPreflight, isWriteAuthed, unauthorized, dbAll, dbRun } from './api-core.js';
import { presignPut, r2DeleteObject } from './music.js';

const IMAGE_EXTS = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon' };
const MAX_SIZE = 10 * 1024 * 1024; // 单图 ≤ 10MB

export function r2Configured(env) {
  return !!(env && env.R2_MEDIA_BUCKET && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_ENDPOINT);
}
function randomId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
/** 从公开 URL 提取媒体对象 key（仅本站 media/ 前缀；外链/base64 返回空串不删） */
export function extractMediaR2Key(publicUrl) {
  try {
    const p = new URL(String(publicUrl || '')).pathname;
    if (p.indexOf('/media/') === 0) return p.slice(1);
  } catch (e) { /* ignore */ }
  return '';
}

/* ============================================================
 * POST /api/media/upload-url（管理）→ 返回 R2 预签名 PUT URL
 *   入参 { filename: "photo.png", size: 5242880 }
 *   返回 { uploadUrl, publicUrl, key, contentType, expiresIn }
 * ============================================================ */
export async function handleMediaUploadUrl(request, env) {
  if (!env || !env.DB) return json({ error: '数据库未配置' }, 500, request, env);
  if (request.method === 'OPTIONS') return corsPreflight(request, env);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, request, env);
  if (!(await isWriteAuthed(request, env))) return unauthorized(request, env);
  if (!r2Configured(env)) {
    return json({ error: 'R2 媒体桶未配置（缺少 R2_MEDIA_BUCKET / R2 凭据），无法上传' }, 503, request, env);
  }

  const body = await request.json().catch(function () { return null; });
  const filename = String((body && body.filename) || '').trim();
  const size = Number((body && body.size) || 0) || 0;
  const m = /\.([a-zA-Z0-9]+)$/.exec(filename);
  const ext = m ? m[1].toLowerCase() : '';
  if (!IMAGE_EXTS[ext]) return json({ error: '不支持的图片格式（png / jpg / jpeg / webp / gif / svg / avif / bmp / ico）' }, 400, request, env);
  if (size <= 0 || size > MAX_SIZE) return json({ error: '文件大小需在 1B ~ 10MB 之间' }, 400, request, env);

  const key = 'media/' + randomId() + '.' + ext;
  const contentType = IMAGE_EXTS[ext];
  const uploadUrl = await presignPut(env, key, 3600, env.R2_MEDIA_BUCKET);   // 媒体专用桶
  const publicBase = String(env.R2_MEDIA_PUBLIC_BASE || '').replace(/\/+$/, '');
  const publicUrl = publicBase ? publicBase + '/' + key : '';

  return json({ ok: true, uploadUrl, publicUrl, key, contentType, expiresIn: 3600 }, 200, request, env, { 'Cache-Control': 'no-store' });
}

/** 删除媒体：先删 R2 对象（若 url 是本站 media/ 前缀，媒体专用桶），再删 D1 元数据 */
export async function deleteMediaObject(env, url) {
  const key = extractMediaR2Key(url);
  if (key) {
    try { await r2DeleteObject(env, key, env.R2_MEDIA_BUCKET); } catch (e) { /* R2 删除失败不阻塞元数据删除（避免幽灵记录） */ }
  }
}