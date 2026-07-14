# プレミアム（買い切り課金）実装メモ — ゆとり家計簿

最終更新: 2026-07-14
状態: **ネイティブ課金プラグイン導入・JS実装済み（Windows側完了）。残り＝Macでの `cap sync`/アーカイブ と App Store Connect の商品登録＋有料App契約（§7）。**

## 0. 却下（2.1b）と対応 — 2026-07-14

- 却下: **Guideline 2.1(b)** 「購入ボタンを押しても購入に進めない」。Submission `d8401e2d-...`、ビルド 1.0(5)、iPad Air 11" (M3) / iPadOS 26.5.2。
- 真因: **`cordova-plugin-purchase` が未インストールで iOS に StoreKit がリンクされていなかった**。`window.CdvPurchase` が無く `store===null` → 購入ボタンが「アプリ内で購入できます（準備中）」トーストを出すだけだった（審査スクショで確認）。加えて `capacitor.config.json` の `ios.includePlugins: []`（AdMob除外用の空許可リスト）が、購入プラグインまで除外する状態だった。
- Windows側で実施済み（このコミット）:
  1. `npm i cordova-plugin-purchase`（v13.17.2）→ `package.json`/`node_modules` に追加。
  2. `capacitor.config.json` の `ios.includePlugins` を **`["cordova-plugin-purchase"]`** に。CLIソース（`@capacitor/cli/dist/plugin.js`）で、この許可リスト方式が Cordovaプラグインを名前解決して取り込む＝StoreKitがリンクされることを確認。AdMobはリスト外なので引き続き除外＝起動クラッシュ対策は維持。
  3. `app.js` の `Billing` を v13 実APIに整合＋**タイムラグ耐性**に作り替え（§4）。
  4. バージョン更新: `?v=26`・`CACHE=yurutto-v26`・`CURRENT_PROJECT_VERSION=6`（5は却下で消化済みのため6）。
  5. `npm run copy-web` で `www/` 反映済み。`node --check` 合格。

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

## 4. 課金は「タイムラグ前提」で実装（重要・2026-07-14 強化）

注文→approved→verified まで反映に遅延がある。`Billing` は **イベント駆動**で、**早まって「失敗/キャンセル」を出さない**：
- 購入押下で「処理中…（ストアの応答を待っています）」表示＋`pending=true`＋**watchdog(45秒)** 起動。
- 購入完了は **`approved→verify→verified` イベントでのみ確定**（`unlock()` → `setPremium(true)`）。`Offer.order()` の戻り値では確定させない。
- `Offer.order()` は例外でなく `IError` を解決値で返す。**キャンセル(`ErrorCode.PAYMENT_CANCELLED`)だけ**即「購入をキャンセルしました」。他のエラーは失敗と断定せず待つ。
- グローバル `store.error` も **キャンセル時だけ**UIに反映。初期化時・一時的なエラーはUIに出さない（後から通ることがあるため。旧実装はここで毎回「エラー」を出していた＝誤検知の元）。
- watchdog 到達時も「失敗」ではなく「通信に時間がかかっています。購入が完了すると自動で反映されます」と出して操作可能に戻す。
- iOSでは **Apple プラットフォームのみ** register/initialize（`Capacitor.getPlatform()` で判定。iOSでGooglePlayアダプタを初期化するとそのエラーがペイウォールに出るため）。
- 起動時 `store.ready`/`receiptUpdated` で `syncOwned()`（`Product.owned` ゲッターで判定）→ 所有が後から判明したら解放。
- Web（`CdvPurchase` 無し）は localStorage キャッシュのまま。設定の「プレミアム」状態表示を**5回タップで dev トグル**（動作確認用、web/非ネイティブ限定）。

### キルスイッチ `IAP_ENABLED`（app.js 冒頭）
- `true`＝課金ON（ペイウォール/購入UI表示）。**購入が実際に動く状態でのみ true**。
- `false`＝全機能無料・購入UI完全非表示（IAPが壊れた時の緊急ホットフィックス用／未実装のまま出す時用）。
- 現在 `true`。→ この更新で購入まで載せるなら、下記5を**全部終えてから**アーカイブすること。

## 5. 残り作業（Mac / ストア） ← 購入を"実際に動かす"のに必須

