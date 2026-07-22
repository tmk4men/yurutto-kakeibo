(() => {
  'use strict';

  const STORAGE_KEY = 'kakeibo.entries';
  const LIMITS_KEY = 'kakeibo.limits';   // {necessary?: number, enjoy?: number, waste?: number}
  const PREMIUM_KEY = 'kakeibo.premium'; // '1' なら購入済み (エンタイトルメント・キャッシュ)
  const PREMIUM_PRODUCT_ID = 'com.tmk4men.yuruttokakeibo.premium'; // 非消費型 買い切り
  const FREE_LOOKBACK_DAYS = 14;         // 無料は直近2週間だけ閲覧できる
  // 課金(IAP)のキルスイッチ。true=課金ON（ペイウォール/購入UIを表示）。
  // ★重要: 購入が"実際に動く"状態（プラグイン導入＋ストア商品登録＋有料App契約）でのみ true にすること。
  //   まだ動かないのに true で審査に出すと「機能しない購入UI」でリジェクトされる。
  // false にすると全機能無料・購入UIを完全非表示（IAPが壊れた時の緊急ホットフィックス用）。
  const IAP_ENABLED = true;
  const PASS_KEY = 'kakeibo.passhash';   // SHA-256(salt+code) hex string
  const PASS_SALT = 'yurutto-2026';      // 単純な辞書攻撃を防ぐ程度のソルト
  const PASS_LENGTH = 4;
  const NEAR_RATIO = 0.8; // 80%以上で「もうすぐ」
  const TAGS = {
    necessary: '必要',
    enjoy: '楽しみ',
    waste: 'ムダかも',
  };
  const HINTS = {
    necessary: '生活でいる出費',
    enjoy: '買ってよかった出費',
    waste: 'ちょっと反省してる出費',
  };
  const AMOUNT_MAX_DIGITS = 7; // 9,999,999 まで
  const PANE_COUNT = 4;
  const PANE_PCT = 100 / PANE_COUNT;
  const LAST_PANE = PANE_COUNT - 1;
  const AUTO_LOOKBACK_DAYS = 30; // 直近30日から平均を取り、過去30日の空白日を埋める
  const DOW_KANJI = ['日', '月', '火', '水', '木', '金', '土'];

  // Google AdMob (Android / iOS アプリ) — Web版はプレースホルダ表示
  const ADMOB_CONFIG = {
    // タブごとのバナー広告ユニットID (0=書く, 1=きろく, 2=カレンダー) — プラットフォーム別
    bannerIdsAndroid: [
      'ca-app-pub-5634961953346923/6932288160', // 書く
      'ca-app-pub-5634961953346923/2816130946', // きろく (家計簿2)
      'ca-app-pub-5634961953346923/3498657223', // カレンダー (家計簿3)
    ],
    bannerIdsIos: [
      'ca-app-pub-2783540275927131/6126527828', // 書く
      'ca-app-pub-2783540275927131/2844657316', // きろく
      'ca-app-pub-2783540275927131/7905412309', // カレンダー
    ],
    // 診断用: true にすると Google公式テスト広告IDで動作確認できる（必ず広告が出る）
    useTestAd: false,
    testBannerId: 'ca-app-pub-3940256099942544/6300978111',
    // 診断用: true にすると広告の状態を画面上部のバーに表示する
    debug: false,
  };

  // ─── 状態 ──────────────────
  let entries = loadEntries();
  let amountDigits = ''; // 入力された数字を文字列で保持
  let viewYear, viewMonth;
  let limits = loadLimits(); // {necessary, enjoy, waste} — null/undefined は未設定
  let activePane = 0; // 0=書く, 1=きろく
  let nativeAdMob = null; // AdMob プラグイン参照 (バナー貼り替え用)
  let currentBannerPane = -1; // 現在バナーを表示しているタブ
  let bannerBusy = false; // 貼り替え処理中フラグ
  let pendingBannerPane = null; // 処理中に届いた次の切替先 (連続スワイプ対策)
  let toastTimer = null;
  let toastActionHandler = null;
  let hintHideTimer = null;
  let lockMode = null;        // 'unlock' | 'set-1' | 'set-2' | 'change-current' | 'change-1' | 'change-2' | 'remove-confirm'
  let lockBuffer = '';
  let lockSetupTemp = '';
  let lockOnSuccess = null;
  let dayModalDate = null;    // 編集モーダルで開いている日付 'YYYY-MM-DD'
  let isPremium = IAP_ENABLED ? loadPremium() : true; // 課金OFF時は全機能アンロック

  let billingBusy = false;    // 購入/復元の処理中フラグ (課金は反映までタイムラグあり)

  // ─── DOM ──────────────────
  const dateInput = document.getElementById('dateInput');
  const amountDisplay = document.getElementById('amountDisplay');
  const numpadEl = document.getElementById('numpad');
  const tagButtons = document.querySelectorAll('.tag');
  const monthLabel = document.getElementById('monthLabel');
  const prevMonthBtn = document.getElementById('prevMonth');
  const nextMonthBtn = document.getElementById('nextMonth');
  const sumNecessary = document.getElementById('sumNecessary');
  const sumEnjoy = document.getElementById('sumEnjoy');
  const sumWaste = document.getElementById('sumWaste');
  const sumTotal = document.getElementById('sumTotal');
  const diffNecessary = document.getElementById('diffNecessary');
  const diffEnjoy = document.getElementById('diffEnjoy');
  const diffWaste = document.getElementById('diffWaste');
  const ratioBar = document.getElementById('ratioBar');
  const entryList = document.getElementById('entryList');
  const emptyMsg = document.getElementById('emptyMsg');
  const limitInputs = document.querySelectorAll('.limit-input');
  const rowEls = {
    necessary: document.getElementById('rowNecessary'),
    enjoy: document.getElementById('rowEnjoy'),
    waste: document.getElementById('rowWaste'),
  };
  const limitEls = {
    necessary: document.getElementById('limitNecessary'),
    enjoy: document.getElementById('limitEnjoy'),
    waste: document.getElementById('limitWaste'),
  };
  const tabButtons = document.querySelectorAll('.tab');
  const panesEl = document.getElementById('panes');
  const paneViewport = document.querySelector('.pane-viewport');
  const monthLabelCal = document.getElementById('monthLabelCal');
  const prevMonthCalBtn = document.getElementById('prevMonthCal');
  const nextMonthCalBtn = document.getElementById('nextMonthCal');
  const calGrid = document.getElementById('calGrid');
  const dayModal = document.getElementById('dayModal');
  const dayModalBackdrop = document.getElementById('dayModalBackdrop');
  const dayModalClose = document.getElementById('dayModalClose');
  const dayModalTitle = document.getElementById('dayModalTitle');
  const dayList = document.getElementById('dayList');
  const dayEmpty = document.getElementById('dayEmpty');
  const dayAddAmount = document.getElementById('dayAddAmount');
  const dayAddTags = document.querySelectorAll('.day-add__tag');
  const toastEl = document.getElementById('toast');
  const toastText = document.getElementById('toastText');
  const toastAction = document.getElementById('toastAction');
  const hintPopEl = document.getElementById('hintPop');
  const statusBubble = document.getElementById('statusBubble');
  const helpBtn = document.getElementById('helpBtn');
  const helpModal = document.getElementById('helpModal');
  const helpClose = document.getElementById('helpClose');
  const helpBackdrop = document.getElementById('helpBackdrop');
  const passwordStatus = document.getElementById('passwordStatus');
  const pwSetBtn = document.getElementById('pwSetBtn');
  const pwChangeBtn = document.getElementById('pwChangeBtn');
  const pwRemoveBtn = document.getElementById('pwRemoveBtn');
  const lockScreen = document.getElementById('lockScreen');
  const lockTitle = document.getElementById('lockTitle');
  const lockHint = document.getElementById('lockHint');
  const lockDots = document.getElementById('lockDots');
  const lockPad = document.getElementById('lockPad');
  const lockBack = document.getElementById('lockBack');
  const lockCancel = document.getElementById('lockCancel');
  const lockForgot = document.getElementById('lockForgot');
  // レポート / プレミアム
  const reportBody = document.getElementById('reportBody');
  const trendChart = document.getElementById('trendChart');
  const reportBreakdown = document.getElementById('reportBreakdown');
  const reportStats = document.getElementById('reportStats');
  const proLock = document.getElementById('proLock');
  const proBuyBtn = document.getElementById('proBuyBtn');
  const proRestoreBtn = document.getElementById('proRestoreBtn');
  const proStatus = document.getElementById('proStatus');
  const recordProCta = document.getElementById('recordProCta');
  const premiumStatus = document.getElementById('premiumStatus');
  const premiumSettingsRow = document.getElementById('premiumSettingsRow');
  const premiumBuyBtn = document.getElementById('premiumBuyBtn');
  const premiumRestoreBtn = document.getElementById('premiumRestoreBtn');

  // ─── 初期化 ──────────────────
  const today = new Date();
  viewYear = today.getFullYear();
  viewMonth = today.getMonth();
  dateInput.value = toISODate(today);

  renderNumpad();
  populateLimitInputs();
  bindEvents();
  updateAmountDisplay();
  setActivePane(0, false);
  regenerateAutoEntries();
  render();
  initLock();
  initAds();
  registerServiceWorker();

  // ─── イベントバインド ──────────────────
  function bindEvents() {
    // テンキー (数字直接入力 + ⌫)
    numpadEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.key');
      if (!btn) return;
      if (btn.classList.contains('key--back')) {
        amountDigits = amountDigits.slice(0, -1);
      } else if (btn.classList.contains('key--digit')) {
        const d = btn.dataset.digit;
        if (d === undefined) return;
        // 先頭0は伸ばさない (0,00,001 を避ける)
        if (amountDigits === '' && d === '0') return;
        if (amountDigits.length >= AMOUNT_MAX_DIGITS) return;
        amountDigits += d;
      } else {
        return;
      }
      updateAmountDisplay();
    });

    // タグ: タップで即保存、長押しで意味のヒント
    tagButtons.forEach(bindTagPress);

    // タブ
    tabButtons.forEach((btn, idx) => {
      btn.addEventListener('click', () => setActivePane(idx, true));
    });

    // 月ナビ (きろく / カレンダー両方が同じ viewYear/viewMonth を見る)
    const goPrev = () => {
      if (!isPremium) { promptPremium(); return; }
      ({ year: viewYear, month: viewMonth } = prevMonth(viewYear, viewMonth));
      render();
    };
    const goNext = () => {
      if (!isPremium) { promptPremium(); return; }
      ({ year: viewYear, month: viewMonth } = nextMonth(viewYear, viewMonth));
      render();
    };
    prevMonthBtn.addEventListener('click', goPrev);
    nextMonthBtn.addEventListener('click', goNext);
    prevMonthCalBtn.addEventListener('click', goPrev);
    nextMonthCalBtn.addEventListener('click', goNext);

    // 日付編集モーダル
    dayModalClose.addEventListener('click', closeDayModal);
    dayModalBackdrop.addEventListener('click', closeDayModal);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dayModal.classList.contains('is-open')) closeDayModal();
    });
    dayAddTags.forEach((btn) => {
      btn.addEventListener('click', () => handleDayAdd(btn.dataset.tag));
    });

    // 上限の入力
    limitInputs.forEach((input) => {
      input.addEventListener('input', () => {
        const tag = input.dataset.limitTag;
        const v = parseInt(input.value, 10);
        if (Number.isFinite(v) && v > 0) {
          limits = { ...limits, [tag]: v };
        } else {
          const next = { ...limits };
          delete next[tag];
          limits = next;
        }
        saveLimits();
        render();
      });
    });

    // 横スワイプ
    bindSwipe();

    // 画面回転/リサイズ時、レポート表示中ならグラフを描き直す
    let resizeTimer = null;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (activePane === 3) renderReport(); }, 150);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    // ヒントを画面のどこか別場所をタップしたら隠す
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.tag')) hideHint();
    });

    // 使い方モーダル
    helpBtn.addEventListener('click', openHelp);
    helpClose.addEventListener('click', closeHelp);
    helpBackdrop.addEventListener('click', closeHelp);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && helpModal.classList.contains('is-open')) closeHelp();
    });

    // トーストのアクションボタン (Undoなど)
    toastAction.addEventListener('click', () => {
      if (toastActionHandler) toastActionHandler();
    });

    // パスワード操作
    pwSetBtn.addEventListener('click', () => startSetPassword());
    pwChangeBtn.addEventListener('click', () => startChangePassword());
    pwRemoveBtn.addEventListener('click', () => startRemovePassword());

    // ロック画面の数字パッド
    lockPad.addEventListener('click', (e) => {
      const btn = e.target.closest('.lock-key');
      if (!btn) return;
      if (btn === lockBack) {
        lockBuffer = lockBuffer.slice(0, -1);
        updateLockDots();
        return;
      }
      if (btn === lockCancel) {
        cancelLockFlow();
        return;
      }
      const d = btn.dataset.digit;
      if (d === undefined) return;
      if (lockBuffer.length >= PASS_LENGTH) return;
      lockBuffer += d;
      updateLockDots();
      if (lockBuffer.length === PASS_LENGTH) {
        // 自動で次へ
        setTimeout(submitLock, 80);
      }
    });

    lockForgot.addEventListener('click', handleForgot);

    // プレミアム (購入 / 復元)
    const buy = () => Billing.purchase();
    const restore = () => Billing.restore();
    proBuyBtn.addEventListener('click', buy);
    premiumBuyBtn.addEventListener('click', buy);
    proRestoreBtn.addEventListener('click', restore);
    premiumRestoreBtn.addEventListener('click', restore);
    recordProCta.addEventListener('click', () => setActivePane(3, true));

    // Web/PWA (課金の無い環境) では動作確認用に購入状態を切り替えられる隠し操作:
    // 設定の「プレミアム」ラベルを5回タップ
    if (!isNativeApp()) enableDevPremiumToggle();

    // 課金OFF時は購入UIを完全に隠す (設定のプレミアム行も含む)
    if (!IAP_ENABLED && premiumSettingsRow) premiumSettingsRow.hidden = true;

    refreshPremiumUI();
    // Billing.init() は Billing 定義後 (ファイル末尾) で呼ぶ (const の TDZ 回避)
  }

  function openHelp() {
    refreshPasswordSection();
    helpModal.classList.add('is-open');
  }
  function closeHelp() {
    helpModal.classList.remove('is-open');
  }

  // ─── タグ: タップ即保存 + 長押しヒント ──────────────────
  function bindTagPress(btn) {
    let pressTimer = null;
    let isLongPress = false;
    const startPress = (e) => {
      isLongPress = false;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        isLongPress = true;
        showHint(btn);
      }, 450);
    };
    const cancelPress = () => {
      clearTimeout(pressTimer);
    };

    btn.addEventListener('touchstart', startPress, { passive: true });
    btn.addEventListener('touchend', cancelPress);
    btn.addEventListener('touchmove', cancelPress);
    btn.addEventListener('touchcancel', cancelPress);
    btn.addEventListener('mousedown', startPress);
    btn.addEventListener('mouseup', cancelPress);
    btn.addEventListener('mouseleave', cancelPress);

    btn.addEventListener('click', (e) => {
      if (isLongPress) {
        e.preventDefault();
        e.stopPropagation();
        isLongPress = false;
        return;
      }
      hideHint();
      handleTagSelect(btn);
    });
  }

  function handleTagSelect(btn) {
    const tag = btn.dataset.tag;
    const amount = currentAmount();
    if (!(amount > 0)) {
      shakeAmount();
      showToast('金額を入れて');
      return;
    }
    const entryDate = dateInput.value || toISODate(new Date());
    const [eY, eM] = entryDate.split('-').map(Number);
    const before = getMonthSums(eY, eM - 1)[tag];
    saveEntry({ tag, amount, date: entryDate });
    regenerateAutoEntries();
    resetForm();
    flashSaved(btn);
    render();

    const limit = limits[tag];
    const after = before + amount;
    if (limit && before <= limit && after > limit) {
      showToast(`${TAGS[tag]}が上限こえた！`, 2400, 'yabai');
    } else if (limit && after > limit) {
      showToast(`書いた！(${TAGS[tag]} +¥${(after - limit).toLocaleString('ja-JP')}超え)`, 2000, 'yabai');
    } else {
      showToast('書いた！');
    }
  }

  function flashSaved(btn) {
    btn.classList.remove('is-saved');
    // 連続押し対応のため一度リフローしてからクラス再付与
    void btn.offsetWidth;
    btn.classList.add('is-saved');
    setTimeout(() => btn.classList.remove('is-saved'), 380);
  }

  function shakeAmount() {
    amountDisplay.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-6px)' },
        { transform: 'translateX(6px)' },
        { transform: 'translateX(-3px)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 280, easing: 'ease-out' }
    );
  }

  function saveEntry({ tag, amount, date }) {
    const entry = {
      id: Date.now().toString(),
      date: date || dateInput.value || toISODate(new Date()),
      amount,
      tag,
    };
    entries.push(entry);
    saveEntries();
  }

  function resetForm() {
    amountDigits = '';
    dateInput.value = toISODate(new Date());
    updateAmountDisplay();
  }

  // ─── テンキー描画 ──────────────────
  function renderNumpad() {
    numpadEl.innerHTML = '';
    // 1-9
    for (let n = 1; n <= 9; n++) {
      numpadEl.appendChild(makeDigitKey(String(n)));
    }
    // 左下: 空白セル / 中央下: 0 / 右下: ⌫
    const blank = document.createElement('span');
    blank.className = 'key key--blank';
    blank.setAttribute('aria-hidden', 'true');
    numpadEl.appendChild(blank);

    numpadEl.appendChild(makeDigitKey('0'));

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'key key--back';
    back.setAttribute('aria-label', '一文字消す');
    back.textContent = '⌫';
    numpadEl.appendChild(back);
  }

  function makeDigitKey(d) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'key key--digit';
    btn.dataset.digit = d;
    btn.textContent = d;
    return btn;
  }

  // ─── 金額表示 ──────────────────
  function currentAmount() {
    return amountDigits === '' ? 0 : parseInt(amountDigits, 10);
  }

  function updateAmountDisplay() {
    const n = currentAmount();
    amountDisplay.textContent = n === 0 ? '0' : n.toLocaleString('ja-JP');
    amountDisplay.classList.toggle('is-empty', n === 0);
  }

  // ─── トースト ──────────────────
  // showToast(msg)
  // showToast(msg, ms, variant)               — 旧シグネチャ互換
  // showToast(msg, { ms, variant, action })   — 新シグネチャ
  function showToast(msg, optsOrMs = {}, variantStr = '') {
    let opts;
    if (typeof optsOrMs === 'number') {
      opts = { ms: optsOrMs, variant: variantStr };
    } else {
      opts = optsOrMs || {};
    }
    const { ms = 1400, variant = '', action = null } = opts;
    toastText.textContent = msg;
    if (action) {
      toastAction.textContent = action.label || 'もどす';
      toastAction.hidden = false;
      toastActionHandler = action.onClick || null;
    } else {
      toastAction.hidden = true;
      toastActionHandler = null;
    }
    toastEl.className = 'toast is-show' + (variant ? ` toast--${variant}` : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, ms);
  }

  function hideToast() {
    toastEl.classList.remove('is-show');
    toastActionHandler = null;
  }

  // ─── ヒントポップ ──────────────────
  function showHint(btn) {
    const tag = btn.dataset.tag;
    const text = HINTS[tag];
    if (!text) return;
    hintPopEl.textContent = text;
    // 表示してから幅を測りたいので一旦見えるが透明にしない
    hintPopEl.classList.add('is-show');
    const rect = btn.getBoundingClientRect();
    const popH = hintPopEl.offsetHeight || 36;
    hintPopEl.style.left = `${rect.left + rect.width / 2}px`;
    hintPopEl.style.top = `${rect.top - popH - 10}px`;
    clearTimeout(hintHideTimer);
    hintHideTimer = setTimeout(hideHint, 1800);
  }

  function hideHint() {
    hintPopEl.classList.remove('is-show');
    clearTimeout(hintHideTimer);
  }

  // ─── タブ切替 ──────────────────
  function setActivePane(idx, animate) {
    activePane = idx;
    if (animate) panesEl.classList.add('is-animating');
    else panesEl.classList.remove('is-animating');
    panesEl.style.transform = `translateX(-${PANE_PCT * idx}%)`;
    tabButtons.forEach((t, i) => {
      const active = i === idx;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (idx !== 0) hideHint();
    if (idx === 3) renderReport(); // グラフを現在サイズで描き直す
    showBannerForPane(idx);
  }

  // ─── 横スワイプ ──────────────────
  function bindSwipe() {
    let startX = 0, startY = 0, dx = 0;
    let direction = null; // null | 'h' | 'v'
    let dragging = false;

    paneViewport.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      // 入力中のチップやタグ上でのタップ起点はスワイプにしない (連打しやすく)
      // ただし数字パッドの押し感は残したいのでとりあえず全部受ける
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dx = 0;
      direction = null;
      dragging = true;
      panesEl.classList.remove('is-animating');
    }, { passive: true });

    paneViewport.addEventListener('touchmove', (e) => {
      if (!dragging || e.touches.length !== 1) return;
      const cx = e.touches[0].clientX;
      const cy = e.touches[0].clientY;
      const ddx = cx - startX;
      const ddy = cy - startY;
      if (direction === null && (Math.abs(ddx) > 10 || Math.abs(ddy) > 10)) {
        direction = Math.abs(ddx) > Math.abs(ddy) ? 'h' : 'v';
      }
      if (direction === 'h') {
        e.preventDefault();
        dx = ddx;
        const vw = paneViewport.clientWidth || 1;
        // 端での過剰ドラッグを軽く抑制
        let limited = dx;
        if ((activePane === 0 && dx > 0) || (activePane === LAST_PANE && dx < 0)) {
          limited = dx * 0.3;
        }
        const offsetPct = -PANE_PCT * activePane + (limited / vw) * PANE_PCT;
        panesEl.style.transform = `translateX(${offsetPct}%)`;
      }
    }, { passive: false });

    const finish = () => {
      if (!dragging) return;
      dragging = false;
      if (direction === 'h') {
        const vw = paneViewport.clientWidth || 1;
        const ratio = dx / vw;
        if (ratio < -0.18 && activePane < LAST_PANE) {
          setActivePane(activePane + 1, true);
        } else if (ratio > 0.18 && activePane > 0) {
          setActivePane(activePane - 1, true);
        } else {
          setActivePane(activePane, true);
        }
      }
      direction = null;
    };
    paneViewport.addEventListener('touchend', finish);
    paneViewport.addEventListener('touchcancel', finish);
  }

  // ─── 削除 + Undo ──────────────────
  function handleDelete(id) {
    const idx = entries.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const removed = entries[idx];
    if (removed.auto) {
      // 自動入力は消してもすぐ再生成されるので、編集に誘導する
      showToast('自動入力はカレンダーで直してね', 1800);
      return;
    }
    entries.splice(idx, 1);
    saveEntries();
    regenerateAutoEntries();
    render();
    showToast('消した', {
      ms: 4000,
      action: {
        label: 'もどす',
        onClick: () => {
          // 同じidが存在しないことを確認 (二重押し対策)
          if (entries.some((e) => e.id === removed.id)) return;
          entries.splice(Math.min(idx, entries.length), 0, removed);
          saveEntries();
          regenerateAutoEntries();
          render();
          hideToast();
        },
      },
    });
  }

  // ─── 描画 (きろく + カレンダー) ──────────────────
  function render() {
    renderRecordPane();
    renderCalendar();
    renderReport();
  }

  function renderRecordPane() {
    let list, sums, prevSums;

    if (isPremium) {
      monthLabel.textContent = `${viewMonth + 1}月の記録`;
      sums = getMonthSums(viewYear, viewMonth);
      const prev = prevMonth(viewYear, viewMonth);
      prevSums = getMonthSums(prev.year, prev.month);
      list = entries.filter((e) => isInMonth(e.date, viewYear, viewMonth));
    } else {
      // 無料: 直近2週間 (ロールング) のみ
      const cutoff = freeCutoffISO();
      monthLabel.textContent = '直近2週間';
      list = entries.filter((e) => e.date >= cutoff);
      sums = sumByTag(list);
      prevSums = null;
    }

    sumNecessary.textContent = formatYen(sums.necessary);
    sumEnjoy.textContent = formatYen(sums.enjoy);
    sumWaste.textContent = formatYen(sums.waste);
    sumTotal.textContent = formatYen(sums.necessary + sums.enjoy + sums.waste);

    if (isPremium && prevSums) {
      setDiff(diffNecessary, sums.necessary, prevSums.necessary);
      setDiff(diffEnjoy, sums.enjoy, prevSums.enjoy);
      setDiff(diffWaste, sums.waste, prevSums.waste);
    } else {
      clearDiff(diffNecessary); clearDiff(diffEnjoy); clearDiff(diffWaste);
    }

    setLimitState('necessary', sums.necessary);
    setLimitState('enjoy', sums.enjoy);
    setLimitState('waste', sums.waste);

    renderRatioBar(sums);
    renderStatusBubble(sums);

    // 月ナビ・解放CTAの出し分け (無料は全月ブラウズ不可)
    prevMonthBtn.classList.toggle('is-pro-locked', !isPremium);
    nextMonthBtn.classList.toggle('is-pro-locked', !isPremium);
    recordProCta.hidden = isPremium;

    const sorted = list.sort((a, b) =>
      a.date === b.date ? b.id.localeCompare(a.id) : b.date.localeCompare(a.date)
    );

    entryList.innerHTML = '';
    if (sorted.length === 0) {
      emptyMsg.classList.remove('is-hidden');
      entryList.classList.add('is-hidden');
      return;
    }
    emptyMsg.classList.add('is-hidden');
    entryList.classList.remove('is-hidden');

    for (const e of sorted) {
      entryList.appendChild(renderEntry(e));
    }
  }

  function clearDiff(el) {
    el.textContent = '';
    el.classList.remove('is-up', 'is-down');
  }

  function setDiff(el, curr, prev) {
    if (curr === 0 && prev === 0) {
      el.textContent = '';
      el.classList.remove('is-up', 'is-down');
      return;
    }
    const d = curr - prev;
    if (d === 0) {
      el.textContent = '先月と同じ';
      el.classList.remove('is-up', 'is-down');
      return;
    }
    const sign = d > 0 ? '+' : '−';
    el.textContent = `先月${sign}${formatYen(Math.abs(d))}`;
    el.classList.toggle('is-up', d > 0);
    el.classList.toggle('is-down', d < 0);
  }

  function setLimitState(tag, sum) {
    const row = rowEls[tag];
    const el = limitEls[tag];
    const limit = limits[tag];
    if (!limit || limit <= 0) {
      el.textContent = '';
      row.classList.remove('is-over', 'is-near');
      return;
    }
    el.textContent = ` / ¥${limit.toLocaleString('ja-JP')}`;
    const over = sum > limit;
    const near = !over && sum >= limit * NEAR_RATIO;
    row.classList.toggle('is-over', over);
    row.classList.toggle('is-near', near);
  }

  function renderStatusBubble(sums) {
    const { text, tone } = computeStatus(sums);
    statusBubble.textContent = text;
    statusBubble.className = `status-bubble is-${tone}`;
  }

  function computeStatus(sums) {
    const total = sums.necessary + sums.enjoy + sums.waste;
    if (total === 0) {
      return { text: 'まだ何も書いていないよ', tone: 'neutral' };
    }

    // 上限が設定されているタグについて、超過率を計算
    // overRatio = (used - limit) / limit  → 正なら超過、負なら余裕
    let maxOverTag = null;
    let maxOverRatio = 0;
    let maxNearTag = null;
    let maxNearRatio = 0;
    for (const tag of ['necessary', 'enjoy', 'waste']) {
      const lim = limits[tag];
      if (!lim) continue;
      const ratio = (sums[tag] - lim) / lim;
      if (ratio > maxOverRatio) {
        maxOverRatio = ratio;
        maxOverTag = tag;
      }
      const usedRatio = sums[tag] / lim;
      if (ratio <= 0 && usedRatio >= NEAR_RATIO && usedRatio > maxNearRatio) {
        maxNearRatio = usedRatio;
        maxNearTag = tag;
      }
    }

    // 1) 一番超えてるタグに触れる
    if (maxOverTag) return overMessage(maxOverTag, maxOverRatio);

    // 2) 上限手前 (80%以上) のタグがあれば、もっとも近づいてるタグに触れる
    if (maxNearTag) return nearMessage(maxNearTag);

    // 3) 上限なくてもムダ比率が高ければ反省ゾーン
    if (total >= 1000 && sums.waste / total > 0.25) {
      return { text: '支払う前にもう一考...', tone: 'caution' };
    }

    // 4) 上限を設定済みで全部余裕
    if (Object.keys(limits).length > 0) {
      return { text: 'いい感じ！', tone: 'good' };
    }

    // 5) 上限なし、ムダ少なめ
    if (total >= 3000 && sums.waste / total < 0.1) {
      return { text: 'いい感じ！', tone: 'good' };
    }

    return { text: 'ぼちぼちのペース', tone: 'neutral' };
  }

  function overMessage(tag, ratio) {
    // ratio: 0.0 = ちょうど上限, 0.3 = 30%超, 1.0 = 倍
    const sev = ratio >= 1.0 ? 'bad' : ratio >= 0.3 ? 'mid' : 'mild';
    const M = {
      necessary: {
        mild: { text: '必要がちょっとオーバー', tone: 'caution' },
        mid:  { text: '必要が予算オーバー、引き締めどき', tone: 'alert' },
        bad:  { text: '必要、だいぶ超過。見直しどき', tone: 'alert' },
      },
      enjoy: {
        mild: { text: '楽しみ、ちょっとはみ出した', tone: 'caution' },
        mid:  { text: '楽しみすぎかも...', tone: 'caution' },
        bad:  { text: '楽しみだいぶオーバー、ひと休み', tone: 'alert' },
      },
      waste: {
        mild: { text: 'ムダ、ちょっと多め', tone: 'caution' },
        mid:  { text: '支払う前にもう一考...', tone: 'caution' },
        bad:  { text: 'ムダが多すぎ、深呼吸して...', tone: 'alert' },
      },
    };
    return M[tag][sev];
  }

  function nearMessage(tag) {
    if (tag === 'enjoy')     return { text: '楽しみがそろそろ大詰め', tone: 'soft' };
    if (tag === 'necessary') return { text: '必要がもうすぐ上限', tone: 'soft' };
    return { text: 'ムダ、もうすぐ上限', tone: 'soft' };
  }

  function renderRatioBar(sums) {
    const total = sums.necessary + sums.enjoy + sums.waste;
    const segs = [
      ['necessary', sums.necessary],
      ['enjoy', sums.enjoy],
      ['waste', sums.waste],
    ];
    for (const [tag, val] of segs) {
      const seg = ratioBar.querySelector(`.ratio-bar__seg--${tag}`);
      const pct = total > 0 ? (val / total) * 100 : 0;
      seg.style.flexBasis = `${pct}%`;
    }
  }

  function renderEntry(e) {
    const li = document.createElement('li');
    li.className = 'entry-item';
    if (e.auto) li.classList.add('is-auto');

    const dateSpan = document.createElement('span');
    dateSpan.className = 'entry-date';
    dateSpan.textContent = formatShortDate(e.date);

    const amountSpan = document.createElement('span');
    amountSpan.className = 'entry-amount';
    amountSpan.textContent = formatYen(e.amount);

    const children = [dateSpan, amountSpan];

    if (e.auto) {
      const badge = document.createElement('span');
      badge.className = 'entry-auto-badge';
      badge.textContent = '自動';
      children.push(badge);
    }

    const tagSpan = document.createElement('span');
    tagSpan.className = `entry-tag entry-tag--${e.tag}`;
    tagSpan.textContent = TAGS[e.tag];
    children.push(tagSpan);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'entry-delete';
    delBtn.setAttribute('aria-label', '削除');
    delBtn.textContent = '×';
    delBtn.addEventListener('click', () => handleDelete(e.id));
    children.push(delBtn);

    li.append(...children);
    return li;
  }

  // ─── データ ──────────────────
  function loadEntries() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveEntries() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }

  function loadLimits() {
    try {
      const raw = localStorage.getItem(LIMITS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      const out = {};
      for (const k of ['necessary', 'enjoy', 'waste']) {
        const v = parseInt(parsed[k], 10);
        if (Number.isFinite(v) && v > 0) out[k] = v;
      }
      return out;
    } catch {
      return {};
    }
  }

  function saveLimits() {
    localStorage.setItem(LIMITS_KEY, JSON.stringify(limits));
  }

  function populateLimitInputs() {
    limitInputs.forEach((input) => {
      const tag = input.dataset.limitTag;
      const v = limits[tag];
      input.value = v ? String(v) : '';
    });
  }

  function getMonthSums(year, month) {
    const sums = { necessary: 0, enjoy: 0, waste: 0 };
    for (const e of entries) {
      if (isInMonth(e.date, year, month)) sums[e.tag] += e.amount;
    }
    return sums;
  }

  function prevMonth(y, m) {
    return m === 0 ? { year: y - 1, month: 11 } : { year: y, month: m - 1 };
  }
  function nextMonth(y, m) {
    return m === 11 ? { year: y + 1, month: 0 } : { year: y, month: m + 1 };
  }

  // ─── 日付ユーティリティ ──────────────────
  function toISODate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function isInMonth(isoDate, year, month) {
    const [y, m] = isoDate.split('-').map(Number);
    return y === year && m - 1 === month;
  }

  function formatShortDate(isoDate) {
    const [, m, d] = isoDate.split('-').map(Number);
    return `${m}/${d}`;
  }

  function formatYen(n) {
    return `¥${n.toLocaleString('ja-JP')}`;
  }

  function formatCalAmount(n) {
    if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
    return n.toLocaleString('ja-JP');
  }

  function formatDayTitle(isoDate) {
    const [y, m, d] = isoDate.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return `${y}年${m}月${d}日（${DOW_KANJI[dt.getDay()]}）`;
  }

  function shiftDays(date, delta) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + delta);
    return d;
  }

  // ─── 自動入力 ──────────────────
  // 直近30日の手動データから1日合計平均を計算し、
  // 過去30日の空白日 (今日除く) に「必要」タグで自動入力する。
  // 起動時 / 手動エントリの追加・編集・削除のたびに再生成する。
  function regenerateAutoEntries() {
    const beforeLen = entries.length;
    // 既存の自動入力エントリを全削除して、毎回ゼロから再生成 (= 冪等)
    entries = entries.filter((e) => !e.auto);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dateRange = []; // 古い順 → 新しい順
    for (let i = AUTO_LOOKBACK_DAYS; i >= 1; i--) {
      dateRange.push(toISODate(shiftDays(today, -i)));
    }
    const rangeSet = new Set(dateRange);

    // 直近30日の手動エントリで日別合計を作る
    const dayTotals = {};
    for (const e of entries) {
      if (rangeSet.has(e.date)) {
        dayTotals[e.date] = (dayTotals[e.date] || 0) + e.amount;
      }
    }
    const recordedDays = Object.keys(dayTotals);

    if (recordedDays.length === 0) {
      // 直近30日に手動データがゼロなら、自動入力は何も足さない
      if (beforeLen !== entries.length) saveEntries();
      return;
    }

    const sum = Object.values(dayTotals).reduce((a, b) => a + b, 0);
    const rawAvg = sum / recordedDays.length;
    // 見やすい単位に丸め: ¥1000以上は¥100単位、それ未満は¥10単位
    const avg = rawAvg >= 1000
      ? Math.max(100, Math.round(rawAvg / 100) * 100)
      : Math.max(10, Math.round(rawAvg / 10) * 10);

    const recordedSet = new Set(recordedDays);
    let suffix = 0;
    for (const date of dateRange) {
      if (!recordedSet.has(date)) {
        entries.push({
          id: `auto-${date}-${Date.now()}-${suffix++}`,
          date,
          amount: avg,
          tag: 'necessary',
          auto: true,
        });
      }
    }

    saveEntries();
  }

  // ─── カレンダー描画 ──────────────────
  function renderCalendar() {
    monthLabelCal.textContent = `${viewMonth + 1}月`;
    calGrid.innerHTML = '';

    // 無料は全月ブラウズ不可 (矢印ロック) + 2週間より前の日はロック
    prevMonthCalBtn.classList.toggle('is-pro-locked', !isPremium);
    nextMonthCalBtn.classList.toggle('is-pro-locked', !isPremium);
    const cutoff = freeCutoffISO();

    const firstDow = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const todayISO = toISODate(new Date());

    // 月内エントリを日付ごとに集計
    const byDate = {};
    for (const e of entries) {
      if (isInMonth(e.date, viewYear, viewMonth)) {
        if (!byDate[e.date]) byDate[e.date] = [];
        byDate[e.date].push(e);
      }
    }

    const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;
    const mm = String(viewMonth + 1).padStart(2, '0');

    for (let i = 0; i < totalCells; i++) {
      const day = i - firstDow + 1;
      const cell = document.createElement('div');

      if (day < 1 || day > daysInMonth) {
        cell.className = 'cal-cell is-blank';
        calGrid.appendChild(cell);
        continue;
      }

      const dow = i % 7;
      const dateISO = `${viewYear}-${mm}-${String(day).padStart(2, '0')}`;
      const dayEntries = byDate[dateISO] || [];
      const total = dayEntries.reduce((s, x) => s + x.amount, 0);
      const allAuto = dayEntries.length > 0 && dayEntries.every((x) => x.auto);
      const isToday = dateISO === todayISO;
      const isFuture = dateISO > todayISO;

      const locked = !isPremium && dateISO < cutoff;

      cell.className = 'cal-cell';
      if (dow === 0) cell.classList.add('is-sun');
      if (dow === 6) cell.classList.add('is-sat');
      if (isToday) cell.classList.add('is-today');
      if (isFuture) cell.classList.add('is-future');
      if (allAuto) cell.classList.add('is-auto');
      if (locked) cell.classList.add('is-pro-locked');

      const dateEl = document.createElement('span');
      dateEl.className = 'cal-cell__date';
      dateEl.textContent = String(day);
      cell.appendChild(dateEl);

      if (total > 0) {
        const amountEl = document.createElement('span');
        amountEl.className = 'cal-cell__amount';
        amountEl.textContent = formatCalAmount(total);
        cell.appendChild(amountEl);

        if (allAuto) {
          const autoEl = document.createElement('span');
          autoEl.className = 'cal-cell__auto';
          autoEl.textContent = '自動';
          cell.appendChild(autoEl);
        }
      }

      cell.addEventListener('click', () => (locked ? promptPremium() : openDayModal(dateISO)));
      calGrid.appendChild(cell);
    }
  }

  // ─── 日付編集モーダル ──────────────────
  function openDayModal(date) {
    dayModalDate = date;
    dayModalTitle.textContent = formatDayTitle(date);
    dayAddAmount.value = '';
    renderDayList();
    dayModal.classList.add('is-open');
  }

  function closeDayModal() {
    dayModal.classList.remove('is-open');
    dayModalDate = null;
  }

  function renderDayList() {
    if (!dayModalDate) return;
    dayList.innerHTML = '';
    const dayEntries = entries
      .filter((e) => e.date === dayModalDate)
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const e of dayEntries) {
      dayList.appendChild(renderDayItem(e));
    }
    dayEmpty.style.display = dayEntries.length === 0 ? 'block' : 'none';
  }

  function renderDayItem(entry) {
    const li = document.createElement('li');
    li.className = 'day-list__item';
    if (entry.auto) li.classList.add('is-auto');

    // 金額
    const amountWrap = document.createElement('div');
    amountWrap.className = 'day-list__amount-wrap';
    const yen = document.createElement('span');
    yen.className = 'day-list__yen';
    yen.textContent = '¥';
    const amountInput = document.createElement('input');
    amountInput.type = 'number';
    amountInput.inputMode = 'numeric';
    amountInput.min = '0';
    amountInput.step = '100';
    amountInput.className = 'day-list__amount';
    amountInput.value = String(entry.amount);
    amountInput.addEventListener('change', () => {
      const v = parseInt(amountInput.value, 10);
      if (Number.isFinite(v) && v > 0) {
        updateEntry(entry.id, { amount: v });
      } else {
        amountInput.value = String(entry.amount);
      }
    });
    amountWrap.append(yen, amountInput);
    li.appendChild(amountWrap);

    // タグ (3つのセグメント)
    const tagGroup = document.createElement('div');
    tagGroup.className = 'day-list__tags';
    for (const tag of ['necessary', 'enjoy', 'waste']) {
      const tagBtn = document.createElement('button');
      tagBtn.type = 'button';
      tagBtn.className = `day-list__tag day-list__tag--${tag}`;
      if (entry.tag === tag) tagBtn.classList.add('is-active');
      tagBtn.textContent = TAGS[tag];
      tagBtn.addEventListener('click', () => {
        if (entry.tag === tag && !entry.auto) return; // 既に同じタグで手動なら何もしない
        updateEntry(entry.id, { tag });
      });
      tagGroup.appendChild(tagBtn);
    }
    li.appendChild(tagGroup);

    if (entry.auto) {
      const badge = document.createElement('span');
      badge.className = 'day-list__auto';
      badge.textContent = '自動';
      li.appendChild(badge);
    }

    // 削除
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'day-list__delete';
    delBtn.setAttribute('aria-label', '削除');
    delBtn.textContent = '×';
    delBtn.addEventListener('click', () => deleteEntryFromModal(entry.id));
    li.appendChild(delBtn);

    return li;
  }

  function updateEntry(id, patch) {
    const idx = entries.findIndex((e) => e.id === id);
    if (idx < 0) return;
    // 編集された時点で「自動」フラグは外す (= 手動扱いに昇格)
    entries[idx] = { ...entries[idx], ...patch, auto: false };
    saveEntries();
    regenerateAutoEntries();
    render();
    renderDayList();
  }

  function deleteEntryFromModal(id) {
    const idx = entries.findIndex((e) => e.id === id);
    if (idx < 0) return;
    const removed = entries[idx];
    if (removed.auto) {
      // 削除しても再生成されるので、金額やタグを直してもらう
      showToast('金額を直すと自動が外れるよ', 1800);
      return;
    }
    entries.splice(idx, 1);
    saveEntries();
    regenerateAutoEntries();
    render();
    renderDayList();
  }

  function handleDayAdd(tag) {
    if (!dayModalDate) return;
    const v = parseInt(dayAddAmount.value, 10);
    if (!(Number.isFinite(v) && v > 0)) {
      showToast('金額を入れて');
      return;
    }
    saveEntry({ tag, amount: v, date: dayModalDate });
    regenerateAutoEntries();
    dayAddAmount.value = '';
    render();
    renderDayList();
    showToast('書いた！');
  }

  // ─── パスワード ──────────────────
  async function hashPasscode(code) {
    const enc = new TextEncoder();
    const data = enc.encode(PASS_SALT + code);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function getStoredHash() {
    return localStorage.getItem(PASS_KEY) || null;
  }

  function setStoredHash(hash) {
    localStorage.setItem(PASS_KEY, hash);
  }

  function clearStoredHash() {
    localStorage.removeItem(PASS_KEY);
  }

  function initLock() {
    refreshPasswordSection();
    if (getStoredHash()) {
      // インラインscriptが is-locked を付けている。ここでロック画面の状態を初期化。
      showLock({
        mode: 'unlock',
        title: 'パスワード',
        hint: '',
        allowCancel: false,
      });
    }
  }

  function showLock(opts) {
    const { mode, title, hint, allowCancel } = opts;
    lockMode = mode;
    lockBuffer = '';
    lockSetupTemp = '';
    lockTitle.textContent = title || 'パスワード';
    lockHint.textContent = hint || '';
    lockCancel.hidden = !allowCancel;
    lockForgot.hidden = mode !== 'unlock';
    updateLockDots();
    if (!document.documentElement.classList.contains('is-locked')) {
      lockScreen.classList.add('is-show');
    }
  }

  function hideLock() {
    lockScreen.classList.remove('is-show');
    document.documentElement.classList.remove('is-locked');
    lockMode = null;
    lockBuffer = '';
    lockSetupTemp = '';
  }

  function updateLockDots() {
    const dots = lockDots.children;
    for (let i = 0; i < PASS_LENGTH; i++) {
      dots[i].classList.toggle('is-filled', i < lockBuffer.length);
    }
  }

  function shakeLock() {
    lockDots.classList.remove('is-shake');
    void lockDots.offsetWidth;
    lockDots.classList.add('is-shake');
    setTimeout(() => lockDots.classList.remove('is-shake'), 350);
  }

  async function submitLock() {
    if (lockBuffer.length !== PASS_LENGTH) return;
    const inputHash = await hashPasscode(lockBuffer);

    if (lockMode === 'unlock') {
      if (inputHash === getStoredHash()) {
        hideLock();
      } else {
        lockBuffer = '';
        shakeLock();
        updateLockDots();
      }
      return;
    }

    if (lockMode === 'set-1' || lockMode === 'change-1') {
      lockSetupTemp = lockBuffer;
      lockBuffer = '';
      lockMode = lockMode === 'set-1' ? 'set-2' : 'change-2';
      lockTitle.textContent = 'もう一度';
      lockHint.textContent = '同じ数字をもう一度';
      updateLockDots();
      return;
    }

    if (lockMode === 'set-2' || lockMode === 'change-2') {
      if (lockBuffer === lockSetupTemp) {
        const newHash = await hashPasscode(lockBuffer);
        setStoredHash(newHash);
        const wasNew = lockMode === 'set-2';
        hideLock();
        showToast(wasNew ? 'パスワードを設定したよ' : 'パスワードを変えたよ');
        refreshPasswordSection();
      } else {
        lockBuffer = '';
        lockSetupTemp = '';
        lockMode = lockMode === 'set-2' ? 'set-1' : 'change-1';
        lockTitle.textContent = lockMode === 'set-1' ? 'パスワードを決める' : '新しいパスワード';
        lockHint.textContent = '一致しなかった、もう一度';
        shakeLock();
        updateLockDots();
      }
      return;
    }

    if (lockMode === 'change-current') {
      if (inputHash === getStoredHash()) {
        lockBuffer = '';
        lockMode = 'change-1';
        lockTitle.textContent = '新しいパスワード';
        lockHint.textContent = '4桁の数字';
        updateLockDots();
      } else {
        lockBuffer = '';
        shakeLock();
        updateLockDots();
      }
      return;
    }

    if (lockMode === 'remove-confirm') {
      if (inputHash === getStoredHash()) {
        clearStoredHash();
        hideLock();
        showToast('パスワードを解除したよ');
        refreshPasswordSection();
      } else {
        lockBuffer = '';
        shakeLock();
        updateLockDots();
      }
      return;
    }
  }

  function cancelLockFlow() {
    hideLock();
  }

  function startSetPassword() {
    closeHelp();
    showLock({
      mode: 'set-1',
      title: 'パスワードを決める',
      hint: '4桁の数字',
      allowCancel: true,
    });
  }

  function startChangePassword() {
    closeHelp();
    showLock({
      mode: 'change-current',
      title: '今のパスワード',
      hint: '',
      allowCancel: true,
    });
  }

  function startRemovePassword() {
    closeHelp();
    showLock({
      mode: 'remove-confirm',
      title: 'パスワードを解除',
      hint: '今のパスワードを入れて',
      allowCancel: true,
    });
  }

  function refreshPasswordSection() {
    const has = !!getStoredHash();
    passwordStatus.textContent = has ? '設定中' : '設定なし';
    pwSetBtn.hidden = has;
    pwChangeBtn.hidden = !has;
    pwRemoveBtn.hidden = !has;
  }

  function handleForgot() {
    if (
      confirm(
        'パスワードを忘れた場合、すべての記録と上限・パスワードを消してリセットします。本当によいですか？'
      )
    ) {
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(LIMITS_KEY);
        localStorage.removeItem(PASS_KEY);
      } catch (e) {}
      location.reload();
    }
  }

  // ─── バナー広告 (AdMob / Webプレースホルダ) ──────────────────
  function isNativeApp() {
    const cap = window.Capacitor;
    return Boolean(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
  }

  function showWebAdPlaceholders() {
    document.querySelectorAll('.ad-banner').forEach((el) => el.classList.add('is-placeholder'));
  }

  function setNativeAdInsets(bannerHeight) {
    const footnote = document.querySelector('.footnote');
    const footnoteHeight = footnote ? Math.ceil(footnote.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty('--native-ad-height', `${bannerHeight}px`);
    document.documentElement.style.setProperty('--footnote-height', `${footnoteHeight}px`);
  }

  // 診断用: 画面上部に状態を表示するバー
  function adDiag(msg) {
    if (!ADMOB_CONFIG.debug) return;
    let d = document.getElementById('addiag');
    if (!d) {
      d = document.createElement('div');
      d.id = 'addiag';
      d.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#2b3a55;color:#fff;font-size:11px;line-height:1.4;padding:3px 6px;text-align:center;';
      document.body.appendChild(d);
    }
    d.textContent = msg;
  }

  async function initNativeAdMob() {
    const cap = window.Capacitor;
    // このランタイムでは registerPlugin が無い場合があるため、
    // 登録済みプラグインは window.Capacitor.Plugins から取得する
    const AdMob =
      (cap && cap.Plugins && cap.Plugins.AdMob) ||
      (cap && typeof cap.registerPlugin === 'function' ? cap.registerPlugin('AdMob') : null);

    if (!AdMob) {
      adDiag('[AD] AdMobプラグイン取得失敗');
      showWebAdPlaceholders();
      return;
    }

    nativeAdMob = AdMob;
    document.documentElement.classList.add('is-native-ad');

    try {
      adDiag('[AD] calling initialize');
      // iOS: requestTrackingAuthorization=true で ATT ダイアログを表示（Androidでは無視される）。
      await AdMob.initialize({ requestTrackingAuthorization: true });

      try {
        const consentInfo = await AdMob.requestConsentInfo();
        if (consentInfo?.isConsentFormAvailable && consentInfo?.status === 'REQUIRED') {
          await AdMob.showConsentForm();
        }
      } catch (e) {
        // UMP 未設定でも広告表示は続行
      }

      AdMob.addListener('bannerAdSizeChanged', (size) => {
        setNativeAdInsets(size?.height ?? 50);
        adDiag(`[AD] size h=${size?.height}`);
      });
      AdMob.addListener('bannerAdLoaded', () => adDiag('[AD] loaded OK'));

      // 診断用: 広告の読込失敗(no-fill 等)を捕捉
      AdMob.addListener('bannerAdFailedToLoad', (err) => {
        adDiag(`[AD] failLoad code=${err?.code ?? '?'} ${err?.message ?? ''}`);
      });
      adDiag('[AD] init ok, calling showBanner');

      // 現在のタブに対応したバナーを表示 (以後はタブ切替で貼り替え)
      setNativeAdInsets(50);
      await showBannerForPane(activePane);

      adDiag('[AD] showBanner resolved (waiting fill)');
    } catch (e) {
      adDiag(`[AD] 失敗: ${e?.message ?? e}`);
      document.documentElement.classList.remove('is-native-ad');
      nativeAdMob = null;
      showWebAdPlaceholders();
    }
  }

  // タブに応じてバナー広告を貼り替える。
  // IDを変えるには一度バナーを消して再表示する必要がある。
  async function showBannerForPane(idx) {
    if (!nativeAdMob) return; // 初期化前 / Web は何もしない
    // プレミアム購入者は広告なし。購入後にタブを切り替えても再表示しない。
    if (IAP_ENABLED && isPremium) { try { await nativeAdMob.removeBanner(); } catch (e) {} return; }
    if (idx === currentBannerPane) return; // 同じタブなら貼り替え不要
    if (bannerBusy) { pendingBannerPane = idx; return; } // 連続スワイプは最後だけ反映

    bannerBusy = true;
    currentBannerPane = idx;
    const cap = window.Capacitor;
    const pf = cap && typeof cap.getPlatform === 'function' ? cap.getPlatform() : '';
    const ids = pf === 'ios' ? ADMOB_CONFIG.bannerIdsIos : ADMOB_CONFIG.bannerIdsAndroid;
    const adId = ADMOB_CONFIG.useTestAd
      ? ADMOB_CONFIG.testBannerId
      : (ids[idx] || ids[0]);

    try {
      // 既存バナーがあれば貼り替えのため一度消す (初回は何も無くてOK)
      try { await nativeAdMob.removeBanner(); } catch (e) { /* 初回は無視 */ }
      await nativeAdMob.showBanner({
        adId,
        adSize: 'ADAPTIVE_BANNER',
        position: 'BOTTOM_CENTER',
        // 底に密着させる。持ち上げると本文最下部(タグ)に被るため margin は 0
        margin: 0,
        isTesting: ADMOB_CONFIG.useTestAd,
      });
      adDiag(`[AD] pane=${idx} ${adId.slice(-6)}`);
    } catch (e) {
      adDiag(`[AD] switch失敗: ${e?.message ?? e}`);
    } finally {
      bannerBusy = false;
      // 処理中に別タブへ移っていたら、最新の状態に追従する
      if (pendingBannerPane !== null && pendingBannerPane !== currentBannerPane) {
        const next = pendingBannerPane;
        pendingBannerPane = null;
        showBannerForPane(next);
      } else {
        pendingBannerPane = null;
      }
    }
  }

  function initAds() {
    const cap = window.Capacitor;
    const platform = cap && typeof cap.getPlatform === 'function' ? cap.getPlatform() : 'web';
    adDiag(`[AD] initAds cap=${!!cap} native=${!!(cap && cap.isNativePlatform && cap.isNativePlatform())} platform=${platform}`);
    if (isNativeApp()) {
      // Android / iOS どちらもバナー広告を表示する。
      // iOSは Info.plist の GADApplicationIdentifier / SKAdNetworkItems /
      // NSUserTrackingUsageDescription と ATT リクエストが前提（対応済み）。
      // プレミアム購入者は広告なし。課金OFF時は誰も購入者でないので広告は出す。
      if ((platform === 'android' || platform === 'ios') && !(IAP_ENABLED && isPremium)) {
        initNativeAdMob();
      }
      return;
    }
    showWebAdPlaceholders();
  }

  // ─── プレミアム / 課金 ──────────────────
  function loadPremium() {
    try { return localStorage.getItem(PREMIUM_KEY) === '1'; } catch { return false; }
  }

  function setPremium(on) {
    const next = !!on;
    const changed = next !== isPremium;
    isPremium = next;
    try { localStorage.setItem(PREMIUM_KEY, next ? '1' : '0'); } catch (e) {}
    if (next && nativeAdMob) { try { nativeAdMob.removeBanner(); } catch (e) {} } // 購入で広告を消す(Android/iOS)
    refreshPremiumUI();
    render();
    if (changed && next) showToast('プレミアムを解放したよ！', 2200);
  }

  function freeCutoffISO() {
    return toISODate(shiftDays(new Date(), -FREE_LOOKBACK_DAYS));
  }

  function sumByTag(list) {
    const s = { necessary: 0, enjoy: 0, waste: 0 };
    for (const e of list) if (s[e.tag] !== undefined) s[e.tag] += e.amount;
    return s;
  }

  // 無料操作がロックに当たったら、レポート(=ペイウォール)へ誘導
  function promptPremium() {
    if (isPremium) return;
    setActivePane(3, true);
  }

  function refreshPremiumUI() {
    proLock.hidden = isPremium;
    reportBody.classList.toggle('is-pro-blur', !isPremium);
    if (premiumStatus) premiumStatus.textContent = isPremium ? '購入済み' : '未購入';
    if (premiumBuyBtn) premiumBuyBtn.hidden = isPremium;
    if (premiumRestoreBtn) premiumRestoreBtn.hidden = isPremium;
    if (recordProCta) recordProCta.hidden = isPremium;
  }

  function setBillingBusy(busy, msg) {
    billingBusy = busy;
    [proBuyBtn, premiumBuyBtn, proRestoreBtn, premiumRestoreBtn].forEach((b) => { if (b) b.disabled = busy; });
    if (proStatus) {
      if (busy || msg) { proStatus.hidden = false; proStatus.textContent = msg || '処理中…'; }
      else { proStatus.hidden = true; proStatus.textContent = ''; }
    }
  }

  // cordova-plugin-purchase (v13, グローバル CdvPurchase) をラップ。
  // 課金は「注文 → approved → verified」まで反映にタイムラグがあるためイベント駆動で扱う。
  const Billing = (() => {
    let store = null;
    let ErrorCode = null;   // cdv.ErrorCode（キャンセル判定に使用）
    let pending = false;    // 購入注文を出して結果待ちか
    let watchdog = null;    // 応答が来ない時のフォールバック用タイマー
    let wantsPurchase = false; // 商品未ロード中に購入を押された→ロード完了で自動発注する意思

    // 購入完了は approved→verified の「イベント」で確定する。order() の戻り値や
    // 一時的な store.error では確定させない（タイムラグで後から通ることがあるため）。
    const WATCHDOG_MS = 45000;

    function clearWatchdog() { if (watchdog) { clearTimeout(watchdog); watchdog = null; } }
    function startWatchdog() {
      clearWatchdog();
      watchdog = setTimeout(() => {
        watchdog = null;
        if (!pending) return;
        // まだ確定していない。失敗とは断定せず、待てば反映される旨だけ伝えて操作可能に戻す。
        pending = false;
        wantsPurchase = false;
        setBillingBusy(false, '通信に時間がかかっています。購入が完了すると自動で反映されます');
      }, WATCHDOG_MS);
    }
    function settle(msg) { clearWatchdog(); pending = false; wantsPurchase = false; setBillingBusy(false, msg); }
    function unlock() { clearWatchdog(); pending = false; wantsPurchase = false; setPremium(true); setBillingBusy(false); }
    function isCancel(err) {
      return !!(err && ErrorCode != null && err.code === ErrorCode.PAYMENT_CANCELLED);
    }

    // v13: 商品→オファーを取得（未ロード時は null）。
    function getOffer() {
      if (!store || typeof store.get !== 'function') return null;
      const product = store.get(PREMIUM_PRODUCT_ID);
      if (!product) return null;
      return (product.getOffer ? product.getOffer() : (product.offers && product.offers[0])) || null;
    }
    function placeOrder(offer) {
      // order() は例外でなく IError を「解決値」で返す。キャンセルのみ即終了。
      // その他のエラーは失敗と断定しない（approved/verified が後から来ることがある）。
      Promise.resolve(offer.order())
        .then((err) => { if (isCancel(err)) settle('購入をキャンセルしました'); })
        .catch(() => { /* 例外時も即失敗にしない。watchdog に委ねる */ });
    }
    // 商品ロード前に購入を押された場合、ロード完了イベントでここが呼ばれ自動発注する。
    function flushPendingOrder() {
      if (!wantsPurchase) return;
      const offer = getOffer();
      if (offer && typeof offer.order === 'function') {
        wantsPurchase = false;
        placeOrder(offer);
      }
    }

    function syncOwned() {
      if (!store) return;
      let owned = false;
      try {
        // v13: Product.owned ゲッターが最も確実。store.owned は文字列でなく {id} を取る。
        const p = typeof store.get === 'function' ? store.get(PREMIUM_PRODUCT_ID) : null;
        if (p && typeof p.owned === 'boolean') owned = p.owned;
        else if (typeof store.owned === 'function') owned = store.owned({ id: PREMIUM_PRODUCT_ID });
      } catch (e) { owned = false; }
      if (owned && !isPremium) unlock();
    }

    function init() {
      const cdv = window.CdvPurchase;
      if (!cdv || !cdv.store) return; // Web/未導入は localStorage キャッシュのまま
      store = cdv.store;
      try {
        const { ProductType, Platform, LogLevel } = cdv;
        ErrorCode = cdv.ErrorCode || null;
        if (LogLevel) store.verbosity = LogLevel.WARNING;

        // 動作中のプラットフォームだけを初期化する（iOSでGooglePlayアダプタを初期化すると
        // 初期化エラーがペイウォールに出てしまうため）。判定不能時は両方にフォールバック。
        const cap = window.Capacitor;
        const pf = cap && typeof cap.getPlatform === 'function' ? cap.getPlatform() : '';
        let platforms;
        if (pf === 'ios') platforms = [Platform.APPLE_APPSTORE];
        else if (pf === 'android') platforms = [Platform.GOOGLE_PLAY];
        else platforms = [Platform.APPLE_APPSTORE, Platform.GOOGLE_PLAY];

        store.register(platforms.map((platform) => (
          { id: PREMIUM_PRODUCT_ID, type: ProductType.NON_CONSUMABLE, platform }
        )));

        store.when()
          // verify() が失敗しても解放しない。以前はここで unlock() していたため
          // 「検証できない = 解放」になっていた（validator 未設定なので事実上の常時解放）。
          // 解放は verified イベントか、レシート由来の owned 判定 (syncOwned) のみに任せる。
          .approved((t) => { try { t.verify(); } catch (e) { try { t.finish(); } catch (e2) {} } })
          .verified((r) => { try { r.finish(); } catch (e) {} unlock(); })
          .productUpdated(() => { syncOwned(); flushPendingOrder(); })
          .receiptUpdated(() => syncOwned());

        if (typeof store.error === 'function') {
          store.error((err) => {
            // キャンセルだけは即座に反映。それ以外の（初期化時・一時的な）エラーは
            // UIに出さない — approved/verified か watchdog に確定を委ねる。
            if (isCancel(err)) { settle('購入をキャンセルしました'); }
          });
        }

        if (typeof store.ready === 'function') store.ready(() => { syncOwned(); flushPendingOrder(); });
        store.initialize(platforms);
      } catch (e) { /* SDK差異は無視してキャッシュ状態で継続 */ }
    }

    function purchase() {
      if (!store) { showToast('アプリ内で購入できます（準備中）', 2200); return; }
      if (billingBusy) return;
      setBillingBusy(true, '処理中…（ストアの応答を待っています）');
      pending = true;
      startWatchdog();
      try {
        // v13: 購入は Offer.order()。store.order は Offer を取る（商品IDの文字列では動かない）。
        const offer = getOffer();
        if (offer && typeof offer.order === 'function') {
          placeOrder(offer);
        } else {
          // 商品がまだ読み込めていない（初期化直後にタップされた等）。
          // ここで「失敗」にすると審査員が早押ししただけで購入不可に見える → 2.1b。
          // 失敗にせず購入意思を保持し、productUpdated/ready で自動発注する（watchdog が安全網）。
          wantsPurchase = true;
          setBillingBusy(true, '処理中…（商品を確認しています）');
          if (typeof store.update === 'function') { try { store.update(); } catch (e) {} }
        }
      } catch (e) { settle('購入を開始できませんでした'); }
    }

    function restore() {
      if (!store) { showToast('アプリ内で復元できます', 2000); return; }
      if (billingBusy) return;
      setBillingBusy(true, '復元中…');
      try {
        Promise.resolve(store.restorePurchases())
          .then(() => { syncOwned(); setBillingBusy(false, isPremium ? '' : '購入は見つかりませんでした'); })
          .catch(() => setBillingBusy(false, '復元に失敗しました'));
      } catch (e) { setBillingBusy(false, '復元に失敗しました'); }
    }

    return { init, purchase, restore };
  })();

  // 課金の初期化 (Billing 定義後に実行)。ストア照会は非同期でタイムラグあり、
  // 所有が判明した時点で setPremium(true) → 再描画される。
  Billing.init();

  // Web/PWA (課金の無い環境) 専用の動作確認トグル: 設定「プレミアム」の状態表示を5回タップ
  function enableDevPremiumToggle() {
    if (!premiumStatus) return;
    let taps = 0, timer = null;
    premiumStatus.addEventListener('click', () => {
      taps++;
      clearTimeout(timer);
      timer = setTimeout(() => { taps = 0; }, 1200);
      if (taps >= 5) { taps = 0; setPremium(!isPremium); showToast(`(dev) premium=${isPremium}`, 1400); }
    });
  }

  // ─── レポート描画 ──────────────────
  function renderReport() {
    drawTrendChart();
    renderBreakdown();
    renderReportStats();
  }

  function drawTrendChart() {
    const canvas = trendChart;
    if (!canvas || !canvas.getContext) return;
    const cssW = canvas.clientWidth || 300;
    const cssH = canvas.clientHeight || 168;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const base = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const s = getMonthSums(d.getFullYear(), d.getMonth());
      months.push({ label: `${d.getMonth() + 1}月`, s, total: s.necessary + s.enjoy + s.waste });
    }
    const maxTotal = Math.max(1, ...months.map((x) => x.total));

    const padL = 6, padR = 6, padTop = 12, padBottom = 20;
    const plotW = cssW - padL - padR;
    const plotH = cssH - padTop - padBottom;
    const slot = plotW / months.length;
    const barW = Math.min(36, slot * 0.56);
    const baseY = padTop + plotH;
    const colors = { necessary: '#4a7fb5', enjoy: '#e89b4a', waste: '#8c8c8c' };

    ctx.textAlign = 'center';
    ctx.font = '11px sans-serif';

    months.forEach((mo, i) => {
      const cx = padL + slot * i + slot / 2;
      const h = (mo.total / maxTotal) * plotH;
      let acc = 0;
      for (const tag of ['necessary', 'enjoy', 'waste']) {
        const seg = mo.total ? (mo.s[tag] / mo.total) * h : 0;
        if (seg > 0.5) {
          ctx.fillStyle = colors[tag];
          ctx.fillRect(cx - barW / 2, baseY - acc - seg, barW, seg);
          acc += seg;
        }
      }
      ctx.fillStyle = '#8c8c8c';
      ctx.fillText(mo.label, cx, cssH - 6);
    });
  }

  function renderBreakdown() {
    const now = new Date();
    const s = getMonthSums(now.getFullYear(), now.getMonth());
    const total = s.necessary + s.enjoy + s.waste;
    reportBreakdown.innerHTML = '';
    for (const tag of ['necessary', 'enjoy', 'waste']) {
      const val = s[tag];
      const pct = total ? Math.round((val / total) * 100) : 0;
      const li = document.createElement('li');
      li.className = 'report__brk';
      const label = document.createElement('span');
      label.className = `report__brk-label report__brk-label--${tag}`;
      label.textContent = TAGS[tag];
      const track = document.createElement('span');
      track.className = 'report__brk-track';
      const fill = document.createElement('span');
      fill.className = `report__brk-fill report__brk-fill--${tag}`;
      fill.style.width = `${pct}%`;
      track.appendChild(fill);
      const valEl = document.createElement('span');
      valEl.className = 'report__brk-val';
      valEl.textContent = `${formatYen(val)}・${pct}%`;
      li.append(label, track, valEl);
      reportBreakdown.appendChild(li);
    }
  }

  function renderReportStats() {
    const manual = entries.filter((e) => !e.auto);
    const total = manual.reduce((s, e) => s + e.amount, 0);
    let oldest = null;
    for (const e of manual) if (!oldest || e.date < oldest) oldest = e.date;
    let monthsCount = 1;
    if (oldest) {
      const [oy, om] = oldest.split('-').map(Number);
      const now = new Date();
      monthsCount = Math.max(1, (now.getFullYear() - oy) * 12 + (now.getMonth() + 1 - om) + 1);
    }
    const avg = Math.round(total / monthsCount);
    const byTag = sumByTag(manual);
    const topTag = ['necessary', 'enjoy', 'waste'].reduce((a, b) => (byTag[b] > byTag[a] ? b : a), 'necessary');
    const days = new Set(manual.map((e) => e.date)).size;

    const stats = [
      ['ぜんぶの合計', formatYen(total)],
      ['1ヶ月の平均', formatYen(avg)],
      ['いちばん多い', total > 0 ? TAGS[topTag] : '—'],
      ['記録した日数', `${days}日`],
    ];
    reportStats.innerHTML = '';
    for (const [label, val] of stats) {
      const li = document.createElement('li');
      li.className = 'report__stat';
      const l = document.createElement('span');
      l.className = 'report__stat-label';
      l.textContent = label;
      const v = document.createElement('span');
      v.className = 'report__stat-val';
      v.textContent = val;
      li.append(l, v);
      reportStats.appendChild(li);
    }
  }

  // ─── Service Worker ──────────────────
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
