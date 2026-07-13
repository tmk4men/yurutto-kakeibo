# プレミアム（買い切り課金）実装メモ — ゆとり家計簿

最終更新: 2026-07-13
状態: **JS/UI 実装済み・未コミット。ネイティブ課金プラグイン導入とストア登録は未着手（Mac作業）。**

---

## 1. 収益モデル（確定）

- **買い切り 非消費型（Non-Consumable）¥600**、商品ID `com.tmk4men.yuruttokakeibo.premium`
- iOS/Android 共通。iOSは広告が無いので **機能アンロック型**。Androidは購入で **広告も消える**（おまけ）。
- サブスクではない。

## 2. 無料 / プレミアムの切り分け（確定）

| | 無料 | プレミアム |
|---|---|---|
| 記録・保存 | **無制限**（データは絶対に消さない） | 無制限 |
| きろく閲覧 | **直近2週間だけ**（ロールング） | 全期間・月送り |
| 先月比 | なし | あり |
| カレンダー | 当月のみ・2週間より前の日はロック | 全月ブラウズ |
| レポート（グラフ/全期間集計） | ロック（ぼかし＋解放CTA） | 全機能 |
| パスコード / 上限アラート | あり（無料・据え置き） | あり |

- 見える範囲は1つのルールに集約：`FREE_LOOKBACK_DAYS = 14`（`freeCutoffISO()`）。
- 「過去を消す/隠す」ではなく「過去を"分析する"力」を売る設計。データ人質にしない。

## 3. 実装済み（JS/UI・純JS、外部ライブラリ追加なし）

対象ファイル（**ソースはリポジトリ直下。`npm run copy-web` で `www/` に複製 → `cap sync` で iOS/Android へ**）:
- `index.html` … レポートタブ(4枚目)＋レポートペイン＋ロックUI、きろくの解放CTA、設定「プレミアム」欄。`?v=` 更新(css24/js25)。
- `style.css` … ペインを4枚化(`.panes 400% / .pane 25%`)、レポート/ロック/CTAスタイル。
- `app.js`:
  - `PREMIUM_KEY / PREMIUM_PRODUCT_ID / FREE_LOOKBACK_DAYS`、`PANE_COUNT 3→4`。
  - `isPremium` 状態、`loadPremium/setPremium`、`freeCutoffISO/sumByTag`、`refreshPremiumUI/promptPremium`。
  - 無料ゲート：`renderRecordPane`(直近2週間分岐)、`renderCalendar`(古い日ロック＋月ナビロック)、月ナビ`goPrev/goNext`。
  - レポート：`renderReport / drawTrendChart`(直近6ヶ月 積み上げ棒・Canvas自前描画) / `renderBreakdown`(今月内訳) / `renderReportStats`(全期間集計)。
  - 課金ラッパ `Billing`（下記）。
- `sw.js` … `CACHE v25`＋`?v=` 更新。

Windows上で `node --check` と最小DOMシムでの起動スモークテスト（無料/プレミアム両方）合格済み。**ブラウザ実機での目視は未**。

## 4. 課金は「タイムラグ前提」で実装（重要）

注文→approved→verified まで反映に遅延がある。`Billing` は **イベント駆動**：
- 購入押下で「処理中…（ストアの応答を待っています）」表示。
- `approved→verify→verified` で `setPremium(true)` → 再描画。
- 起動時 `store.ready`/`receiptUpdated` で `syncOwned()` → 所有が後から判明したら解放。
- Web（`CdvPurchase` 無し）は localStorage キャッシュのまま。設定の「プレミアム」状態表示を**5回タップで dev トグル**（動作確認用、web/非ネイティブ限定）。

## 5. 残り作業（Mac / ストア） ← ここから未着手

1. **プラグイン導入**（純正ストア課金・外部サービスなし）
   ```bash
   npm i cordova-plugin-purchase
   npm run copy-web && npx cap sync
   ```
   - `app.js` の `Billing` は `window.CdvPurchase`(v13) を前提。**インストール版のAPI差異**（`store.get().getOffer().order()` / `store.owned()` / `store.restorePurchases()`）を実機で確認・微調整。
2. **iOSに確実にリンクさせる**
   - `capacitor.config.json` は現在 `ios.includePlugins: []`（AdMobクラッシュ対策）。**Cordovaプラグインがこの空配列で除外されないか要確認**。iOSビルドに purchase が入っていること（Xcodeでリンク確認）。入らなければ includePlugins の扱いを調整。
3. **ストア登録**
   - App Store Connect：非消費型IAP `...premium` ¥600 作成、**有料App契約を締結**、審査用スクショ/メモ。
   - Google Play Console：管理対象アイテム `premium` 同ID・同価格。
4. **App Privacy / 契約**：買い切りのみなら収集データは最小。RevenueCat等を使わないので外部送信なし。
5. **サンドボックス/シミュレータで購入・復元・再購入(復元)を検証**してから提出。ブラインド提出しない。

## 6. 大前提：先に起動クラッシュを直す

iOSは起動クラッシュで却下が続いている（Guideline 2.1a）。**ソースはAdMob除去済み(`15353ac` + `includePlugins:[]`)だが、Mac側のビルドが未クリーンでAdMobがAppバイナリに残っている疑いが濃厚**。
- 注意：GMA SDKは**staticフレームワーク**で`App`本体に溶け込むため、クラッシュログの Binary Images に `GoogleMobileAds` が出ない＝除去済み、とは限らない（`App`バイナリが2.8MBと過大なのも状況証拠）。
- **決定的テスト（Mac）**：アーカイブ済みバイナリに対し
  ```
  strings ".../App.app/App" | grep -i "GADApplicationIdentifier\|GADInvalidInitialization\|GoogleMobileAds"
  ```
  ヒット＝AdMob混入確定（これがクラッシュ真因）。ヒット無し＝dSYMでsymbolicateして別真因を特定。
- **クリーン再ビルド**：Xcode全終了→`rm -rf ~/Library/Developer/Xcode/DerivedData/*`＋SPMキャッシュ/`Package.resolved`削除→`npm run copy-web`→`npx cap sync ios`→Reset Package Caches＋Clean Build Folder→`capacitor-swift-pm`だけ確認→アーカイブ後に再度 strings で混入無し確認→**iPad実機/シミュレータで起動確認**→提出。
- ビルド番号は消化済みの2・3が使えないため**4以上**。→ **`project.pbxproj` の `CURRENT_PROJECT_VERSION` は既に 4 に設定済み（`MARKETING_VERSION` は 1.0 のまま）**。これで次のアーカイブは 1.0(4) となり、App Store Connect の「1.0 for iOS」に紐づけ・選択できる（1.1で作ると1.0の下に出ず選べないので1.0を維持）。現在ASCはビルド2選択のまま＝修正版が一度も審査に出ていない状態。

**課金を乗せる前に、この起動クラッシュを先に潰す。** 落ちる土台に課金を積んでも審査は通らない。詳細は `HANDOFF.md` とメモリ [[kakeibo-release-status]]。
