let currentType = 'photo';
let selectedFile = null;

const viewTabs = document.querySelectorAll('.views .tab');
const uploadView = document.getElementById('uploadView');
const historyView = document.getElementById('historyView');
const historyList = document.getElementById('historyList');

const typeTabs = document.querySelectorAll('.tabs:not(.views) .tab');
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
    resetState();
  });
});

fileInput.addEventListener('change', () => {
  selectedFile = fileInput.files[0] || null;
  submitBtn.disabled = !selectedFile;
  if (selectedFile) {
    dropText.textContent = selectedFile.name + ' (' + Math.round(selectedFile.size / 1024) + ' КБ)';
  }
});

function resetState() {
  selectedFile = null;
  fileInput.value = '';
  submitBtn.disabled = true;
  statusEl.textContent = '';
  resultEl.innerHTML = '';
}

async function poll(id, type, beforeUrl, params) {
  const r = await fetch('/api/status?id=' + id);
  const data = await r.json();

  if (data.error) {
    statusEl.innerHTML = '<span class="error">Ошибка: ' + data.error + '</span>';
    return;
  }

  if (data.status === 'succeeded') {
    statusEl.textContent = 'Готово!';
    showResult(data.output);
    saveHistoryEntry(type, beforeUrl, extractUrl(data.output), params);
    return;
  }

  if (data.status === 'failed' || data.status === 'canceled') {
    statusEl.innerHTML = '<span class="error">Не получилось: ' + (data.error || data.status) + '</span>';
    return;
  }

  statusEl.textContent = 'Обрабатываю… (' + data.status + ')';
  setTimeout(() => poll(id, type, beforeUrl, params), 2500);
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

function showResult(output) {
  const url = extractUrl(output);
  if (!url) {
    resultEl.innerHTML = '<pre>' + JSON.stringify(output, null, 2) + '</pre>';
    return;
  }
  const el = currentType === 'photo'
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
  if (params.scale_factor) parts.push('×' + params.scale_factor);
  if (params.target_resolution) parts.push(params.target_resolution);
  if (params.target_fps) parts.push(params.target_fps + ' fps');
  if (params.scene) parts.push(params.scene);
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
      '<a class="download" href="' + entry.afterUrl + '" target="_blank" rel="noopener">Скачать результат</a>' +
    '</div>'
  );
}

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
  if (!selectedFile) return;
  submitBtn.disabled = true;
  resultEl.innerHTML = '';

  try {
    statusEl.textContent = 'Загружаю файл в хранилище…';
    const blob = await window.vercelBlobUpload(selectedFile.name, selectedFile, {
      access: 'public',
      handleUploadUrl: '/api/blob-upload',
    });

    statusEl.textContent = 'Отправляю на обработку…';

    const r = await fetch('/api/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: currentType, fileUrl: blob.url }),
    });
    const data = await r.json();

    if (data.error) {
      statusEl.innerHTML = '<span class="error">Ошибка: ' + data.error + '</span>';
      submitBtn.disabled = false;
      return;
    }

    poll(data.id, currentType, blob.url, data.params);
  } catch (e) {
    statusEl.innerHTML = '<span class="error">Ошибка: ' + e.message + '</span>';
  } finally {
    submitBtn.disabled = false;
  }
});
