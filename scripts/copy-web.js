// Web版のソースを www/ にコピーする (Capacitorの webDir が www のため)
// アセットのバージョンクエリ ?v=N は android 内では不要なので index.html を書き換える。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEST = path.join(ROOT, 'www');

const FILES = [
  'index.html',
  'style.css',
  'app.js',
  'sw.js',
  'manifest.json',
  'icon-192.png',
  'icon-512.png',
  'icon-512-maskable.png',
  'apple-touch-icon.png',
  'ogp.png',
  'yabai.svg',
];

fs.mkdirSync(DEST, { recursive: true });
for (const f of FILES) {
  fs.copyFileSync(path.join(ROOT, f), path.join(DEST, f));
}

// Android (WebView) では Service Worker は要らないので、
// 念のため index.html から sw.js 登録を解除しておくこともできるが、
// SWはhttps origin 必須なのでローカルでは自動的に無効化される。
// なので index.html はそのままコピーして良い。

console.log(`Copied ${FILES.length} files into www/`);
