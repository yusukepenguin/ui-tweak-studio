// ── State ──────────────────────────────────────────────────────────────────
const state = {
  files: {},
  activeHtmlFile: null,
  vars: {},
  originalVars: {},
  history: [],
  historyIdx: -1,
  previewWidth: '100%',
  previewHeight: '100%',
};

// ── Regex helpers ───────────────────────────────────────────────────────────
const VAR_REGEX  = /--[\w-]+\s*:\s*[^;}\n]+/g;
const COLOR_RE   = /^#([0-9a-fA-F]{3,8})$|^(rgb|hsl|rgba|hsla)\(|^(transparent|white|black|inherit|currentColor)$/i;
const PX_RE      = /^-?\d*\.?\d+px$/;
const REM_RE     = /^-?\d*\.?\d+rem$/;
const NUM_RE     = /^-?\d*\.?\d+$/;

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ── Tabs ────────────────────────────────────────────────────────────────────
document.querySelectorAll('.panel-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    document.getElementById('tabUpload').style.display = target === 'upload' ? 'block'  : 'none';
    document.getElementById('tabVars'  ).style.display = target === 'vars'   ? 'block'  : 'none';
    document.getElementById('tabCode'  ).style.display = target === 'code'   ? 'flex'   : 'none';
    if (target === 'code') updateCodeView();
  });
});

// ── File Upload ─────────────────────────────────────────────────────────────
const uploadZone = document.getElementById('uploadZone');
const fileInput  = document.getElementById('fileInput');

uploadZone.addEventListener('click',     () => fileInput.click());
uploadZone.addEventListener('dragover',  e  => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', ()  => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  handleFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', () => handleFiles(fileInput.files));

function handleFiles(files) {
  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      state.files[file.name] = { content: e.target.result, type: file.type, name: file.name };
      if ((file.name.endsWith('.html') || file.name.endsWith('.htm')) && !state.activeHtmlFile) {
        state.activeHtmlFile = file.name;
      }
      renderFileList();
      parseAllVars();
      updatePreview();
      updateActionBtns();
      document.getElementById('fileStatus').textContent = Object.keys(state.files).join(', ');
    };
    reader.readAsText(file);
  });
}

function renderFileList() {
  const list = document.getElementById('fileList');
  list.innerHTML = '';
  Object.keys(state.files).forEach(name => {
    const isHtml = /\.(html?|htm)$/i.test(name);
    const isCss  = /\.css$/i.test(name);
    const isJs   = /\.(js|jsx|ts|tsx)$/i.test(name);
    const icon      = isHtml ? '🌐' : isCss ? '🎨' : isJs ? '⚡' : '📄';
    const typeLabel = isHtml ? 'HTML' : isCss ? 'CSS'  : isJs ? 'JS'  : 'FILE';
    const isActive  = name === state.activeHtmlFile;

    const item = document.createElement('div');
    item.className = 'file-item' + (isActive ? ' file-item-active' : '');
    item.innerHTML = `
      <span class="file-item-icon">${icon}</span>
      <span class="file-item-name" title="${name}">${name}</span>
      <span class="file-item-type">${typeLabel}</span>
      ${isHtml ? `<button class="btn-outline btn-sm" style="flex-shrink:0;font-size:11px"
          onclick="setActiveHtml('${name}')">プレビュー</button>` : ''}
      <button class="file-item-remove" onclick="removeFile('${name}')">✕</button>
    `;
    list.appendChild(item);
  });
}

window.setActiveHtml = name => {
  state.activeHtmlFile = name;
  renderFileList();
  updatePreview();
};

window.removeFile = name => {
  delete state.files[name];
  if (state.activeHtmlFile === name) {
    const htmlFiles = Object.keys(state.files).filter(f => /\.html?$/i.test(f));
    state.activeHtmlFile = htmlFiles[0] || null;
  }
  renderFileList();
  parseAllVars();
  updatePreview();
  updateActionBtns();
  const names = Object.keys(state.files);
  document.getElementById('fileStatus').textContent = names.length ? names.join(', ') : 'ファイル未読み込み';
};

