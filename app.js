let currentType = 'photo';
let selectedFile = null;

const tabs = document.querySelectorAll('.tab');
const fileInput = document.getElementById('fileInput');
const dropText = document.getElementById('dropText');
const submitBtn = document.getElementById('submitBtn');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    currentType = tab.dataset.type;
    fileInput.accept = currentType === 'photo' ? 'image/*' : 'video/*';
    dropText.textContent = currentType === 'photo'
      ? 'Выбери файл фото (JPG/PNG)'
      : 'Выбери видеофайл (MP4)';
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

function fileToDataUri(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function poll(id) {
  const r = await fetch('/api/status?id=' + id);
  const data = await r.json();

  if (data.error) {
    statusEl.innerHTML = '<span class="error">Ошибка: ' + data.error + '</span>';
    return;
  }

  if (data.status === 'succeeded') {
    statusEl.textContent = 'Готово!';
    showResult(data.output);
    return;
  }

  if (data.status === 'failed' || data.status === 'canceled') {
    statusEl.innerHTML = '<span class="error">Не получилось: ' + (data.error || data.status) + '</span>';
    return;
  }

  statusEl.textContent = 'Обрабатываю… (' + data.status + ')';
  setTimeout(() => poll(id), 2500);
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

submitBtn.addEventListener('click', async () => {
  if (!selectedFile) return;
  submitBtn.disabled = true;
  resultEl.innerHTML = '';

  try {
    let body;

    if (currentType === 'photo') {
      statusEl.textContent = 'Загружаю файл…';
      const dataUri = await fileToDataUri(selectedFile);
      body = { type: 'photo', file: dataUri };
    } else {
      statusEl.textContent = 'Загружаю видео в хранилище…';
      const blob = await window.vercelBlobUpload(selectedFile.name, selectedFile, {
        access: 'public',
        handleUploadUrl: '/api/blob-upload',
      });
      body = { type: 'video', videoUrl: blob.url };
    }

    statusEl.textContent = 'Отправляю на обработку…';

    const r = await fetch('/api/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();

    if (data.error) {
      statusEl.innerHTML = '<span class="error">Ошибка: ' + data.error + '</span>';
      submitBtn.disabled = false;
      return;
    }

    poll(data.id);
  } catch (e) {
    statusEl.innerHTML = '<span class="error">Ошибка: ' + e.message + '</span>';
  } finally {
    submitBtn.disabled = false;
  }
});
