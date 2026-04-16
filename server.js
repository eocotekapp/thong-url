import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ dest: path.join(__dirname, 'tmp') });

const PORT = process.env.PORT || 3000;
const TELEBOX_TOKEN = process.env.TELEBOX_TOKEN || '';
const TELEBOX_API_BASE = 'https://www.telebox.online/api/open';
const TELEBOX_WEB_BASE = 'https://www.telebox.online';

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function buildApiUrl(endpoint, params) {
  const url = new URL(`${TELEBOX_API_BASE}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Phản hồi không phải JSON: ${text.slice(0, 300)}`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  if (typeof data.status !== 'undefined' && Number(data.status) !== 1) {
    throw new Error(data.msg || `TeleBox báo lỗi, status=${data.status}`);
  }

  return data;
}

async function ensureFolder(folderName, token) {
  if (!folderName || !folderName.trim()) return 0;

  const createUrl = buildApiUrl('folder_create', {
    name: folderName.trim(),
    pid: 0,
    token,
    isShare: 0,
    canInvite: 0,
    canShare: 0,
    withBodyImg: 0,
    desc: ''
  });

  try {
    const created = await fetchJson(createUrl);
    const dirId = created?.data?.dirId;
    if (typeof dirId === 'number' && dirId > 0) {
      return dirId;
    }
  } catch (error) {
    const message = String(error.message || error);
    if (!message.toLowerCase().includes('dup')) {
      throw error;
    }
  }

  const searchUrl = buildApiUrl('file_search', {
    name: folderName.trim(),
    pid: 0,
    token,
    pageNo: 1,
    pageSize: 100
  });

  const search = await fetchJson(searchUrl);
  const items = search?.data?.list || [];
  const matched = items.find((item) => item?.type === 'sdir' && item?.name === folderName.trim());

  if (!matched?.id) {
    throw new Error('Không tạo được folder và cũng không tìm thấy folder đã tồn tại.');
  }

  return matched.id;
}

async function md5First10MB(filePath) {
  const TEN_MB = 10 * 1024 * 1024;
  const fd = await fs.promises.open(filePath, 'r');
  try {
    const stats = await fd.stat();
    const size = Math.min(stats.size, TEN_MB);
    const buffer = Buffer.alloc(size);
    await fd.read(buffer, 0, size, 0);
    return crypto.createHash('md5').update(buffer).digest('hex');
  } finally {
    await fd.close();
  }
}

function decodePossiblyEscapedUrl(url) {
  return url
    .replace(/\\u002F/g, '/')
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .trim();
}

function uniqueUrls(urls) {
  return [...new Set(urls.filter(Boolean))];
}

function pickFileUrlsFromText(text) {
  if (!text) return [];

  const patterns = [
    /https?:\\/\\/[^\s"'<>]+\.(?:mp4|mov|m4v|webm|mkv|avi|flv|ts|m3u8)(?:\?[^\s"'<>]*)?/gi,
    /https?:\/\/[^\s"'<>]+\.(?:mp4|mov|m4v|webm|mkv|avi|flv|ts|m3u8)(?:\?[^\s"'<>]*)?/gi,
    /https?:\/\/[^\s"'<>]+(?:token=|ht=video\/|filename=)[^\s"'<>]*/gi,
    /https?:\\/\\/[^\s"'<>]+(?:token=|ht=video\\/|filename=)[^\s"'<>]*/gi
  ];

  const results = [];
  for (const pattern of patterns) {
    const matches = text.match(pattern) || [];
    for (const match of matches) {
      const clean = decodePossiblyEscapedUrl(match);
      if (/^https?:\/\//i.test(clean)) results.push(clean);
    }
  }

  return uniqueUrls(results);
}

async function resolveTeleboxLinks(entryUrl) {
  const output = {
    entryUrl,
    finalUrl: '',
    viewUrl: '',
    downloadUrl: '',
    candidateUrls: [],
    note: ''
  };

  let response;
  try {
    response = await fetch(entryUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 TeleBoxUploader/2.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
  } catch (error) {
    output.note = `Không mở được link chia sẻ để resolve: ${error.message || String(error)}`;
    return output;
  }

  output.finalUrl = response.url || '';
  if (output.finalUrl.includes('/f-detail/')) {
    output.viewUrl = output.finalUrl;
  } else if (/\.(mp4|mov|m4v|webm|mkv|avi|flv|ts|m3u8)(\?|$)/i.test(output.finalUrl)) {
    output.viewUrl = output.finalUrl;
    output.downloadUrl = output.finalUrl;
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    if (!output.downloadUrl && output.finalUrl) {
      output.downloadUrl = output.finalUrl;
    }
    output.note = 'Link cuối không phải HTML, đã dùng luôn final URL.';
    return output;
  }

  const html = await response.text();
  const candidates = pickFileUrlsFromText(html);
  output.candidateUrls = candidates;

  const direct = candidates.find((u) => /(token=|filename=|ht=video\/|\.mp4(\?|$))/i.test(u));
  if (direct) {
    output.downloadUrl = direct;
  }

  const detailMatch = html.match(/https?:\/\/www\.telebox\.online\/f-detail\/[^\s"'<>]+/i)
    || html.match(/https?:\\/\\/www\.telebox\.online\\/f-detail\\/[^\s"'<>]+/i);

  if (!output.viewUrl && detailMatch?.[0]) {
    output.viewUrl = decodePossiblyEscapedUrl(detailMatch[0]);
  }

  if (!output.viewUrl) {
    output.viewUrl = output.finalUrl || entryUrl;
  }

  output.note = output.downloadUrl
    ? 'Đã bóc được direct/download URL từ trang TeleBox.'
    : 'Chưa bóc được direct URL tự động, nhưng vẫn có view URL.';

  return output;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, tokenLoaded: Boolean(TELEBOX_TOKEN) });
});

app.post('/api/resolve', async (req, res) => {
  try {
    const url = String(req.body?.url || '').trim();
    if (!url) {
      return res.status(400).json({ ok: false, error: 'Thiếu URL cần resolve.' });
    }

    const resolved = await resolveTeleboxLinks(url);
    res.json({ ok: true, ...resolved });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || String(error) });
  }
});

app.post('/api/upload', upload.single('video'), async (req, res) => {
  let uploadedPath = null;

  try {
    if (!TELEBOX_TOKEN) {
      return res.status(500).json({ ok: false, error: 'Thiếu TELEBOX_TOKEN trong file .env' });
    }

    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'Chưa có file video.' });
    }

    uploadedPath = req.file.path;

    const expireEnum = Number(req.body.expire_enum || 1);
    const folderName = String(req.body.folderName || '').trim();

    const pid = await ensureFolder(folderName, TELEBOX_TOKEN);
    const fileSize = req.file.size;
    const diyName = req.file.originalname;
    const fileMd5ofPre10m = await md5First10MB(uploadedPath);

    const authUrl = buildApiUrl('get_upload_url', {
      fileMd5ofPre10m,
      fileSize,
      token: TELEBOX_TOKEN
    });

    const auth = await fetchJson(authUrl);
    const signUrl = auth?.data?.signUrl;

    if (!signUrl) {
      throw new Error('Không lấy được signUrl để upload lên TeleBox.');
    }

    const putResponse = await fetch(signUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': req.file.mimetype || 'application/octet-stream'
      },
      body: fs.createReadStream(uploadedPath),
      duplex: 'half'
    });

    if (!putResponse.ok) {
      const text = await putResponse.text().catch(() => '');
      throw new Error(`Upload file thất bại: HTTP ${putResponse.status} ${text.slice(0, 300)}`);
    }

    const createItemUrl = buildApiUrl('folder_upload_file', {
      fileMd5ofPre10m,
      fileSize,
      pid,
      diyName,
      token: TELEBOX_TOKEN
    });

    const createItem = await fetchJson(createItemUrl);
    const itemId = createItem?.data?.itemId;

    if (!itemId) {
      throw new Error('TeleBox không trả về itemId sau khi tạo file item.');
    }

    const shareUrlApi = buildApiUrl('file_share', {
      itemIds: itemId,
      expire_enum: expireEnum,
      token: TELEBOX_TOKEN
    });

    const share = await fetchJson(shareUrlApi);
    const shareToken = share?.data?.shareToken;

    if (!shareToken) {
      throw new Error('TeleBox không trả về shareToken.');
    }

    const entryUrl = `${TELEBOX_WEB_BASE}/s/${shareToken}`;
    const resolved = await resolveTeleboxLinks(entryUrl);

    res.json({
      ok: true,
      fileName: diyName,
      fileSize,
      folderId: pid,
      itemId,
      shareToken,
      shareUrl: entryUrl,
      viewUrl: resolved.viewUrl || entryUrl,
      downloadUrl: resolved.downloadUrl || '',
      finalUrl: resolved.finalUrl || '',
      candidateUrls: resolved.candidateUrls || [],
      note: resolved.note
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message || String(error) });
  } finally {
    if (uploadedPath) {
      fs.promises.unlink(uploadedPath).catch(() => {});
    }
  }
});

app.listen(PORT, () => {
  console.log(`TeleBox webapp đang chạy tại http://localhost:${PORT}`);
});
