let currentType = 'photo';
let currentRatio = '';
let currentMode = 'crop';
let currentAudioMode = 'remove';
let selectedFile = null;
let pendingUploadUrl = null;
let pendingExtendUrl = null;

const viewTabs = document.querySelectorAll('.views .tab');
const uploadView = document.getElementById('uploadView');
const extendView = document.getElementById('extendView');
const historyView = document.getElementById('historyView');
const historyList = document.getElementById('historyList');

const typeTabs = document.querySelectorAll('.tabs:not(.views) .tab');
const ratioBtns = document.querySelectorAll('.ratio-btn[data-ratio]');
const modeBtns = document.querySelectorAll('.ratio-btn[data-mode]');
const audioBtns = document.querySelectorAll('.ratio-btn[data-audio]');
const modeRow = document.getElementById('modeRow');
const audioRow = document.getElementById('audioRow');
const fileInput = document.getElementById('fileInput');
const dropText = document.getElementById('dropText');
const submitBtn = document.getElementById('submitBtn');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');

viewTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    viewTabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const view = tab.dataset.view;
    uploadView.style.display = view === 'upload' ? '' : 'none';
    extendView.style.display = view === 'extend' ? '' : 'none';
    historyView.style.display = view === 'history' ? '' : 'none';
    if (view === 'history') loadHistory();
  });
});

typeTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    typeTabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    currentType = tab.dataset.type;
    fileInput.accept = currentType === 'photo'
      ? 'image/*,.jpg,.jpeg,.png,.webp'
      : 'video/*,.mov,.mp4,.webm,.m4v,.avi';
    dropText.textContent = currentType === 'photo'
      ? 'Выбери файл фото (JPG/PNG)'
      : 'Выбери видеофайл (MP4, MOV, WEBM)';
    audioRow.style.display = currentType === 'video' ? '' : 'none';
    resetState();
  });
});

audioBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    audioBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentAudioMode = btn.dataset.audio;
  });
});

ratioBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    ratioBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentRatio = btn.dataset.ratio;
    modeRow.style.display = currentRatio ? '' : 'none';
  });
});

modeBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    modeBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentMode = btn.dataset.mode;
  });
});

fileInput.addEventListener('change', () => {
  selectedFile = fileInput.files[0] || null;
  pendingUploadUrl = null;
  submitBtn.disabled = !selectedFile;
  if (selectedFile) {
    dropText.textContent = selectedFile.name + ' (' + Math.round(selectedFile.size / 1024) + ' КБ)';
  }
});

function resetState() {
  selectedFile = null;
  pendingUploadUrl = null;
  fileInput.value = '';
  submitBtn.disabled = true;
  statusEl.textContent = '';
  resultEl.innerHTML = '';
}

function useHistoryResult(url, type, target) {
  if (target === 'upload') {
    document.querySelector('.views .tab[data-view="upload"]').click();
    const typeBtn = document.querySelector('.tabs:not(.views) .tab[data-type="' + type + '"]');
    if (typeBtn) typeBtn.click();
    pendingUploadUrl = url;
    selectedFile = null;
    dropText.textContent = 'Используется результат из истории ✓';
    submitBtn.disabled = false;
  } else if (target === 'extend') {
    document.querySelector('.views .tab[data-view="extend"]').click();
    pendingExtendUrl = url;
    extendSelectedFile = null;
    extendDropText.textContent = 'Используется результат из истории ✓';
    extendBtn.disabled = false;
  }
}

async function poll(id, type, beforeUrl, params, ratio, mode, audioMode) {
  const r = await fetch('/api/status?id=' + id);
  const data = await r.json();

  if (data.error) {
    statusEl.innerHTML = '<span class="error">Ошибка: ' + data.error + '</span>';
    return;
  }

  if (data.status === 'succeeded') {
    const rawUrl = extractUrl(data.output);
    finalizeResult(type, beforeUrl, rawUrl, params, ratio, mode, audioMode);
    return;
  }

  if (data.status === 'failed' || data.status === 'canceled') {
    statusEl.innerHTML = '<span class="error">Не получилось: ' + (data.error || data.status) + '</span>';
    return;
  }

  statusEl.textContent = 'Обрабатываю… (' + data.status + ')';
  setTimeout(() => poll(id, type, beforeUrl, params, ratio, mode, audioMode), 2500);
}