1. ~~**プラグイン導入**~~ **✅ 済（Windows側）**。`cordova-plugin-purchase@13.17.2` を `package.json` に追加済み。`app.js` の `Billing` は v13 実API（`store.get().getOffer().order()` / `Product.owned` / `store.restorePurchases()`）に整合済み。
2. ~~**iOSに確実にリンク**~~ **設定は済**。`ios.includePlugins: ["cordova-plugin-purchase"]`。**Macで `npx cap sync ios` 後、Xcodeで実際にリンクされたか要確認**（Package Dependencies / ビルドに StoreKit と purchase が入ること。§7手順）。
3. **App Store Connect（★未・ここが今回の再落ち回避の本丸）**
   - 非消費型IAP **`com.tmk4men.yuruttokakeibo.premium`** ¥600 を作成し、状態を **「提出準備完了(Ready to Submit)」** にする（表示名・審査用スクショ・説明を埋める）。
   - **有料App契約(Paid Apps Agreement)を締結**（Business内）。Appleの却下文が名指しした必須条件。未締結だとサンドボックスでも商品が返らず、コードが正しくても購入に進めない＝また2.1bで落ちる。
   - ※商品が読めないと新コードは「商品を読み込めませんでした」を出す。**プラグインのリンクとASC商品登録の両方が揃って初めて購入が動く。**
4. **App Privacy / 契約**：買い切りのみなら収集データは最小。RevenueCat等を使わないので外部送信なし。
5. **Sandboxテスト必須**：Sandboxアカウントで購入→approved→verified→解放、アプリ削除後に「購入を復元」で再解放、を実機で確認してから提出。**ブラインド提出しない。**
6. （任意）Google Play Console：管理対象アイテム `premium` 同ID・同価格。Android版に課金を出すとき。

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

---

## 7. 再提出チェックリスト（2.1b 対応・Mac + App Store Connect）

Windows側は完了。以下は **Mac と App Store Connect** でやること。**上2つ（リンク・商品登録）が両方揃わないと購入は動かない。**

### A. Mac（ビルド）
```bash
git pull origin main          # このコミットを取り込む
npm install                   # cordova-plugin-purchase が入る
npm run copy-web              # 省略不可（www/ を再生成）
npx cap sync ios              # ← purchase を iOS に注入。ログに
                              #   「Found 1 Cordova plugin for ios: cordova-plugin-purchase」が出ること
npx cap open ios
```
- Xcode: ビルドに **StoreKit.framework** と purchase が入っているか確認。AdMob系（`CapacitorCommunityAdmob`/`GoogleMobileAds`）が**残っていないこと**（残っていたら Reset Package Caches → Clean Build Folder）。
- ビルド番号は **1.0(6)**（`CURRENT_PROJECT_VERSION=6`。2〜5は消化済み）。`MARKETING_VERSION` は 1.0 のまま。
- アーカイブ → App Store Connect の「1.0 for iOS」でビルド6を選択。

### B. App Store Connect（★これを忘れると再び2.1bで落ちる）
- [ ] **有料App契約(Paid Apps Agreement)** を締結・有効（Business）。← Apple却下文が名指しした必須条件。
- [ ] 非消費型IAP **`com.tmk4men.yuruttokakeibo.premium`** ¥600 を作成、表示名・審査スクショ・説明を入力し **Ready to Submit** に。
- [ ] IAPをこのアプリバージョンに紐付けて一緒に提出。

### C. Sandbox 検証（提出前・必須）
- [ ] Sandboxアカウントで購入 → 「処理中…」→ 数秒後にレポート/全期間が解放（`verified`）。
- [ ] アプリ削除→再インストール→「購入を復元」で再解放。
- [ ] 購入ダイアログでキャンセル → 「購入をキャンセルしました」（フリーズしない）。
- [ ] 機内モード等で応答が来なくても、45秒で「時間がかかっています…完了時に自動反映」に戻り操作可能（＝誤って「失敗」を出さない）。

### D. 審査メモ（App Review Information に書くと親切）
- 「Premium は非消費型IAP `...premium`（¥600）。レポートタブの『プレミアムで解放』またはメニュー＞設定＞プレミアムから購入。Sandboxで購入・復元を確認済み。」