// ── CSS Variable Parsing ────────────────────────────────────────────────────
function parseAllVars() {
  const allVars = {};
  Object.values(state.files).forEach(({ content }) => {
    const matches = content.match(VAR_REGEX) || [];
    matches.forEach(m => {
      const colonIdx = m.indexOf(':');
      const name  = m.slice(0, colonIdx).trim();
      const value = m.slice(colonIdx + 1).trim();
      allVars[name] = value;
    });
  });

  state.originalVars = {};
  Object.entries(allVars).forEach(([name, value]) => {
    state.originalVars[name] = value;
    if (state.vars[name] === undefined) state.vars[name] = value;
  });
  // Remove stale vars that no longer exist in files
  Object.keys(state.vars).forEach(k => { if (!state.originalVars[k]) delete state.vars[k]; });

  renderVarGroups();
}

// ── Var Categorisation ──────────────────────────────────────────────────────
function categorizeVars(vars) {
  const cats = { colors: {}, spacing: {}, typography: {}, radius: {}, other: {} };
  Object.entries(vars).forEach(([name, value]) => {
    const lc = name.toLowerCase();
    if (COLOR_RE.test(value.trim()) || /color|bg|background|border|shadow/.test(lc)) {
      cats.colors[name] = value;
    } else if (/font|text|line-height|letter/.test(lc)) {
      cats.typography[name] = value;
    } else if (/radius|rounded/.test(lc)) {
      cats.radius[name] = value;
    } else if (/spacing|padding|margin|gap/.test(lc) || PX_RE.test(value.trim()) || REM_RE.test(value.trim())) {
      cats.spacing[name] = value;
    } else {
      cats.other[name] = value;
    }
  });
  return cats;
}

const CAT_LABELS = {
  colors:     'カラー',
  spacing:    'スペーシング',
  typography: 'タイポグラフィ',
  radius:     '角丸',
  other:      'その他',
};

function renderVarGroups() {
  const container = document.getElementById('varGroups');
  const cats = categorizeVars(state.vars);
  const hasVars = Object.values(cats).some(c => Object.keys(c).length > 0);

  if (!hasVars) {
    container.innerHTML = '<div class="no-vars">CSS変数が見つかりませんでした</div>';
    return;
  }

  container.innerHTML = '';
  Object.entries(cats).forEach(([catKey, vars]) => {
    if (!Object.keys(vars).length) return;
    const group = document.createElement('div');
    group.className = 'var-group';
    group.innerHTML = `
      <div class="var-group-header" data-cat="${catKey}">
        <span class="var-group-title">${CAT_LABELS[catKey]} (${Object.keys(vars).length})</span>
        <span class="var-group-chevron">▾</span>
      </div>
      <div class="var-group-body"></div>
    `;
    const body = group.querySelector('.var-group-body');
    Object.entries(vars).forEach(([name, value]) => body.appendChild(buildVarRow(name, value)));

    group.querySelector('.var-group-header').addEventListener('click', () => {
      group.querySelector('.var-group-body').classList.toggle('collapsed');
      group.querySelector('.var-group-chevron').classList.toggle('collapsed');
    });
    container.appendChild(group);
  });

  updateChangeSummary();
}