async function finalizeResult(type, beforeUrl, rawUrl, params, ratio, mode, audioMode) {
  if (!rawUrl) {
    statusEl.innerHTML = '<span class="error">Не удалось получить результат</span>';
    return;
  }

  let finalUrl = rawUrl;
  const finalParams = { ...params };
  let warning = null;

  // Всегда прогоняем через финальную обработку: видео — звук (оставить/убрать),
  // фото — конвертация в JPEG (Adobe Stock не принимает PNG для обычных фото).
  {
    statusEl.textContent = ratio ? ('Подгоняю под формат ' + ratio + '…') : 'Дообрабатываю файл…';
    try {
      const r = await fetch('/api/process-aspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: rawUrl, ratio: ratio || undefined, type, mode, audioMode }),
      });
      const data = await r.json();
      if (data.error) {
        statusEl.innerHTML = '<span class="error">Ошибка обработки: ' + data.error + '</span>';
        return;
      }
      finalUrl = data.url;
      if (ratio) {
        finalParams.ratio = ratio;
        finalParams.mode = data.mode;
      }
      if (data.audioAction) finalParams.audio = data.audioAction;
      warning = data.warning;
    } catch (e) {
      statusEl.innerHTML = '<span class="error">Ошибка обработки: ' + e.message + '</span>';
      return;
    }
  }

  statusEl.innerHTML = 'Готово!' + (warning ? '<br><span class="warning">⚠ ' + warning + '</span>' : '');
  showResult(finalUrl, type);
  saveHistoryEntry(type, beforeUrl, finalUrl, finalParams);
}

function extractUrl(output) {
  if (!output) return null;
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return output[0];
  if (typeof output === 'object') {
    return output.url || output.video || output.image || Object.values(output)[0];
  }
  return null;
}

function showResult(url, type) {
  const el = type === 'photo'
    ? '<img src="' + url + '" alt="Результат">'
    : '<video src="' + url + '" controls></video>';
  resultEl.innerHTML = el + '<br><a class="download" href="' + url + '" target="_blank" rel="noopener">Скачать результат</a>';
}

async function saveHistoryEntry(type, beforeUrl, afterUrl, params) {
  if (!afterUrl) return;
  try {
    await fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, beforeUrl, afterUrl, params }),
    });
  } catch (e) {
    console.error('history save failed', e);
  }
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatParams(params) {
  if (!params) return '';
  const parts = [];
  if (params.action === 'extend') {
    parts.push('продление до ' + params.duration + ' сек');
    parts.push(params.method === 'slow' ? 'замедление' : 'заморозка кадра');
    return parts.join(' · ');
  }
  if (params.scale_factor) parts.push('×' + params.scale_factor);
  if (params.target_resolution) parts.push(params.target_resolution);
  if (params.target_fps) parts.push(params.target_fps + ' fps');
  if (params.scene) parts.push(params.scene);
  if (params.ratio) parts.push(params.ratio);
  if (params.mode) parts.push(params.mode === 'pad' ? 'с полями' : 'обрезка');
  if (params.audio === 'removed') parts.push('звук убран');
  if (params.audio === 'kept') parts.push('звук оставлен');
  return parts.join(' · ');
}

function historyItemHtml(entry) {
  const isPhoto = entry.type === 'photo';
  const beforeEl = isPhoto
    ? '<img src="' + entry.beforeUrl + '" alt="До">'
    : '<video src="' + entry.beforeUrl + '" controls muted></video>';
  const afterEl = isPhoto
    ? '<img src="' + entry.afterUrl + '" alt="После">'
    : '<video src="' + entry.afterUrl + '" controls muted></video>';

  const actions = ['<button class="history-action-btn" data-use-url="' + entry.afterUrl + '" data-use-type="' + entry.type + '" data-use-target="upload">→ Улучшить</button>'];
  if (!isPhoto) {
    actions.push('<button class="history-action-btn" data-use-url="' + entry.afterUrl + '" data-use-type="video" data-use-target="extend">→ Продлить</button>');
  }

  return (
    '<div class="history-item">' +
      '<div class="history-meta">' +
        '<span>' + (isPhoto ? 'Фото' : 'Видео') + '</span>' +
        '<span>' + formatDate(entry.createdAt) + '</span>' +
        '<span>' + formatParams(entry.params) + '</span>' +
      '</div>' +
      '<div class="history-pair">' +
        '<div class="history-cell"><span class="history-label">До</span>' + beforeEl + '</div>' +
        '<div class="history-cell"><span class="history-label">После</span>' + afterEl + '</div>' +
      '</div>' +
      '<div class="history-item-footer">' +
        '<a class="download" href="' + entry.afterUrl + '" target="_blank" rel="noopener">Скачать результат</a>' +
        actions.join('') +
      '</div>' +
    '</div>'
  );
}

