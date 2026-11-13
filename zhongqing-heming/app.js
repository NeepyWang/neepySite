(function () {
  'use strict';

  const stage = document.querySelector('#stage');
  const piano = document.querySelector('#piano');
  const notice = document.querySelector('#stageNotice');
  const readout = document.querySelector('#toneReadout');
  const stageHint = document.querySelector('#stageHint');
  const instrumentToggle = document.querySelector('#instrumentToggle');
  const modeToggle = document.querySelector('#modeToggle');
  const brandSeal = document.querySelector('#brandSeal');
  const brandSub = document.querySelector('#brandSub');
  const bellImage = document.querySelector('#bellImage');
  const qingImage = document.querySelector('#qingImage');

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const decodedAudio = new Map();
  const activeSources = [];
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // 编钟敲击点定位参数（沿用原编钟演奏页标定值）
  const hitImageSize = { width: 1798, height: 875 };
  const locatorImageSize = { width: 1634, height: 796 };
  const bellContentBounds = { x: 6, y: 180, width: 1786, height: 592 };
  const locatorLines = {
    middle: [
      { max: 500, m: 0.066659, b: 357.503 },
      { max: 1080, m: 0.044528, b: 341.533 },
      { max: Infinity, m: 0.063279, b: 296.1 }
    ],
    lower: [
      { max: 500, m: 0.042655, b: 588.133 },
      { max: 1120, m: 0.127445, b: 496.467 },
      { max: Infinity, m: 0.068537, b: 535.827 }
    ]
  };
  const hitXPercentOverrides = {
    '上三1': 72.25, '上三2': 74.97, '上三3': 77.59, '上三4': 80.45, '上三5': 83.43, '上三6': 86.46, '上三7': 89.52,
    '中一1': 1.08, '中一2': 3.56, '中一3': 6.54, '中一4': 8.65, '中一5': 10.87, '中一6': 13.21, '中一7': 15.66, '中一8': 18.21, '中一9': 20.88, '中一10': 23.67, '中一11': 26.56,
    '中二1': 34.29, '中二2': 36.35, '中二3': 38.52, '中二4': 40.8, '中二5': 43.19, '中二6': 45.69, '中二7': 48.3, '中二8': 51.03, '中二9': 53.87, '中二10': 56.81, '中二11': 59.87, '中二12': 63.04,
    '中三1': 69.05, '中三2': 71.16, '中三3': 73.39, '中三4': 75.72, '中三5': 78.17, '中三6': 80.73, '中三7': 83.4, '中三8': 86.18, '中三9': 89.07, '中三10': 92.1,
    '下一1': 10.87, '下一2': 17.19, '下一3': 23.3,
    '下二1': 37.12, '下二2': 41.74, '下二3': 46.41, '下二4': 51.14, '下二5': 55.92, '下二6': 61.26, '下二7': 71.16, '下二8': 77.34, '下二9': 83.57, '下二10': 90.74
  };

  // 音频按需加载，避免首屏一次性读取二十余兆素材
  const audioSources = {
    bell: { file: './bell-audio-data.js', global: 'BELL_AUDIO_BASE64', promise: null },
    qing: { file: './qing-audio-data.js', global: 'QING_AUDIO_BASE64', promise: null }
  };

  const instrumentMeta = {
    bell: { seal: '钟', sub: '曾侯乙编钟 · 模拟演奏', hint: '点击钟体开始演奏', stageLabel: '可敲击的曾侯乙编钟', scaleLabel: '编钟音阶' },
    qing: { seal: '磬', sub: '曾侯乙编磬 · 模拟演奏', hint: '点击磬体或琴键开始演奏', stageLabel: '可敲击的曾侯乙编磬', scaleLabel: '编磬音阶' }
  };

  let instrument = 'bell';
  let bellMode = 'zheng';
  let selectedItem = null;
  let noticeTimer = null;
  let audioContext = null;

  function syncVirtualLandscape() {
    const root = document.documentElement;
    root.style.setProperty('--virtual-landscape-width', `${window.innerHeight}px`);
    root.style.setProperty('--virtual-landscape-height', `${window.innerWidth}px`);
  }

  function preferLandscape() {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(function () { /* CSS virtual landscape is the fallback. */ });
    }
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
  }

  function ensureAudio(kind) {
    const source = audioSources[kind];
    if (window[source.global]) return Promise.resolve(window[source.global]);
    if (!source.promise) {
      source.promise = new Promise(function (resolve, reject) {
        const script = document.createElement('script');
        script.src = source.file;
        script.onload = function () { resolve(window[source.global]); };
        script.onerror = function () { reject(new Error('音频素材加载失败')); };
        document.body.appendChild(script);
      });
    }
    return source.promise;
  }

  function audioKeyOf(item) {
    if (instrument === 'bell') return `${item.id}_${bellMode === 'zheng' ? '正鼓音' : '侧鼓音'}`;
    return item.id;
  }

  async function playItem(item) {
    if (!AudioContextClass || !item) return false;
    let table;
    try {
      table = await ensureAudio(instrument);
    } catch (error) {
      return false;
    }
    const key = audioKeyOf(item);
    const encoded = table && table[key];
    if (!encoded) return false;

    if (!audioContext) audioContext = new AudioContextClass();
    if (audioContext.state === 'suspended') await audioContext.resume();

    let buffer = decodedAudio.get(key);
    if (!buffer) {
      buffer = await audioContext.decodeAudioData(base64ToBytes(encoded));
      decodedAudio.set(key, buffer);
    }

    while (activeSources.length >= 12) {
      const oldest = activeSources.shift();
      try { oldest.stop(); } catch (error) { /* It may already have ended. */ }
    }

    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    gain.gain.value = 0.82;
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(audioContext.destination);
    activeSources.push(source);
    source.addEventListener('ended', function () {
      const index = activeSources.indexOf(source);
      if (index >= 0) activeSources.splice(index, 1);
    });
    source.start();
    return true;
  }

  function stopAllSound() {
    while (activeSources.length) {
      const source = activeSources.shift();
      try { source.stop(); } catch (error) { /* It may already have ended. */ }
    }
  }

  function midiOf(note) {
    const match = String(note || '').match(/^([A-G]#?)(-?\d+)$/);
    return match ? (Number(match[2]) + 1) * 12 + noteNames.indexOf(match[1]) : null;
  }

  function noteFromMidi(midi) {
    return `${noteNames[midi % 12]}${Math.floor(midi / 12) - 1}`;
  }

  function currentMap() {
    return instrument === 'bell' ? window.BELL_MAP : window.QING_MAP;
  }

  function findItem(id) {
    return currentMap().find(function (entry) { return entry.id === id; }) || null;
  }

  function itemMidi(item) {
    if (!item) return null;
    if (instrument === 'bell') return midiOf(bellMode === 'zheng' ? item.zheng : item.side);
    return item.midi === null || item.midi === undefined ? null : item.midi;
  }

  function itemNote(item) {
    if (!item) return '';
    return instrument === 'bell' ? (bellMode === 'zheng' ? item.zheng : item.side) : item.note;
  }

  function itemScaleName(item) {
    if (!item) return '';
    return instrument === 'bell' ? (bellMode === 'zheng' ? item.zhengName : item.sideName) : item.gu;
  }

  function itemPartText(item) {
    if (instrument === 'bell') return bellMode === 'zheng' ? '正鼓音' : '侧鼓音';
    if (item.midi === null) return '编外挂位';
    return item.layer === '上' ? '上层组磬' : '下层编磬';
  }

  function isUpperLayer(item) {
    return instrument === 'qing' && item.layer === '上';
  }

  function qingPlayable(item) {
    return Boolean(item && item.audio && !isUpperLayer(item));
  }

  function itemForMidi(midi) {
    if (instrument === 'bell') {
      const field = bellMode === 'zheng' ? 'zheng' : 'side';
      return currentMap().find(function (entry) { return midiOf(entry[field]) === midi; }) || null;
    }
    const matches = currentMap().filter(function (entry) { return entry.midi === midi; });
    return matches.find(qingPlayable) || matches.find(function (entry) { return !isUpperLayer(entry); }) || matches[0] || null;
  }

  function renderPiano() {
    const whiteNotes = [];
    for (let midi = 36; midi <= 98; midi += 1) {
      if (![1, 3, 6, 8, 10].includes(midi % 12)) {
        whiteNotes.push(midi);
        piano.insertAdjacentHTML('beforeend', `<span class="piano-key" data-midi="${midi}"><span>${noteFromMidi(midi)}</span></span>`);
      }
    }
    for (let midi = 37; midi <= 97; midi += 1) {
      if (![1, 3, 6, 8, 10].includes(midi % 12)) continue;
      const priorWhiteNotes = whiteNotes.filter(function (value) { return value < midi; }).length;
      piano.insertAdjacentHTML('beforeend', `<span class="piano-black" data-midi="${midi}" style="left:${(priorWhiteNotes / whiteNotes.length) * 100}%"></span>`);
    }
  }

  function markMappedKeys() {
    piano.querySelectorAll('[data-midi]').forEach(function (key) {
      key.classList.remove('mapped', 'playable');
    });
    if (instrument !== 'qing') return;
    const mapped = new Set(window.QING_MAP.filter(function (item) { return item.midi !== null; }).map(function (item) { return item.midi; }));
    const playable = new Set(window.QING_MAP.filter(qingPlayable).map(function (item) { return item.midi; }));
    piano.querySelectorAll('[data-midi]').forEach(function (key) {
      const midi = Number(key.dataset.midi);
      key.classList.toggle('mapped', mapped.has(midi));
      key.classList.toggle('playable', playable.has(midi));
    });
  }

  function bellHitsHtml() {
    return window.BELL_MAP.map(function (item) {
      const zhengLabel = `${item.zheng || '无音名'}${item.zhengName ? `（${item.zhengName}）` : ''}`;
      const sideLabel = `${item.side || '无音名'}${item.sideName ? `（${item.sideName}）` : ''}`;
      return `<button type="button" class="strike" data-hit="${item.id}" aria-label="${item.id}，正鼓音${zhengLabel}，侧鼓音${sideLabel}"></button>`;
    }).join('');
  }

  function qingHitsHtml() {
    return window.QING_MAP.map(function (item) {
      const state = item.midi === null ? 'no-data' : (item.audio ? 'has-audio' : 'no-audio');
      const layer = isUpperLayer(item) ? ' layer-upper' : '';
      const ariaLabel = item.midi === null
        ? `${item.id}，未列入复原编列`
        : `${item.id}，现代音阶${item.note}，${item.gu}${item.audio ? '' : '，暂缺音频'}`;
      return `<button type="button" class="strike ${state}${layer}" data-hit="${item.id}" aria-label="${ariaLabel}"></button>`;
    }).join('');
  }

  function renderHits() {
    stage.querySelectorAll('.strike').forEach(function (node) { node.remove(); });
    stage.insertAdjacentHTML('beforeend', instrument === 'bell' ? bellHitsHtml() : qingHitsHtml());
  }

  function locatorY(item, width, height, xPercent) {
    const xLine = xPercent / 100 * locatorImageSize.width;
    const lines = item.y < 60 ? locatorLines.middle : locatorLines.lower;
    const line = lines.find(function (entry) { return xLine < entry.max; }) || lines[lines.length - 1];
    return (line.m * xLine + line.b) / locatorImageSize.height * height;
  }

  function defaultHitPoint(item, width, height) {
    const xPercent = hitXPercentOverrides[item.id] === undefined ? item.x : hitXPercentOverrides[item.id];
    return {
      x: xPercent / 100 * width,
      y: item.y < 20 ? 0.3 * height : locatorY(item, width, height, xPercent)
    };
  }

  function syncBellHits() {
    if (!bellImage.naturalWidth || !stage.clientWidth || !stage.clientHeight) return;
    const sideSafe = Math.max(40, stage.clientWidth * 0.075);
    const safe = { left: sideSafe, right: sideSafe, top: 36, bottom: 4 };
    const availableWidth = Math.max(1, stage.clientWidth - safe.left - safe.right);
    const availableHeight = Math.max(1, stage.clientHeight - safe.top - safe.bottom);
    const scale = Math.min(availableWidth / bellContentBounds.width, availableHeight / bellContentBounds.height);
    const contentWidth = bellContentBounds.width * scale;
    const contentHeight = bellContentBounds.height * scale;
    const offsetX = safe.left + (availableWidth - contentWidth) / 2 - bellContentBounds.x * scale;
    const offsetY = safe.top + (availableHeight - contentHeight) / 2 - bellContentBounds.y * scale;

    bellImage.style.width = `${bellImage.naturalWidth * scale}px`;
    bellImage.style.height = `${bellImage.naturalHeight * scale}px`;
    bellImage.style.left = `${offsetX}px`;
    bellImage.style.top = `${offsetY}px`;

    stage.querySelectorAll('.strike').forEach(function (button) {
      const item = findItem(button.dataset.hit);
      if (!item) return;
      const point = defaultHitPoint(item, hitImageSize.width, hitImageSize.height);
      button.style.left = `${offsetX + point.x * scale}px`;
      button.style.top = `${offsetY + point.y * scale}px`;
    });
  }

  function syncQingHits() {
    if (!qingImage.naturalWidth || !stage.clientWidth || !stage.clientHeight) return;
    const safe = { left: 30, right: 30, top: 30, bottom: 8 };
    const availableWidth = Math.max(1, stage.clientWidth - safe.left - safe.right);
    const availableHeight = Math.max(1, stage.clientHeight - safe.top - safe.bottom);
    const scale = Math.min(availableWidth / qingImage.naturalWidth, availableHeight / qingImage.naturalHeight);
    const displayWidth = qingImage.naturalWidth * scale;
    const displayHeight = qingImage.naturalHeight * scale;
    const offsetX = safe.left + (availableWidth - displayWidth) / 2;
    const offsetY = safe.top + (availableHeight - displayHeight) / 2;

    qingImage.style.width = `${displayWidth}px`;
    qingImage.style.height = `${displayHeight}px`;
    qingImage.style.left = `${offsetX}px`;
    qingImage.style.top = `${offsetY}px`;

    stage.querySelectorAll('.strike').forEach(function (button) {
      const item = findItem(button.dataset.hit);
      if (!item) return;
      button.style.left = `${offsetX + item.x / 100 * displayWidth}px`;
      button.style.top = `${offsetY + item.y / 100 * displayHeight}px`;
    });
  }

  function syncHits() {
    if (instrument === 'bell') syncBellHits();
    else syncQingHits();
  }

  function clearPiano() {
    piano.querySelectorAll('.active').forEach(function (key) { key.classList.remove('active'); });
  }

  function setNotice(text) {
    clearTimeout(noticeTimer);
    notice.textContent = text || '';
    notice.classList.toggle('show', Boolean(text));
    if (text) noticeTimer = window.setTimeout(function () { notice.classList.remove('show'); }, 4200);
  }

  function showNotice(item) {
    if (instrument === 'bell') {
      setNotice(item && item.id === '下二6' ? '镈钟为楚惠王赠予曾侯乙的礼器，未列入实用音阶序列' : '');
      return;
    }
    if (item.midi === null) {
      setNotice(`${item.id} 为编外挂位，暂未列入复原编列十二块组磬`);
    } else if (!item.audio) {
      setNotice(`${item.id} 属上层组磬，暂缺音频素材，此处展示其现代音阶与编磬音阶`);
    } else {
      setNotice('');
    }
  }

  function updateReadout(item) {
    clearPiano();
    if (!item) {
      readout.classList.remove('has-selection');
      readout.querySelector('.tone-id').textContent = '未选中';
      readout.querySelector('strong').textContent = '现代音阶：—';
      readout.querySelector('.tone-name').textContent = `${instrumentMeta[instrument].scaleLabel}：—`;
      return;
    }
    readout.classList.add('has-selection');
    const midi = itemMidi(item);
    const key = midi === null ? null : piano.querySelector(`[data-midi="${midi}"]`);
    if (key) key.classList.add('active');
    readout.querySelector('.tone-id').textContent = `${item.id} · ${itemPartText(item)}`;
    readout.querySelector('strong').textContent = `现代音阶：${itemNote(item) || '—'}`;
    readout.querySelector('.tone-name').textContent = `${instrumentMeta[instrument].scaleLabel}：${itemScaleName(item) || '—'}`;
  }

  function flashKey(key) {
    if (!key) return;
    key.classList.add('active');
    window.setTimeout(function () { key.classList.remove('active'); }, 420);
  }

  function pulse(button) {
    button.classList.remove('active');
    void button.offsetWidth;
    button.classList.add('active');
    window.setTimeout(function () { button.classList.remove('active'); }, 580);
  }

  function strike(button) {
    const item = findItem(button.dataset.hit);
    if (!item) return;
    stageHint.classList.add('hidden');
    selectedItem = item;
    pulse(button);
    updateReadout(item);
    showNotice(item);
    playItem(item).then(function (played) {
      if (!played && instrument === 'qing' && item.audio) {
        readout.querySelector('strong').textContent = '声音加载失败，请重试';
      }
    }).catch(function () {
      readout.querySelector('strong').textContent = '声音加载失败，请重试';
    });
  }

  function playFromPiano(key) {
    const midi = Number(key.dataset.midi);
    const item = itemForMidi(midi);
    stageHint.classList.add('hidden');
    if (!item) {
      selectedItem = null;
      updateReadout(null);
      flashKey(key);
      setNotice(`${noteFromMidi(midi)} 不在${instrument === 'bell' ? '编钟' : '编磬'}音域内，无对应${instrument === 'bell' ? '钟体' : '磬块'}`);
      return;
    }
    selectedItem = item;
    const button = stage.querySelector(`[data-hit="${item.id}"]`);
    if (button) pulse(button);
    updateReadout(item);
    showNotice(item);
    playItem(item).then(function (played) {
      if (!played) {
        setNotice(`${item.id} 暂无音频素材，此处仅指示音高`);
        flashKey(key);
      }
    }).catch(function () {
      setNotice('声音加载失败，请重试');
    });
  }

  function switchInstrument(kind) {
    if (!instrumentMeta[kind] || kind === instrument) return;
    stopAllSound();
    instrument = kind;
    document.body.dataset.instrument = kind;
    selectedItem = null;

    const meta = instrumentMeta[kind];
    brandSeal.textContent = meta.seal;
    brandSub.textContent = meta.sub;
    stageHint.textContent = meta.hint;
    stageHint.classList.remove('hidden');
    stage.setAttribute('aria-label', meta.stageLabel);

    bellImage.hidden = kind !== 'bell';
    qingImage.hidden = kind !== 'qing';

    instrumentToggle.querySelectorAll('button').forEach(function (node) {
      const active = node.dataset.instrument === kind;
      node.classList.toggle('active', active);
      node.setAttribute('aria-pressed', String(active));
    });

    setNotice('');
    updateReadout(null);
    renderHits();
    syncHits();
    markMappedKeys();
    ensureAudio(kind).catch(function () { /* 用户再次点击时会重新尝试加载。 */ });
  }

  syncVirtualLandscape();
  renderPiano();
  renderHits();
  markMappedKeys();
  syncHits();
  ensureAudio('bell').catch(function () { /* 忽略预加载失败。 */ });

  bellImage.addEventListener('load', function () { if (instrument === 'bell') syncBellHits(); }, { once: true });
  qingImage.addEventListener('load', function () { if (instrument === 'qing') syncQingHits(); }, { once: true });
  if (bellImage.complete) syncBellHits();

  stage.addEventListener('pointerdown', function (event) {
    preferLandscape();
    const button = event.target.closest('[data-hit]');
    if (!button) return;
    event.preventDefault();
    strike(button);
  });

  piano.addEventListener('pointerdown', function (event) {
    preferLandscape();
    const key = event.target.closest('[data-midi]');
    if (!key) return;
    event.preventDefault();
    playFromPiano(key);
  });

  instrumentToggle.addEventListener('click', function (event) {
    preferLandscape();
    const button = event.target.closest('[data-instrument]');
    if (!button) return;
    switchInstrument(button.dataset.instrument);
  });

  modeToggle.addEventListener('click', function (event) {
    preferLandscape();
    const button = event.target.closest('[data-mode]');
    if (!button) return;
    bellMode = button.dataset.mode;
    modeToggle.querySelectorAll('button').forEach(function (node) {
      const active = node === button;
      node.classList.toggle('active', active);
      node.setAttribute('aria-pressed', String(active));
    });
    updateReadout(selectedItem);
  });

  window.addEventListener('resize', function () { syncVirtualLandscape(); syncHits(); });
  window.addEventListener('orientationchange', function () { window.setTimeout(function () { syncVirtualLandscape(); syncHits(); }, 120); });
})();