// ── Build a single variable row ─────────────────────────────────────────────
function buildVarRow(name, value) {
  const row = document.createElement('div');
  row.className = 'var-row';
  row.dataset.varName = name;

  const trimVal   = value.trim();
  const isChanged = trimVal !== (state.originalVars[name] || '').trim();
  const shortVal  = trimVal.length > 22 ? trimVal.slice(0, 22) + '…' : trimVal;

  const labelDiv = document.createElement('div');
  labelDiv.className = 'var-label';
  labelDiv.innerHTML = `
    <span class="var-name">${name}${isChanged ? '<span class="changed-badge"></span>' : ''}</span>
    <span class="var-value-display" title="クリックでリセット">${shortVal}</span>
  `;
  labelDiv.querySelector('.var-value-display').addEventListener('click', () => resetVar(name));

  const controlsDiv = document.createElement('div');
  controlsDiv.className = 'var-controls';

  const colorMatch = trimVal.match(/^#([0-9a-fA-F]{3,8})$/);

  if (colorMatch) {
    let hex = trimVal;
    if (hex.length === 4) hex = '#' + hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3];

    controlsDiv.innerHTML = `
      <div class="color-control">
        <label class="color-swatch-wrap">
          <input type="color" value="${hex.slice(0, 7)}" data-var="${name}">
        </label>
        <input type="text" class="color-hex-input" value="${trimVal}" data-var="${name}" spellcheck="false">
      </div>
    `;
    const picker    = controlsDiv.querySelector('input[type="color"]');
    const hexInput  = controlsDiv.querySelector('.color-hex-input');
    const swatchWrap = controlsDiv.querySelector('.color-swatch-wrap');
    swatchWrap.style.background = trimVal;

    picker.addEventListener('input', () => {
      hexInput.value = picker.value;
      swatchWrap.style.background = picker.value;
      applyVar(name, picker.value);
    });
    hexInput.addEventListener('input', () => {
      const v = hexInput.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v) || /^#[0-9a-fA-F]{8}$/.test(v)) {
        picker.value = v.slice(0, 7);
        swatchWrap.style.background = v;
      }
      applyVar(name, v);
    });

  } else if (PX_RE.test(trimVal) || REM_RE.test(trimVal)) {
    const num  = parseFloat(trimVal);
    const unit = PX_RE.test(trimVal) ? 'px' : 'rem';
    const max  = unit === 'px' ? 200 : 10;
    const step = unit === 'px' ? 1   : 0.25;

    controlsDiv.innerHTML = `
      <div class="number-control">
        <input type="range" min="0" max="${max}" step="${step}" value="${num}" data-var="${name}">
        <input type="text"  class="number-input-small" value="${trimVal}" data-var="${name}">
      </div>
    `;
    const range  = controlsDiv.querySelector('input[type="range"]');
    const numIn  = controlsDiv.querySelector('.number-input-small');
    range.addEventListener('input', () => {
      const v = range.value + unit;
      numIn.value = v;
      applyVar(name, v);
    });
    numIn.addEventListener('input', () => applyVar(name, numIn.value.trim()));

  } else if (NUM_RE.test(trimVal)) {
    const num = parseFloat(trimVal);

    controlsDiv.innerHTML = `
      <div class="number-control">
        <input type="range" min="0" max="${Math.max(num * 3, 2)}" step="0.01" value="${num}" data-var="${name}">
        <input type="text"  class="number-input-small" value="${trimVal}" data-var="${name}">
      </div>
    `;
    const range = controlsDiv.querySelector('input[type="range"]');
    const numIn = controlsDiv.querySelector('.number-input-small');
    range.addEventListener('input', () => {
      const v = parseFloat(range.value).toFixed(2).replace(/\.?0+$/, '');
      numIn.value = v;
      applyVar(name, v);
    });
    numIn.addEventListener('input', () => applyVar(name, numIn.value.trim()));

  } else {
    controlsDiv.innerHTML = `
      <div class="text-control" style="width:100%">
        <input type="text" value="${trimVal}" data-var="${name}" spellcheck="false">
      </div>
    `;
    controlsDiv.querySelector('input').addEventListener('input', e => applyVar(name, e.target.value));
  }

  row.appendChild(labelDiv);
  row.appendChild(controlsDiv);
  return row;
}

// ── Apply a var change ──────────────────────────────────────────────────────
let applyTimer = null;

function applyVar(name, value, addToHistory = true) {
  const prev = state.vars[name];
  state.vars[name] = value;

  if (addToHistory && prev !== value) {
    state.history = state.history.slice(0, state.historyIdx + 1);
    state.history.push({ name, prev, next: value });
    state.historyIdx = state.history.length - 1;
    updateHistoryBtns();
  }

  // Update label badge + display
  const row = document.querySelector(`.var-row[data-var-name="${name}"]`);
  if (row) {
    const isChanged = value.trim() !== (state.originalVars[name] || '').trim();
    const badge     = row.querySelector('.changed-badge');
    const display   = row.querySelector('.var-value-display');
    if (isChanged && !badge) row.querySelector('.var-name').insertAdjacentHTML('beforeend', '<span class="changed-badge"></span>');
    if (!isChanged && badge) badge.remove();
    if (display) display.textContent = value.length > 22 ? value.slice(0, 22) + '…' : value;
  }

  updateChangeSummary();

  clearTimeout(applyTimer);
  applyTimer = setTimeout(injectVarsIntoPreview, 60);
}