historyList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-use-url]');
  if (!btn) return;
  useHistoryResult(btn.dataset.useUrl, btn.dataset.useType, btn.dataset.useTarget);
});

async function loadHistory() {
  historyList.innerHTML = '<p class="hint">Загружаю…</p>';
  try {
    const r = await fetch('/api/history');
    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) {
      historyList.innerHTML = '<p class="hint">Пока пусто — здесь появятся твои готовые результаты.</p>';
      return;
    }
    historyList.innerHTML = data.map(historyItemHtml).join('');
  } catch (e) {
    historyList.innerHTML = '<p class="error">Не удалось загрузить историю: ' + e.message + '</p>';
  }
}

submitBtn.addEventListener('click', async () => {
  if (!selectedFile && !pendingUploadUrl) return;
  submitBtn.disabled = true;
  resultEl.innerHTML = '';

  try {
    let sourceUrl;
    if (pendingUploadUrl) {
      sourceUrl = pendingUploadUrl;
      pendingUploadUrl = null;
    } else {
      statusEl.textContent = 'Загружаю файл в хранилище…';
      const blob = await window.vercelBlobUpload(selectedFile.name, selectedFile, {
        access: 'public',
        handleUploadUrl: '/api/blob-upload',
      });
      sourceUrl = blob.url;
    }

    statusEl.textContent = 'Отправляю на обработку…';

    const r = await fetch('/api/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: currentType, fileUrl: sourceUrl }),
    });
    const data = await r.json();

    if (data.error) {
      statusEl.innerHTML = '<span class="error">Ошибка: ' + data.error + '</span>';
      submitBtn.disabled = false;
      return;
    }

    poll(data.id, currentType, sourceUrl, data.params, currentRatio, currentMode, currentAudioMode);
  } catch (e) {
    statusEl.innerHTML = '<span class="error">Ошибка: ' + e.message + '</span>';
  } finally {
    submitBtn.disabled = false;
  }
});

let extendSelectedFile = null;
let extendMethod = 'freeze';

const extendFileInput = document.getElementById('extendFileInput');
const extendDropText = document.getElementById('extendDropText');
const extendBtn = document.getElementById('extendBtn');
const extendStatusEl = document.getElementById('extendStatus');
const extendResultEl = document.getElementById('extendResult');
const targetDurationInput = document.getElementById('targetDuration');
const extendMethodBtns = document.querySelectorAll('.ratio-btn[data-extend-method]');

extendMethodBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    extendMethodBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    extendMethod = btn.dataset.extendMethod;
  });
});

extendFileInput.addEventListener('change', () => {
  extendSelectedFile = extendFileInput.files[0] || null;
  pendingExtendUrl = null;
  extendBtn.disabled = !extendSelectedFile;
  if (extendSelectedFile) {
    extendDropText.textContent = extendSelectedFile.name + ' (' + Math.round(extendSelectedFile.size / 1024) + ' КБ)';
  }
});

extendBtn.addEventListener('click', async () => {
  if (!extendSelectedFile && !pendingExtendUrl) return;
  extendBtn.disabled = true;
  extendResultEl.innerHTML = '';

  try {
    let sourceUrl;
    if (pendingExtendUrl) {
      sourceUrl = pendingExtendUrl;
      pendingExtendUrl = null;
    } else {
      extendStatusEl.textContent = 'Загружаю файл в хранилище…';
      const blob = await window.vercelBlobUpload(extendSelectedFile.name, extendSelectedFile, {
        access: 'public',
        handleUploadUrl: '/api/blob-upload',
      });
      sourceUrl = blob.url;
    }

    extendStatusEl.textContent = 'Продлеваю видео…';

    const r = await fetch('/api/extend-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: sourceUrl,
        targetDuration: targetDurationInput.value,
        method: extendMethod,
      }),
    });
    const data = await r.json();

    if (data.error) {
      extendStatusEl.innerHTML = '<span class="error">Ошибка: ' + data.error + '</span>';
      return;
    }

    extendStatusEl.innerHTML = 'Готово!' + (data.warning ? '<br><span class="warning">⚠ ' + data.warning + '</span>' : '');
    extendResultEl.innerHTML =
      '<video src="' + data.url + '" controls></video><br>' +
      '<a class="download" href="' + data.url + '" target="_blank" rel="noopener">Скачать результат</a>';

    saveHistoryEntry('video', sourceUrl, data.url, { action: 'extend', method: data.method, duration: data.duration });
  } catch (e) {
    extendStatusEl.innerHTML = '<span class="error">Ошибка: ' + e.message + '</span>';
  } finally {
    extendBtn.disabled = false;
  }
});
