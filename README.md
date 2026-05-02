# ゆるっと家計簿

家計簿が苦手な人のための、ミニマル家計簿。「必要・楽しみ・ムダかも」の3タグで記録し、月の上限・吹き出しメッセージ・PWAでホーム画面追加にも対応。

公開版: https://tmk4men.github.io/yurutto-kakeibo/

## 構成

- `index.html` / `style.css` / `app.js` — Web版本体（ビルド不要）
- `sw.js` / `manifest.json` — PWA（オフライン対応・ホーム画面追加）
- `ogp.png` / `yabai.svg` / `icon-*.png` / `apple-touch-icon.png` — 画像アセット
- `package.json` / `capacitor.config.json` / `scripts/copy-web.js` — Android化用
- `android/` — Capacitorが生成したAndroid Studioプロジェクト

## ローカルで動かす

`index.html` をブラウザで開くだけで動きます。データはブラウザの localStorage に保存されます。

## Web → Android（Capacitor）

### 初回セットアップ

```bash
npm install
npm run copy-web      # ソースを www/ にコピー
npx cap sync android  # android/app/src/main/assets/public/ に同期
```

### Android Studio で開く

Android Studio で **`android/` フォルダを開く**だけ。Gradle同期 → 実機/エミュレータでRun。

```bash
npx cap open android  # OS関連付けで Android Studio を起動
```

### Web側を更新したあと

```bash
npm run copy-web && npx cap sync android
```

これで `android/app/src/main/assets/public/` が最新版に更新される。

## アプリ ID

- App ID: `com.tmk4men.yuruttokakeibo`
- App Name: `ゆるっと家計簿`

変更したい場合は `capacitor.config.json` と `android/app/src/main/AndroidManifest.xml` 周辺を編集。
