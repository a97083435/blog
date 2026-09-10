/* ============================================================
 * Qingyu'Blog · 全站底部音乐播放器（阶段二）
 * ------------------------------------------------------------
 * 依赖：/api/music 公开接口（返回 { ok, music: [...] }）
 *       与 app.js 共用主题 CSS 变量（--card/--fg/--accent 等），自动适配明暗与主题色
 * 行为：
 *   · 底部常驻播放条：封面/歌名/歌手 · 上一首/播放暂停/下一首 · 进度条 · 时间 · 音量 · 播放列表
 *   · 播放列表抽屉：点击切换曲目，当前曲目高亮
 *   · 记忆上次播放（曲目 + 进度 + 音量），刷新后恢复但不自动播放
 *   · 后台路由（/admin、/write、编辑页）自动隐藏播放器
 *   · 无音乐或接口失败时完全隐藏
 * ============================================================ */
(function () {
  'use strict';
  if (window.__musicPlayer) return;

  var ICONS = {
    music: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    play: '<svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4.5v15l13-7.5z"/></svg>',
    pause: '<svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4.5h3.4v15H7zM13.6 4.5H17v15h-3.4z"/></svg>',
    prev: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5v14M19 5l-9 7 9 7z"/></svg>',
    next: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 5v14M5 5l9 7-9 7z"/></svg>',
    volume: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
    list: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>',
    close: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5l14 14M19 5L5 19"/></svg>'
  };
  function icon(name, size) { return ICONS[name] || ''; }

  var tracks = [];
  var currentIndex = -1;
  var playing = false;
  var seeking = false;
  var audio = new Audio();
  var root, barPlayBtn, seekInput, volInput, curTimeEl, durTimeEl, drawer, drawerList, barTitle, barArtist, barCover;
  var VOL_KEY = 'qy.music.volume';
  var LAST_KEY = 'qy.music.last';
  var visible = false;

  /* ---------- 工具 ---------- */
  function tt(key) {
    try { return window.__i18n && window.__i18n.t ? window.__i18n.t(key) : key; } catch (e) { return key; }
  }
  function fmtTime(s) {
    if (!isFinite(s) || s < 0) return '0:00';
    var m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isBackstagePath(p) {
    p = String(p == null ? location.pathname : p);
    if (p.indexOf('/admin') === 0 || p === '/write') return true;
    var m = p.match(/^\/posts\/[^/]+\/(edit)$/);
    return !!m;
  }
  function currentPath() {
    if (location.hash && location.hash.indexOf('#/') === 0) return location.hash.slice(1);
    return location.pathname;
  }

  /* ---------- DOM ---------- */
  function buildDOM() {
    root = document.createElement('div');
    root.id = 'musicPlayer';
    root.className = 'mp-root';
    root.innerHTML =
      '<div class="mp-bar">' +
        '<div class="mp-info">' +
          '<span class="mp-cover" id="mpCover">' + icon('music') + '</span>' +
          '<div class="mp-meta"><div class="mp-title" id="mpTitle">' + tt('player.none') + '</div>' +
          '<div class="mp-artist" id="mpArtist">—</div></div>' +
        '</div>' +
        '<div class="mp-center">' +
          '<div class="mp-controls">' +
            '<button type="button" class="mp-btn" id="mpPrev" title="' + esc(tt('player.prev')) + '" aria-label="' + esc(tt('player.prev')) + '">' + icon('prev') + '</button>' +
            '<button type="button" class="mp-btn mp-play" id="mpPlay" title="' + esc(tt('player.play')) + '" aria-label="' + esc(tt('player.play')) + '">' + icon('play') + '</button>' +
            '<button type="button" class="mp-btn" id="mpNext" title="' + esc(tt('player.next')) + '" aria-label="' + esc(tt('player.next')) + '">' + icon('next') + '</button>' +
          '</div>' +
          '<div class="mp-progress">' +
            '<span class="mp-time" id="mpCur">0:00</span>' +
            '<input type="range" class="mp-seek" id="mpSeek" min="0" max="1000" value="0" step="1" aria-label="' + esc(tt('player.seek')) + '">' +
            '<span class="mp-time" id="mpDur">0:00</span>' +
          '</div>' +
        '</div>' +
        '<div class="mp-right">' +
          '<div class="mp-vol">' +
            '<button type="button" class="mp-btn" id="mpVolBtn" title="' + esc(tt('player.volume')) + '" aria-label="' + esc(tt('player.volume')) + '">' + icon('volume') + '</button>' +
            '<input type="range" class="mp-vol-slider" id="mpVol" min="0" max="100" step="1" value="80" aria-label="' + esc(tt('player.volume')) + '">' +
          '</div>' +
          '<button type="button" class="mp-btn" id="mpListBtn" title="' + esc(tt('player.playlist')) + '" aria-label="' + esc(tt('player.playlist')) + '">' + icon('list') + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="mp-drawer" id="mpDrawer" aria-hidden="true">' +
        '<div class="mp-drawer-head">' +
          '<span class="mp-drawer-title">' + esc(tt('player.playlist')) + '</span>' +
          '<span class="mp-drawer-count" id="mpCount"></span>' +
          '<button type="button" class="mp-btn mp-drawer-close" id="mpDrawerClose" aria-label="' + esc(tt('player.close')) + '">' + icon('close') + '</button>' +
        '</div>' +
        '<div class="mp-drawer-list" id="mpDrawerList"></div>' +
      '</div>';
    document.body.appendChild(root);
    barPlayBtn = document.getElementById('mpPlay');
    seekInput = document.getElementById('mpSeek');
    volInput = document.getElementById('mpVol');
    curTimeEl = document.getElementById('mpCur');
    durTimeEl = document.getElementById('mpDur');
    drawer = document.getElementById('mpDrawer');
    drawerList = document.getElementById('mpDrawerList');
    barTitle = document.getElementById('mpTitle');
    barArtist = document.getElementById('mpArtist');
    barCover = document.getElementById('mpCover');

    document.getElementById('mpPrev').addEventListener('click', function () { step(-1); });
    document.getElementById('mpNext').addEventListener('click', function () { step(1); });
    barPlayBtn.addEventListener('click', toggle);
    document.getElementById('mpListBtn').addEventListener('click', toggleDrawer);
    document.getElementById('mpDrawerClose').addEventListener('click', closeDrawer);
    document.getElementById('mpVolBtn').addEventListener('click', function () { toggleMute(); });

    seekInput.addEventListener('input', function () { seeking = true; });
    seekInput.addEventListener('change', function () {
      if (audio.duration) {
        audio.currentTime = (seekInput.value / 1000) * audio.duration;
        updateSeekUI();
      }
      seeking = false;
    });
    volInput.addEventListener('input', function () {
      audio.volume = volInput.value / 100;
      audio.muted = false;
      try { localStorage.setItem(VOL_KEY, volInput.value); } catch (e) {}
    });
    // 点击抽屉遮罩（根区域）关闭
    drawer.addEventListener('click', function (e) { if (e.target === drawer) closeDrawer(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
  }

  /* ---------- 播放控制 ---------- */
  function bindAudio() {
    audio.addEventListener('timeupdate', function () {
      if (!seeking && audio.duration) {
        seekInput.value = Math.round((audio.currentTime / audio.duration) * 1000);
        curTimeEl.textContent = fmtTime(audio.currentTime);
      }
      saveProgress();
    });
    audio.addEventListener('loadedmetadata', function () {
      durTimeEl.textContent = fmtTime(audio.duration);
      // 恢复记忆进度（仅初始化/切歌后非用户拖动）
      var last = loadLast();
      if (last && last.i === currentIndex && last.t > 0 && Math.abs(audio.currentTime) < 0.01 && !playing) {
        try { audio.currentTime = Math.min(last.t, audio.duration - 0.5); } catch (e) {}
      }
      updateSeekUI();
    });
    audio.addEventListener('play', function () { playing = true; setPlayIcon(true); });
    audio.addEventListener('pause', function () { playing = false; setPlayIcon(false); });
    audio.addEventListener('ended', function () { next(); });
    audio.addEventListener('error', function () {
      // 加载失败：尝试下一首，否则停止
      if (currentIndex >= 0 && tracks.length > 1) next();
      else stop();
    });
  }
  function loadLast() {
    try { var v = JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); if (v && typeof v.i === 'number') return v; } catch (e) {}
    return null;
  }
  function saveProgress() {
    if (currentIndex < 0) return;
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ i: currentIndex, t: audio.currentTime || 0 })); } catch (e) {}
  }
  function clearLast() {
    try { localStorage.removeItem(LAST_KEY); } catch (e) {}
  }
  function setPlayIcon(isPlaying) {
    barPlayBtn.innerHTML = isPlaying ? icon('pause') : icon('play');
    barPlayBtn.setAttribute('aria-label', tt(isPlaying ? 'player.pause' : 'player.play'));
  }
  function playTrack(i, autoplay) {
    if (i < 0 || i >= tracks.length) return;
    currentIndex = i;
    var tr = tracks[i];
    audio.src = tr.url;
    barTitle.textContent = tr.title || tt('player.unknown');
    barArtist.textContent = tr.artist || '—';
    if (tr.cover) {
      barCover.innerHTML = '<img src="' + esc(tr.cover) + '" alt="" loading="lazy">';
    } else {
      barCover.innerHTML = icon('music');
    }
    curTimeEl.textContent = '0:00';
    durTimeEl.textContent = '0:00';
    seekInput.value = 0;
    if (autoplay !== false) {
      var p = audio.play();
      if (p && p.catch) p.catch(function () { /* 自动播放被浏览器拦截：保持暂停 */ });
    } else {
      try { audio.load(); } catch (e) {}
    }
    renderList();
    show();
  }
  function toggle() {
    if (currentIndex < 0) {
      if (tracks.length) playTrack(0, true);
      return;
    }
    if (audio.paused) {
      var p = audio.play();
      if (p && p.catch) p.catch(function () {});
    } else {
      audio.pause();
    }
  }
  function step(dir) {
    if (!tracks.length) return;
    var i = currentIndex < 0 ? 0 : currentIndex + dir;
    if (i < 0) i = tracks.length - 1;
    if (i >= tracks.length) i = 0;
    playTrack(i, true);
  }
  function next() {
    if (!tracks.length) return;
    if (currentIndex < tracks.length - 1) playTrack(currentIndex + 1, true);
    else stop();
  }
  function stop() {
    try { audio.pause(); audio.removeAttribute('src'); } catch (e) {}
    playing = false;
    setPlayIcon(false);
    curTimeEl.textContent = '0:00';
    seekInput.value = 0;
    clearLast();
  }
  function toggleMute() {
    audio.muted = !audio.muted;
  }
  function updateSeekUI() {
    if (audio.duration) {
      seekInput.value = Math.round((audio.currentTime / audio.duration) * 1000);
      curTimeEl.textContent = fmtTime(audio.currentTime);
    }
  }

  /* ---------- 播放列表抽屉 ---------- */
  function renderList() {
    if (!drawerList) return;
    var count = document.getElementById('mpCount');
    if (count) count.textContent = tracks.length;
    if (!tracks.length) {
      drawerList.innerHTML = '<div class="mp-empty">' + esc(tt('player.empty')) + '</div>';
      return;
    }
    drawerList.innerHTML = tracks.map(function (tr, i) {
      var active = i === currentIndex;
      return '<button type="button" class="mp-item' + (active ? ' active' : '') + '" data-i="' + i + '">' +
        '<span class="mp-item-cover">' + (tr.cover ? '<img src="' + esc(tr.cover) + '" alt="" loading="lazy">' : icon('music', 15)) + '</span>' +
        '<span class="mp-item-meta"><span class="mp-item-title">' + esc(tr.title || tt('player.unknown')) + '</span>' +
        '<span class="mp-item-artist">' + esc(tr.artist || '—') + '</span></span>' +
        '<span class="mp-item-state">' + (active ? (playing ? icon('volume', 15) : '<span class="mp-eq"><i></i><i></i><i></i></span>') : '') + '</span>' +
        '</button>';
    }).join('');
    var items = drawerList.querySelectorAll('.mp-item');
    for (var k = 0; k < items.length; k++) {
      items[k].addEventListener('click', function () {
        var idx = parseInt(this.getAttribute('data-i'), 10);
        playTrack(idx, true);
        if (window.innerWidth < 720) closeDrawer();
      });
    }
  }
  function openDrawer() {
    if (!root || !drawer) return;
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('mp-drawer-open');
    renderList();
  }
  function closeDrawer() {
    if (!drawer) return;
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('mp-drawer-open');
  }
  function toggleDrawer() {
    if (drawer.classList.contains('open')) closeDrawer(); else openDrawer();
  }

  /* ---------- 显示控制 ---------- */
  function show() {
    if (visible) return;
    visible = true;
    root.classList.add('mp-on');
    document.body.classList.add('mp-on');
  }
  function syncRoute() {
    var hide = isBackstagePath(currentPath());
    if (root) root.classList.toggle('mp-hidden', hide);
    if (hide) closeDrawer();
  }

  /* ---------- 初始化 ---------- */
  async function init() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', init); return; }
    buildDOM();
    bindAudio();
    // 音量恢复
    var vol = 80;
    try { var sv = parseInt(localStorage.getItem(VOL_KEY), 10); if (isFinite(sv) && sv >= 0 && sv <= 100) vol = sv; } catch (e) {}
    audio.volume = vol / 100;
    if (volInput) volInput.value = vol;
    syncRoute();

    try {
      var res = await fetch('/api/music?_=' + Date.now());
      if (!res.ok) return;
      var d = await res.json();
      if (!d || d.ok !== true || !d.music) return;
      tracks = (d.music || []).filter(function (x) { return x && x.url; });
      if (!tracks.length) return;
      var last = loadLast();
      if (last && last.i >= 0 && last.i < tracks.length) {
        playTrack(last.i, false); // 恢复曲目与进度，不自动播放
      } else {
        renderList();
        show();
      }
    } catch (e) { /* 静默：接口不可用时隐藏播放器 */ }
  }

  // 路由变化（app.js 在每次 route() 后派发）
  window.addEventListener('qy:route', syncRoute);

  window.__musicPlayer = {
    init: init,
    sync: syncRoute,
    toggleDrawer: toggleDrawer,
    closeDrawer: closeDrawer,
    playTrack: playTrack,
    toggle: toggle
  };
  init();
})();
