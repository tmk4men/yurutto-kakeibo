// ビルド前ガード: 実際にアプリへ焼かれる www/ と各ネイティブの public/ が
// ルートのソースと完全一致しているかを検証する。
//
// なぜ必要か: www/ と ios|android の public/ は .gitignore 管理外なので、
// git にコミットしても各マシンで `npm run sync` を実行しないと更新されない。
// 同期を忘れると「修正済みのつもりで古いJSを出荷」する事故が起きる
// (例: IAPフェイルオープン修正がストア版に反映されない)。
// sync の最後にこれを走らせ、一致しなければ非0で終了してビルドを止める。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

// copy-web.js がコピーする実体ファイル (画像/バイナリは除き、壊れやすいテキストを検証)
const FILES = ['index.html', 'style.css', 'app.js', 'sw.js', 'manifest.json'];

// 検証先 (存在するものだけチェック)
const TARGETS = [
  path.join(ROOT, 'www'),
  path.join(ROOT, 'ios', 'App', 'App', 'public'),
  path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'public'),
];

function md5(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
}

let failed = false;
for (const file of FILES) {
  const src = path.join(ROOT, file);
  if (!fs.existsSync(src)) continue;
  const want = md5(src);
  for (const dir of TARGETS) {
    const dest = path.join(dir, file);
    if (!fs.existsSync(dest)) continue; // そのプラットフォーム未導入ならスキップ
    const got = md5(dest);
    if (got !== want) {
      failed = true;
      console.error(`✗ STALE: ${path.relative(ROOT, dest)} がソース ${file} と不一致`);
    }
  }
}

if (failed) {
  console.error('\n❌ 同期されていない古いアセットがあります。`npm run sync` を実行してから再アーカイブしてください。');
  console.error('   (この状態でストアに出すと、修正済みのつもりで古いJSが焼き込まれます)\n');
  process.exit(1);
}
console.log('✓ verify-sync: www/ と各 public/ はソースと一致しています');
