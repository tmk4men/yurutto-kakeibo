(() => {
  'use strict';

  const STORAGE_KEY = 'kakeibo.entries';
  const GRAIN_KEY = 'kakeibo.grainMode'; // 'coarse' | 'fine'
  const LIMITS_KEY = 'kakeibo.limits';   // {necessary?: number, enjoy?: number, waste?: number}
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
  const COARSE_CHIPS = [100, 500, 1000, 3000, 5000];
  const FINE_CHIPS = [10, 50, 100, 500, 1000];
  const AMOUNT_CAP = 9999999;

  // ─── 状態 ──────────────────
  let entries = loadEntries();
  let amountHistory = []; // 加算チップの履歴
  let viewYear, viewMonth;
  let grainMode = localStorage.getItem(GRAIN_KEY) === 'fine' ? 'fine' : 'coarse';
  let limits = loadLimits(); // {necessary, enjoy, waste} — null/undefined は未設定
  let activePane = 0; // 0=書く, 1=きろく

  // ─── DOM ──────────────────
  const dateInput = document.getElementById('dateInput');
  const amountDisplay = document.getElementById('amountDisplay');
  const numpadEl = document.getElementById('numpad');
  const grainToggle = document.getElementById('grainToggle');
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
  const hintPopEl = document.getElementById('hintPop');

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
  registerServiceWorker();

  // ─── イベントバインド ──────────────────
  function bindEvents() {
    // テンキー (チップ加算 + ⌫)
    numpadEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.key');
      if (!btn) return;
      if (btn.classList.contains('key--back')) {
        amountHistory.pop();
      } else {
        const add = parseInt(btn.dataset.add, 10);
        if (!(add > 0)) return;
        if (currentAmount() + add > AMOUNT_CAP) return;
        amountHistory.push(add);
      }
      updateAmountDisplay();
    });

    // 刻み切替
    grainToggle.addEventListener('click', () => {
      grainMode = grainMode === 'coarse' ? 'fine' : 'coarse';
      grainToggle.setAttribute('aria-pressed', grainMode === 'fine' ? 'true' : 'false');
      localStorage.setItem(GRAIN_KEY, grainMode);
      renderNumpad();
    });
    grainToggle.setAttribute('aria-pressed', grainMode === 'fine' ? 'true' : 'false');

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
    amountHistory = [];
    dateInput.value = toISODate(new Date());
    updateAmountDisplay();
  }

  // ─── テンキー描画 ──────────────────
  function renderNumpad() {
    const chips = grainMode === 'fine' ? FINE_CHIPS : COARSE_CHIPS;
    numpadEl.innerHTML = '';
    for (const v of chips) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'key key--add';
      btn.dataset.add = String(v);
      btn.textContent = `+${v}`;
      numpadEl.appendChild(btn);
    }
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'key key--back';
    back.setAttribute('aria-label', '一個戻す');
    back.textContent = '⌫';
    numpadEl.appendChild(back);
  }

  // ─── 金額表示 ──────────────────
  function currentAmount() {
    return amountHistory.reduce((a, b) => a + b, 0);
  }

  function updateAmountDisplay() {
    const n = currentAmount();
    amountDisplay.textContent = n === 0 ? '0' : n.toLocaleString('ja-JP');
    amountDisplay.classList.toggle('is-empty', n === 0);
  }

  // ─── トースト ──────────────────
  let toastTimer = null;
  function showToast(msg, ms = 1400, variant = '') {
    toastEl.textContent = msg;
    toastEl.className = 'toast is-show' + (variant ? ` toast--${variant}` : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('is-show');
    }, ms);
  }

  // ─── ヒントポップ ──────────────────
  let hintHideTimer = null;
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

  // ─── 削除 ──────────────────
  function handleDelete(id) {
    entries = entries.filter((e) => e.id !== id);
    saveEntries();
    render();
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
    delBtn.addEventListener('click', () => {
      if (confirm('この記録を消しますか？')) handleDelete(e.id);
    });

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

  // ─── Service Worker ──────────────────
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
