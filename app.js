(() => {
  'use strict';

  const STORAGE_KEY = 'kakeibo.entries';
  const TAGS = {
    necessary: '必要',
    enjoy: '楽しみ',
    waste: 'ムダかも',
  };

  // ─── 状態 ─────────────────────────
  let entries = loadEntries();
  let selectedTag = null;
  let amountHistory = []; // 加算したチップの履歴 (例: [100, 500, 100])
  const AMOUNT_CAP = 9999999;
  let viewYear, viewMonth; // viewMonth は 0-11

  // ─── DOM ─────────────────────────
  const dateInput = document.getElementById('dateInput');
  const amountDisplay = document.getElementById('amountDisplay');
  const numpad = document.querySelector('.numpad');
  const backspaceBtn = document.getElementById('backspaceBtn');
  const tagButtons = document.querySelectorAll('.tag');
  const saveBtn = document.getElementById('saveBtn');
  const monthLabel = document.getElementById('monthLabel');
  const prevMonthBtn = document.getElementById('prevMonth');
  const nextMonthBtn = document.getElementById('nextMonth');
  const sumNecessary = document.getElementById('sumNecessary');
  const sumEnjoy = document.getElementById('sumEnjoy');
  const sumWaste = document.getElementById('sumWaste');
  const sumTotal = document.getElementById('sumTotal');
  const entryList = document.getElementById('entryList');
  const emptyMsg = document.getElementById('emptyMsg');

  // ─── 初期化 ─────────────────────────
  const today = new Date();
  viewYear = today.getFullYear();
  viewMonth = today.getMonth();
  dateInput.value = toISODate(today);

  bindEvents();
  updateAmountDisplay();
  render();

  // ─── イベント ─────────────────────────
  function bindEvents() {
    numpad.addEventListener('click', (e) => {
      const btn = e.target.closest('.key');
      if (!btn) return;
      if (btn === backspaceBtn) {
        amountHistory.pop();
      } else {
        const add = parseInt(btn.dataset.add, 10);
        if (!(add > 0)) return;
        if (currentAmount() + add > AMOUNT_CAP) return;
        amountHistory.push(add);
      }
      updateAmountDisplay();
    });

    tagButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedTag = btn.dataset.tag;
        tagButtons.forEach((b) => {
          const active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-checked', active ? 'true' : 'false');
        });
        updateSaveBtnState();
      });
    });

    saveBtn.addEventListener('click', handleSave);

    prevMonthBtn.addEventListener('click', () => {
      if (viewMonth === 0) {
        viewMonth = 11;
        viewYear -= 1;
      } else {
        viewMonth -= 1;
      }
      render();
    });

    nextMonthBtn.addEventListener('click', () => {
      if (viewMonth === 11) {
        viewMonth = 0;
        viewYear += 1;
      } else {
        viewMonth += 1;
      }
      render();
    });
  }

  function currentAmount() {
    return amountHistory.reduce((a, b) => a + b, 0);
  }

  function updateAmountDisplay() {
    const n = currentAmount();
    amountDisplay.textContent = n === 0 ? '0' : n.toLocaleString('ja-JP');
    amountDisplay.classList.toggle('is-empty', n === 0);
    updateSaveBtnState();
  }

  function updateSaveBtnState() {
    saveBtn.disabled = !(currentAmount() > 0 && selectedTag);
  }

  function handleSave() {
    const amount = currentAmount();
    if (!(amount > 0) || !selectedTag) return;

    const entry = {
      id: Date.now().toString(),
      date: dateInput.value || toISODate(new Date()),
      amount,
      tag: selectedTag,
    };
    entries.push(entry);
    saveEntries();
    resetForm();
    render();
  }

  function resetForm() {
    amountHistory = [];
    selectedTag = null;
    tagButtons.forEach((b) => {
      b.classList.remove('is-active');
      b.setAttribute('aria-checked', 'false');
    });
    dateInput.value = toISODate(new Date());
    updateAmountDisplay();
  }

  function handleDelete(id) {
    entries = entries.filter((e) => e.id !== id);
    saveEntries();
    render();
  }

  // ─── 描画 ─────────────────────────
  function render() {
    monthLabel.textContent = `${viewMonth + 1}月の記録`;

    const monthly = entries.filter((e) => isInMonth(e.date, viewYear, viewMonth));

    const sums = { necessary: 0, enjoy: 0, waste: 0 };
    for (const e of monthly) sums[e.tag] += e.amount;

    sumNecessary.textContent = formatYen(sums.necessary);
    sumEnjoy.textContent = formatYen(sums.enjoy);
    sumWaste.textContent = formatYen(sums.waste);
    sumTotal.textContent = formatYen(sums.necessary + sums.enjoy + sums.waste);

    monthly.sort((a, b) => (a.date === b.date ? b.id.localeCompare(a.id) : b.date.localeCompare(a.date)));

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

  // ─── ヘルパー ─────────────────────────
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
})();
