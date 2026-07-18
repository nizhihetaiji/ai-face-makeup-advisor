const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 8090;
const STATIC_DIR = path.join(__dirname);

// ====== WBI Signature for B站 API ======
const MIXIN_KEY_ENC_TAB = [
  46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,
  33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,
  61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52
];

let wbiKeys = { img_key: '', sub_key: '', expires: 0 };

function getMixinKey(orig) {
  return MIXIN_KEY_ENC_TAB.reduce((s, i) => s + orig[i], '').substring(0, 32);
}

function encWbi(params, img_key, sub_key) {
  const mixin_key = getMixinKey(img_key + sub_key);
  const curr_time = Math.round(Date.now() / 1000);
  params['wts'] = curr_time;
  // Sort params by key
  const sorted = Object.entries(params).sort((a, b) => a[0].localeCompare(b[0]));
  // Filter special chars from values
  const filtered = sorted.map(([k, v]) => [k, String(v).replace(/[!'()*]/g, '')]);
  // Encode
  const query = filtered.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
  const w_rid = crypto.createHash('md5').update(query + mixin_key).digest('hex');
  return { ...params, w_rid, wts: curr_time };
}

async function refreshWbiKeys() {
  // Keys cached for 1 hour
  if (wbiKeys.expires > Date.now() / 1000 + 3600 && wbiKeys.img_key) return wbiKeys;

  return new Promise((resolve, reject) => {
    const url = 'https://api.bilibili.com/x/web-interface/nav';
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com/',
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.data && parsed.data.wbi_img) {
            const img_url = parsed.data.wbi_img.img_url || '';
            const sub_url = parsed.data.wbi_img.sub_url || '';
            // Extract filename without extension
            const img_key = img_url.split('/').pop().replace('.png', '') || '';
            const sub_key = sub_url.split('/').pop().replace('.png', '') || '';
            wbiKeys = { img_key, sub_key, expires: Math.round(Date.now() / 1000) };
            console.log('WBI keys refreshed:', img_key, sub_key);
            resolve(wbiKeys);
          } else {
            // Use hardcoded fallback keys (commonly valid)
            wbiKeys = {
              img_key: '7cd084941338484aae1ad9425b84077c',
              sub_key: '4932caff0ff746eab6f01bf08b70ac45',
              expires: Math.round(Date.now() / 1000)
            };
            console.log('WBI keys fallback (hardcoded)');
            resolve(wbiKeys);
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// ====== Server ======
const server = http.createServer(async (req, res) => {
  // CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Image proxy: /api/thumb?url=XXX — proxy B站 thumbnails to avoid CORS/blocking
  if (req.url.startsWith('/api/thumb')) {
    const queryPart = req.url.split('?')[1] || '';
    let thumbUrl = '';
    queryPart.split('&').forEach(pair => {
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0 && pair.substring(0, eqIdx) === 'url') {
        thumbUrl = decodeURIComponent(pair.substring(eqIdx + 1));
      }
    });
    // Normalize URL
    thumbUrl = thumbUrl.replace(/^\/\//, 'https://').replace(/^http:/, 'https:');

    if (!thumbUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'url参数必填' }));
      return;
    }

    https.get(thumbUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.bilibili.com/',
      }
    }, (thumbRes) => {
      const contentType = thumbRes.headers['content-type'] || 'image/jpeg';
      res.writeHead(thumbRes.statusCode, {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      });
      thumbRes.pipe(res);
    }).on('error', (e) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '图片加载失败: ' + e.message }));
    });
    return;
  }

  // Proxy endpoint: /api/bili-search?keyword=XXX
  if (req.url.startsWith('/api/bili-search')) {
    // Manual URL param parsing for better Unicode handling
    const queryPart = req.url.split('?')[1] || '';
    const rawParams = {};
    queryPart.split('&').forEach(pair => {
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        const key = pair.substring(0, eqIdx);
        const val = pair.substring(eqIdx + 1);
        try {
          rawParams[decodeURIComponent(key)] = decodeURIComponent(val);
        } catch (e) {
          rawParams[key] = val;
        }
      }
    });
    const keyword = rawParams['keyword'] || '';
    const order = rawParams['order'] || 'totalrank';
    const page = rawParams['page'] || '1';

    if (!keyword) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'keyword参数必填' }));
      return;
    }

    try {
      // Get WBI keys and sign the request
      const keys = await refreshWbiKeys();
      const signParams = encWbi({
        search_type: 'video',
        keyword: keyword,
        order: order,
        page: page,
      }, keys.img_key, keys.sub_key);

      const biliUrl = 'https://api.bilibili.com/x/web-interface/wbi/search/type?' +
        Object.entries(signParams).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');

      console.log('Searching B站:', keyword, '→', biliUrl.substring(0, 100));

      const options = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://search.bilibili.com/',
          'Accept': 'application/json',
        }
      };

      https.get(biliUrl, options, (biliRes) => {
        let data = '';
        biliRes.on('data', chunk => data += chunk);
        biliRes.on('end', () => {
          try {
            const parsed = JSON.parse(data);

            if (parsed.code === 0 && parsed.data && parsed.data.result) {
              const videos = parsed.data.result.map(v => ({
                bvid: v.bvid,
                title: v.title.replace(/<[^>]+>/g, ''),
                author: v.author,
                play: v.play,
                duration: v.duration,
                pic: v.pic,
                description: v.description || '',
                pubdate: v.pubdate,
                tag: v.tag || '',
                arcurl: v.arcurl || `https://www.bilibili.com/video/${v.bvid}`,
                mid: v.mid,
                typename: v.typename || '',
              }));

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                keyword: keyword,
                total: parsed.data.numResults || 0,
                videos: videos
              }));
            } else if (parsed.code === -412) {
              console.warn('B站412风控拦截, keyword:', keyword);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                keyword: keyword,
                total: 0,
                videos: [],
                error: 'B站搜索接口暂时限流',
                fallback: true
              }));
            } else {
              console.warn('B站搜索返回code:', parsed.code, 'message:', parsed.message);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                keyword: keyword,
                total: 0,
                videos: [],
                raw_code: parsed.code,
                raw_message: parsed.message || '',
                fallback: true
              }));
            }
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '解析B站响应失败', fallback: true }));
          }
        });
      }).on('error', (e) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '连接B站API失败: ' + e.message, fallback: true }));
      });
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'WBI签名失败: ' + e.message, fallback: true }));
    }
    return;
  }

  // Static file serving
  let filePath = path.join(STATIC_DIR, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  };

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`B站搜索代理: http://localhost:${PORT}/api/bili-search?keyword=XXX`);
  console.log(`前端页面: http://localhost:${PORT}/`);
  // Pre-fetch WBI keys
  refreshWbiKeys().then(k => console.log('WBI keys ready')).catch(e => console.warn('WBI key fetch failed:', e.message));
});