// ── Inject overrides into live iframe ──────────────────────────────────────
function injectVarsIntoPreview() {
  const iframe = document.querySelector('#previewWrap iframe');
  if (!iframe) { updatePreview(); return; }
  try {
    const doc = iframe.contentDocument;
    let styleEl = doc.getElementById('__tweakstudio__');
    if (!styleEl) {
      styleEl = doc.createElement('style');
      styleEl.id = '__tweakstudio__';
      doc.head.appendChild(styleEl);
    }
    const overrides = Object.entries(state.vars)
      .filter(([k, v]) => v !== state.originalVars[k])
      .map(([k, v]) => `  ${k}: ${v};`)
      .join('\n');
    styleEl.textContent = overrides ? `:root {\n${overrides}\n}` : '';
  } catch {
    updatePreview();
  }
}

// ── Reset a single var ──────────────────────────────────────────────────────
function resetVar(name) {
  const orig = state.originalVars[name];
  if (orig === undefined) return;
  applyVar(name, orig);
  const row = document.querySelector(`.var-row[data-var-name="${name}"]`);
  if (row) row.replaceWith(buildVarRow(name, orig));
}

// ── Change summary bar ──────────────────────────────────────────────────────
function updateChangeSummary() {
  const changed = Object.keys(state.vars).filter(k => state.vars[k] !== state.originalVars[k]);
  document.getElementById('changeCount').textContent = changed.length;
  document.getElementById('changeSummary').classList.toggle('visible', changed.length > 0);
}

document.getElementById('resetAllVarsBtn').addEventListener('click', () => {
  Object.keys(state.vars).forEach(k => { state.vars[k] = state.originalVars[k]; });
  renderVarGroups();
  updatePreview();
  showToast('すべての変更をリセットしました', 'success');
});

// ── Preview ─────────────────────────────────────────────────────────────────
function buildInjectedHtml() {
  if (!state.activeHtmlFile) return null;
  let html = state.files[state.activeHtmlFile].content;

  // Inline linked CSS files
  Object.entries(state.files).forEach(([name, { content }]) => {
    if (!/\.css$/i.test(name)) return;
    const re = new RegExp(`<link[^>]*href=["']${escapeRe(name)}["'][^>]*>`, 'i');
    html = re.test(html)
      ? html.replace(re, `<style>/* ${name} */\n${content}\n</style>`)
      : html.replace('</head>', `<style>/* ${name} */\n${content}\n</style>\n</head>`);
  });

  // Inline linked JS files
  Object.entries(state.files).forEach(([name, { content }]) => {
    if (!/\.(js|jsx|ts|tsx)$/i.test(name)) return;
    const re = new RegExp(`<script[^>]*src=["']${escapeRe(name)}["'][^>]*><\/script>`, 'i');
    if (re.test(html)) html = html.replace(re, `<script>/* ${name} */\n${content}\n<\/script>`);
  });

  // Inject variable overrides
  const overrides = Object.entries(state.vars)
    .filter(([k, v]) => v !== state.originalVars[k])
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  if (overrides) {
    html = html.replace('</head>', `<style id="__tweakstudio__">:root {\n${overrides}\n}</style>\n</head>`);
  }

  return html;
}

