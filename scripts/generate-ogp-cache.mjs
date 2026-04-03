/**
 * ブログ記事内の単独URLからOGP・oEmbedメタデータを取得し
 * public/ogp-cache.json に保存するビルドスクリプト
 *
 * 使い方: node scripts/generate-ogp-cache.mjs
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BLOG_DIR = path.join(ROOT, 'src', 'content', 'blog');
const CACHE_PATH = path.join(ROOT, 'public', 'ogp-cache.json');

const TIMEOUT = 10000;
const UA = 'Mozilla/5.0 (compatible; MizuameOGPBot/1.0)';

// ─── Markdown から単独URLを抽出 ───

function extractStandaloneUrls(markdown) {
  const urls = [];
  const body = markdown.replace(/^---[\s\S]*?---/, '');
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (/^https?:\/\/\S+$/.test(trimmed)) urls.push(trimmed);
  }
  return urls;
}

// ─── HTML エンティティのデコード ───

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/g, "'");
}

// ─── meta タグから値を取得 ───

function extractMeta(html, property, attr = 'property') {
  const patterns = [
    new RegExp(`<meta[^>]*${attr}=["']${property}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*${attr}=["']${property}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeEntities(m[1]);
  }
  return null;
}

// ─── oEmbed ディスカバリー (HTMLの<link>タグから) ───

async function discoverOembed(html, pageUrl) {
  const patterns = [
    /<link[^>]*type=["']application\/json\+oembed["'][^>]*href=["']([^"']*)["']/i,
    /<link[^>]*href=["']([^"']*)["'][^>]*type=["']application\/json\+oembed["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      let endpoint;
      try { endpoint = new URL(decodeEntities(m[1]), pageUrl).href; } catch { continue; }
      try {
        const res = await fetch(endpoint, {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(TIMEOUT),
        });
        if (res.ok) return await res.json();
      } catch {}
    }
  }
  return null;
}

// ─── noembed.com フォールバック ───

async function fetchNoembed(url) {
  try {
    const res = await fetch(
      `https://noembed.com/embed?url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(TIMEOUT) }
    );
    const data = await res.json();
    return data.error ? null : data;
  } catch {
    return null;
  }
}

// ─── 1つの URL のメタデータを取得 ───

async function fetchMetadata(url) {
  const domain = new URL(url).hostname;
  const favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  const meta = { domain, favicon };

  let html = '';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (res.ok) html = await res.text();
  } catch (e) {
    console.warn(`    fetch failed: ${e.message}`);
  }

  // OGP
  if (html) {
    const title =
      extractMeta(html, 'og:title') ||
      (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] ||
      null;
    const desc = extractMeta(html, 'og:description') || extractMeta(html, 'description', 'name');
    let image = extractMeta(html, 'og:image');
    const siteName = extractMeta(html, 'og:site_name');

    if (image && !/^https?:\/\//.test(image)) {
      try { image = new URL(image, url).href; } catch {}
    }

    if (title) meta.title = title;
    if (desc) meta.description = desc;
    if (image) meta.image = image;
    if (siteName) meta.siteName = siteName;
  }

  // oEmbed: HTMLから検出 → 失敗なら noembed.com
  let oembed = html ? await discoverOembed(html, url) : null;
  if (!oembed) oembed = await fetchNoembed(url);
  if (oembed && oembed.html) {
    meta.oembedHtml = oembed.html;
    meta.oembedType = oembed.type || 'rich';
    if (!meta.title && oembed.title) meta.title = oembed.title;
  }

  return meta;
}

// ─── メイン ───

async function main() {
  const urls = new Set();
  for (const lang of ['ja', 'en']) {
    const dir = path.join(BLOG_DIR, lang);
    let files;
    try { files = await fs.readdir(dir); } catch { continue; }
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const content = await fs.readFile(path.join(dir, file), 'utf-8');
      for (const u of extractStandaloneUrls(content)) urls.add(u);
    }
  }
  console.log(`Found ${urls.size} standalone URLs`);

  // 既存キャッシュ読み込み
  let cache = {};
  try { cache = JSON.parse(await fs.readFile(CACHE_PATH, 'utf-8')); } catch {}

  const newUrls = [...urls].filter((u) => !cache[u]);
  console.log(`Fetching metadata for ${newUrls.length} new URLs...\n`);

  for (const url of newUrls) {
    process.stdout.write(`  ${url} ... `);
    cache[url] = await fetchMetadata(url);
    console.log(cache[url].title || '(no title)');
  }

  // 不要エントリ削除
  for (const key of Object.keys(cache)) {
    if (!urls.has(key)) delete cache[key];
  }

  await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf-8');
  console.log(`\nSaved ${Object.keys(cache).length} entries to public/ogp-cache.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
