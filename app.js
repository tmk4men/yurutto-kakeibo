(() => {
  'use strict';

  const STORAGE_KEY = 'kakeibo.entries';
  const LIMITS_KEY = 'kakeibo.limits';   // {necessary?: number, enjoy?: number, waste?: number}
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

  // ─── 状態 ──────────────────
  let entries = loadEntries();
  let amountDigits = ''; // 入力された数字を文字列で保持
  let viewYear, viewMonth;
  let limits = loadLimits(); // {necessary, enjoy, waste} — null/undefined は未設定
  let activePane = 0; // 0=書く, 1=きろく
  let toastTimer = null;
  let toastActionHandler = null;
  let hintHideTimer = null;
  let lockMode = null;        // 'unlock' | 'set-1' | 'set-2' | 'change-current' | 'change-1' | 'change-2' | 'remove-confirm'
  let lockBuffer = '';
  let lockSetupTemp = '';
  let lockOnSuccess = null;

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
  render();
  initLock();
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

    // 月ナビ
    prevMonthBtn.addEventListener('click', () => {
      ({ year: viewYear, month: viewMonth } = prevMonth(viewYear, viewMonth));
      render();
    });
    nextMonthBtn.addEventListener('click', () => {
      ({ year: viewYear, month: viewMonth } = nextMonth(viewYear, viewMonth));
      render();
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
    panesEl.style.transform = `translateX(-${50 * idx}%)`;
    tabButtons.forEach((t, i) => {
      const active = i === idx;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (idx === 1) hideHint();
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
        if ((activePane === 0 && dx > 0) || (activePane === 1 && dx < 0)) {
          limited = dx * 0.3;
        }
        const offsetPct = -50 * activePane + (limited / vw) * 50;
        panesEl.style.transform = `translateX(${offsetPct}%)`;
      }
    }, { passive: false });

    const finish = () => {
      if (!dragging) return;
      dragging = false;
      if (direction === 'h') {
        const vw = paneViewport.clientWidth || 1;
        const ratio = dx / vw;
        if (ratio < -0.18 && activePane === 0) {
          setActivePane(1, true);
        } else if (ratio > 0.18 && activePane === 1) {
          setActivePane(0, true);
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
    entries.splice(idx, 1);
    saveEntries();
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
          render();
          hideToast();
        },
      },
    });
  }

  // ─── 描画 (きろく) ──────────────────
  function render() {
    monthLabel.textContent = `${viewMonth + 1}月の記録`;

    const sums = getMonthSums(viewYear, viewMonth);
    const prev = prevMonth(viewYear, viewMonth);
    const prevSums = getMonthSums(prev.year, prev.month);

    sumNecessary.textContent = formatYen(sums.necessary);
    sumEnjoy.textContent = formatYen(sums.enjoy);
    sumWaste.textContent = formatYen(sums.waste);
    sumTotal.textContent = formatYen(sums.necessary + sums.enjoy + sums.waste);

    setDiff(diffNecessary, sums.necessary, prevSums.necessary);
    setDiff(diffEnjoy, sums.enjoy, prevSums.enjoy);
    setDiff(diffWaste, sums.waste, prevSums.waste);

    setLimitState('necessary', sums.necessary);
    setLimitState('enjoy', sums.enjoy);
    setLimitState('waste', sums.waste);

    renderRatioBar(sums);
    renderStatusBubble(sums);

    const monthly = entries
      .filter((e) => isInMonth(e.date, viewYear, viewMonth))
      .sort((a, b) => (a.date === b.date ? b.id.localeCompare(a.id) : b.date.localeCompare(a.date)));

    entryList.innerHTML = '';
    if (monthly.length === 0) {
      emptyMsg.classList.remove('is-hidden');
      entryList.classList.add('is-hidden');
      return;
    }
    emptyMsg.classList.add('is-hidden');
    entryList.classList.remove('is-hidden');

    for (const e of monthly) {
      entryList.appendChild(renderEntry(e));
    }
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

    const dateSpan = document.createElement('span');
    dateSpan.className = 'entry-date';
    dateSpan.textContent = formatShortDate(e.date);

    const amountSpan = document.createElement('span');
    amountSpan.className = 'entry-amount';
    amountSpan.textContent = formatYen(e.amount);

    const tagSpan = document.createElement('span');
    tagSpan.className = `entry-tag entry-tag--${e.tag}`;
    tagSpan.textContent = TAGS[e.tag];

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'entry-delete';
    delBtn.setAttribute('aria-label', '削除');
    delBtn.textContent = '×';
    delBtn.addEventListener('click', () => handleDelete(e.id));

    li.append(dateSpan, amountSpan, tagSpan, delBtn);
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

  // ─── Service Worker ──────────────────
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