function updatePreview() {
  const wrap = document.getElementById('previewWrap');

  if (!state.activeHtmlFile) {
    wrap.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎨</div>
        <h3>UI Tweak Studio</h3>
        <p>HTMLファイルをアップロードするとここにプレビューが表示されます。<br>CSS変数を編集するとリアルタイムで反映されます。</p>
      </div>`;
    return;
  }

  const html    = buildInjectedHtml();
  if (!html) return;

  const isFixed = state.previewWidth !== '100%';
  const device  = document.createElement('div');
  device.className = 'preview-device';
  device.style.width  = isFixed ? state.previewWidth + 'px'  : '100%';
  device.style.height = isFixed ? state.previewHeight + 'px' : '100%';
  if (!isFixed) device.style.alignSelf = 'stretch';

  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  device.appendChild(iframe);

  wrap.innerHTML = '';
  wrap.style.alignItems = isFixed ? 'flex-start' : 'stretch';
  wrap.appendChild(device);

  iframe.srcdoc = html;
}

document.getElementById('refreshPreview').addEventListener('click', updatePreview);

// Width presets
document.querySelectorAll('.preset-btn[data-width]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.preset-btn[data-width]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const w = btn.dataset.width;
    const h = btn.dataset.height;
    state.previewWidth  = w === '100%' ? '100%' : parseInt(w);
    state.previewHeight = h === '100%' ? '100%' : parseInt(h);
    updatePreview();
  });
});

// ── Code View ───────────────────────────────────────────────────────────────
function updateCodeView() {
  const box = document.getElementById('codeBox');
  if (!state.activeHtmlFile) { box.textContent = 'ファイルを読み込んでください'; return; }
  box.textContent = generateOutput()[state.activeHtmlFile] || '';
}

function generateOutput() {
  const out = {};

  Object.entries(state.files).forEach(([name, { content }]) => {
    if (!/\.css$/i.test(name)) { out[name] = content; return; }
    let result = content;
    Object.entries(state.vars).forEach(([varName, newVal]) => {
      const orig = state.originalVars[varName];
      if (!orig || newVal === orig) return;
      const re = new RegExp(`(${escapeRe(varName)}\\s*:)[^;\\n]+`, 'g');
      result = result.replace(re, `$1 ${newVal}`);
    });
    out[name] = result;
  });

  if (state.activeHtmlFile && state.files[state.activeHtmlFile]) {
    let html = state.files[state.activeHtmlFile].content;
    Object.entries(state.vars).forEach(([varName, newVal]) => {
      const orig = state.originalVars[varName];
      if (!orig || newVal === orig) return;
      const re = new RegExp(`(${escapeRe(varName)}\\s*:)[^;\\n]+`, 'g');
      html = html.replace(re, `$1 ${newVal}`);
    });
    out[state.activeHtmlFile] = html;
  }

  return out;
}

// ── Download ─────────────────────────────────────────────────────────────────
document.getElementById('downloadBtn').addEventListener('click', () => {
  const outputs = generateOutput();
  const names   = Object.keys(outputs);
  if (!names.length) return;

  if (names.length === 1) {
    downloadText(outputs[names[0]], names[0]);
    return;
  }

  // Multiple files → zip
  const script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  script.onload = () => {
    const zip = new JSZip();
    Object.entries(outputs).forEach(([name, content]) => zip.file(name, content));
    zip.generateAsync({ type: 'blob' }).then(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'tweaked-files.zip';
      a.click();
      showToast('ZIPファイルをダウンロードしました', 'success');
    });
  };
  document.head.appendChild(script);
});

function downloadText(content, filename) {
  const blob = new Blob([content], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  showToast(`${filename} をダウンロードしました`, 'success');
}

function updateActionBtns() {
  const has = Object.keys(state.files).length > 0;
  document.getElementById('downloadBtn').disabled = !has;
  document.getElementById('resetBtn').disabled    = !has;
}

// ── Full Reset ───────────────────────────────────────────────────────────────
document.getElementById('resetBtn').addEventListener('click', () => {
  if (!confirm('すべての変更をリセットしますか？')) return;
  state.vars     = { ...state.originalVars };
  state.history  = [];
  state.historyIdx = -1;
  renderVarGroups();
  updatePreview();
  updateHistoryBtns();
  showToast('リセットしました', 'success');
});

// ── Copy Code ────────────────────────────────────────────────────────────────
document.getElementById('copyCodeBtn').addEventListener('click', () => {
  navigator.clipboard.writeText(document.getElementById('codeBox').textContent)
    .then(() => showToast('コピーしました', 'success'));
});

// ── Undo / Redo ──────────────────────────────────────────────────────────────
document.getElementById('undoBtn').addEventListener('click', () => {
  if (state.historyIdx < 0) return;
  const { name, prev } = state.history[state.historyIdx--];
  state.vars[name] = prev;
  refreshVarRow(name, prev);
  updateHistoryBtns();
  injectVarsIntoPreview();
  updateChangeSummary();
});

document.getElementById('redoBtn').addEventListener('click', () => {
  if (state.historyIdx >= state.history.length - 1) return;
  const { name, next } = state.history[++state.historyIdx];
  state.vars[name] = next;
  refreshVarRow(name, next);
  updateHistoryBtns();
  injectVarsIntoPreview();
  updateChangeSummary();
});

function refreshVarRow(name, value) {
  const row = document.querySelector(`.var-row[data-var-name="${name}"]`);
  if (row) row.replaceWith(buildVarRow(name, value));
}

function updateHistoryBtns() {
  document.getElementById('undoBtn').disabled = state.historyIdx < 0;
  document.getElementById('redoBtn').disabled = state.historyIdx >= state.history.length - 1;
}

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    document.getElementById('undoBtn').click();
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    e.preventDefault();
    document.getElementById('redoBtn').click();
  }
});

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = '') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 2800);
}
