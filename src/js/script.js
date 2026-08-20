(() => {
  const wallEl = document.getElementById('wall');
  const wallEmptyEl = document.getElementById('wallEmpty');
  const wallCountEl = document.getElementById('wallCount');

  const overlay = document.getElementById('composerOverlay');
  const openBtns = [document.getElementById('openComposerTop'), document.getElementById('openComposerHero')];
  const closeBtn = document.getElementById('closeComposer');

  const form = document.getElementById('messageForm');
  const recipientInput = document.getElementById('recipientInput');
  const messageInput = document.getElementById('messageInput');
  const messageCount = document.getElementById('messageCount');
  const submitBtn = document.getElementById('submitMessage');
  const errorEl = document.getElementById('composerError');

  const songSearchInput = document.getElementById('songSearchInput');
  const songResultsEl = document.getElementById('songResults');
  const songPickedEl = document.getElementById('songPicked');
  const songPickedArt = document.getElementById('songPickedArt');
  const songPickedTitle = document.getElementById('songPickedTitle');
  const songPickedArtist = document.getElementById('songPickedArtist');
  const songPickedRemove = document.getElementById('songPickedRemove');

  const player = document.getElementById('previewPlayer');

  let selectedSong = null;
  let searchDebounce = null;
  let activeTicket = null;

  const MESSAGE_MAX = 220;


  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function timeAgo(dateStr) {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  }

  function randomTapeAngle() {
    return `${(Math.random() * 10 - 5).toFixed(1)}deg`;
  }


  function renderMessage(d) {
    const note = document.createElement('article');
    note.className = 'note';
    note.style.setProperty('--tape-angle', randomTapeAngle());
    if (d._id) note.dataset.id = d._id;

    const hasSong = d.song_title && d.song_title.trim();

    note.innerHTML = `
      ${d.recipient ? `<p class="note__recipient">for ${escapeHtml(d.recipient)}</p>` : ''}
      <p class="note__message">${escapeHtml(d.message)}</p>
      <div class="note__interactions">
        <button class="note__react" type="button">
          <span aria-hidden="true">🫶</span>
          <span class="note__react-count">${d.reactions || 0}</span>
        </button>
        <button class="note__share" type="button" aria-label="Share this note">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="18" cy="5" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/>
            <circle cx="6" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/>
            <circle cx="18" cy="19" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/>
            <path d="M8.6 10.6l6.8-4.2M8.6 13.4l6.8 4.2" stroke="currentColor" stroke-width="1.8"/>
          </svg>
        </button>
      </div>
      <div class="note__footer">
        <div class="note__meta">
          <span class="note__time">${d.timestamp ? timeAgo(d.timestamp) : ''}</span>
          <button class="note__report" type="button">Report</button>
        </div>
        ${hasSong ? `
          <button class="ticket" type="button" data-preview="${d.preview_url || ''}">
            ${d.album_art ? `<img class="ticket__art" src="${escapeHtml(d.album_art)}" alt="" loading="lazy">` : ''}
            <span class="ticket__meta">
              <span class="ticket__song">${escapeHtml(d.song_title)}</span>
              <span class="ticket__artist">${escapeHtml(d.song_artist || '')}</span>
            </span>
            <span class="eq" aria-hidden="true"><span></span><span></span><span></span></span>
          </button>
        ` : ''}
      </div>
    `;

    const ticketBtn = note.querySelector('.ticket');
    if (ticketBtn) {
      ticketBtn.addEventListener('click', () => togglePreview(ticketBtn));
    }

    const reportBtn = note.querySelector('.note__report');
    if (reportBtn && d._id) {
      attachReportHandler(reportBtn, d._id);
    }

    const reactBtn = note.querySelector('.note__react');
    if (reactBtn && d._id) {
      attachReactionHandler(reactBtn, d._id);
    }

    const shareBtn = note.querySelector('.note__share');
    if (shareBtn) {
      attachShareHandler(shareBtn, d);
    }

    requestAnimationFrame(() => {
      const messageEl = note.querySelector('.note__message');
      if (messageEl && messageEl.scrollHeight > messageEl.clientHeight + 2) {
        const expandBtn = document.createElement('button');
        expandBtn.type = 'button';
        expandBtn.className = 'note__expand';
        expandBtn.textContent = 'Read more';
        expandBtn.addEventListener('click', () => {
          const expanding = !messageEl.classList.contains('is-expanded');
          messageEl.classList.toggle('is-expanded', expanding);
          expandBtn.textContent = expanding ? 'Show less' : 'Read more';
        });
        messageEl.insertAdjacentElement('afterend', expandBtn);
      }
    });

    return note;
  }

  function attachReportHandler(btn, messageId) {
    let confirming = false;
    let confirmTimeout = null;

    btn.addEventListener('click', async () => {
      if (btn.disabled) return;

      if (!confirming) {
        confirming = true;
        btn.textContent = 'Sure?';
        btn.classList.add('is-confirming');
        confirmTimeout = setTimeout(() => {
          confirming = false;
          btn.textContent = 'Report';
          btn.classList.remove('is-confirming');
        }, 3000);
        return;
      }

      clearTimeout(confirmTimeout);
      btn.disabled = true;
      btn.textContent = 'Reporting…';

      try {
        const res = await fetch(`/api/messages/${messageId}/report`, { method: 'POST' });
        if (!res.ok) throw new Error();
        btn.textContent = 'Reported';
        showToast("Thanks — we'll take a look.");
      } catch (err) {
        console.error('Report failed:', err);
        btn.textContent = 'Report';
        btn.disabled = false;
        confirming = false;
      }
    });
  }

  const REACTED_KEY = 'maximino_reacted_ids';

  function getReactedIds() {
    try {
      return new Set(JSON.parse(localStorage.getItem(REACTED_KEY) || '[]'));
    } catch (err) {
      return new Set();
    }
  }

  function rememberReacted(id) {
    const ids = getReactedIds();
    ids.add(id);
    try {
      localStorage.setItem(REACTED_KEY, JSON.stringify([...ids]));
    } catch (err) {
      // Storage full or blocked (private browsing) — reaction still went through server-side.
    }
  }

  function attachReactionHandler(btn, messageId) {
    const countEl = btn.querySelector('.note__react-count');

    if (getReactedIds().has(messageId)) {
      btn.classList.add('is-reacted');
      btn.disabled = true;
    }

    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true;

      try {
        const res = await fetch(`/api/messages/${messageId}/react`, { method: 'POST' });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (countEl && typeof data.reactions === 'number') {
          countEl.textContent = data.reactions;
        }
        btn.classList.add('is-reacted');
        rememberReacted(messageId);
      } catch (err) {
        console.error('Reaction failed:', err);
        btn.disabled = false;
      }
    });
  }

  const STORY_W = 1080;
  const STORY_H = 1920;

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return v && v.trim() ? v.trim() : fallback;
  }

  const STORY_PALETTES = [
    { bg: '#17181a', tape: '#7c4b6b', ticket: '#2c5b58', accent: '#3b7a76', brand: '#e3a83b' }, // midnight teal (site default)
    { bg: '#241722', tape: '#e3a83b', ticket: '#5c2f4a', accent: '#d4537e', brand: '#f4eedc' }, // plum + pink
    { bg: '#151f19', tape: '#c78f2b', ticket: '#204a34', accent: '#6fae7c', brand: '#e3a83b' }, // forest + gold
    { bg: '#231712', tape: '#3b7a76', ticket: '#5a3220', accent: '#d97a4a', brand: '#f4eedc' }, // rust + teal
    { bg: '#121a22', tape: '#c78f2b', ticket: '#1f3b52', accent: '#5a9bd8', brand: '#e3a83b' }, // navy + gold
    { bg: '#1f1416', tape: '#e3a83b', ticket: '#5c2320', accent: '#e2735f', brand: '#f4eedc' }  // maroon + coral
  ];

  function hexToRgba(hex, alpha) {
    const clean = hex.replace('#', '');
    const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
    const num = parseInt(full, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function pickPalette(d) {
    const seed = `${d._id || ''}|${d.song_title || ''}|${d.message || ''}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    }
    return STORY_PALETTES[Math.abs(hash) % STORY_PALETTES.length];
  }

  function loadImage(src, { crossOrigin } = {}) {
    return new Promise(resolve => {
      if (!src) { resolve(null); return; }
      const img = new Image();
      if (crossOrigin) img.crossOrigin = crossOrigin;
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function wrapCanvasText(ctx, text, maxWidth) {
    const words = text.split(/\s+/);
    const lines = [];
    let line = '';
    words.forEach(word => {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    });
    if (line) lines.push(line);
    return lines;
  }

  function fitMessageText(ctx, text, maxWidth, maxHeight) {
    let size = 96;
    const min = 46;
    let lines = [text];
    let lineHeight = size * 1.12;
    while (size >= min) {
      ctx.font = `700 ${size}px Caveat, cursive`;
      lines = wrapCanvasText(ctx, text, maxWidth);
      lineHeight = size * 1.12;
      if (lines.length * lineHeight <= maxHeight) break;
      size -= 4;
    }
    return { size, lines, lineHeight };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  function truncateToWidth(ctx, text, maxWidth) {
    if (!text) return '';
    if (ctx.measureText(text).width <= maxWidth) return text;
    let out = text;
    while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
      out = out.slice(0, -1);
    }
    return `${out}…`;
  }

  function noteShareUrl(d) {
    if (!d || !d._id) return `${window.location.origin}/wall`;
    return `${window.location.origin}/wall?note=${encodeURIComponent(d._id)}&play=1`;
  }

  async function buildStoryCard(d) {
    const canvas = document.createElement('canvas');
    canvas.width = STORY_W;
    canvas.height = STORY_H;
    const ctx = canvas.getContext('2d');

    const palette = pickPalette(d);
    const colors = {
      bg: palette.bg,
      paper: cssVar('--paper-1', '#f4eedc'),
      tape: palette.tape,
      teal: palette.accent,
      tealDark: palette.ticket,
      gold: palette.brand
    };

    if (document.fonts) {
      try {
        await Promise.all([
          document.fonts.load('700 96px Caveat'),
          document.fonts.load('600 46px Caveat'),
          document.fonts.load('600 38px "JetBrains Mono"'),
          document.fonts.load('400 32px "JetBrains Mono"'),
          document.fonts.load('400 28px "Work Sans"'),
          document.fonts.ready
        ]);
      } catch (err) {
      }
    }

    const pad = 84;

    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, STORY_W, STORY_H);

    ctx.save();
    ctx.translate(STORY_W / 2, 54);
    ctx.rotate((-4 * Math.PI) / 180);
    ctx.fillStyle = colors.tape;
    ctx.fillRect(-70, -16, 140, 34);
    ctx.restore();

    const logoImg = await loadImage('/assets/logo.png');
    let brandX = pad;
    if (logoImg) {
      const logoH = 56;
      const logoW = logoH * (logoImg.width / logoImg.height);
      ctx.drawImage(logoImg, pad, 128, logoW, logoH);
      brandX = pad + logoW + 18;
    }
    ctx.fillStyle = colors.gold;
    ctx.font = '600 46px Caveat, cursive';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillText('Maximino', brandX, 172);

    let cursorY = 260;

    if (d.recipient) {
      const label = `FOR ${d.recipient.toUpperCase()}`;
      ctx.font = '500 30px "JetBrains Mono", monospace';
      const pillW = ctx.measureText(label).width + 48;
      const pillH = 56;
      ctx.fillStyle = hexToRgba(colors.teal, 0.18);
      roundRect(ctx, pad, cursorY, pillW, pillH, pillH / 2);
      ctx.fill();
      ctx.strokeStyle = colors.teal;
      ctx.lineWidth = 1.5;
      roundRect(ctx, pad, cursorY, pillW, pillH, pillH / 2);
      ctx.stroke();
      ctx.fillStyle = colors.teal;
      ctx.textBaseline = 'middle';
      ctx.fillText(label, pad + 24, cursorY + pillH / 2 + 2);
      cursorY += pillH + 56;
    } else {
      cursorY += 20;
    }

    const hasSong = !!(d.song_title && d.song_title.trim());
    const ticketH = 190;
    const footerH = 90;
    const bottomReserved = footerH + (hasSong ? ticketH + 40 : 0) + 40;
    const messageMaxHeight = Math.max(200, STORY_H - cursorY - bottomReserved);
    const messageMaxWidth = STORY_W - pad * 2;

    const { size, lines, lineHeight } = fitMessageText(ctx, d.message, messageMaxWidth, messageMaxHeight);
    ctx.font = `700 ${size}px Caveat, cursive`;
    ctx.fillStyle = colors.paper;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    const blockHeight = lines.length * lineHeight;
    let textY = cursorY + Math.max(0, (messageMaxHeight - blockHeight) / 2) + size * 0.85;
    lines.forEach(line => {
      ctx.fillText(line, pad, textY);
      textY += lineHeight;
    });

    if (hasSong) {
      const ticketY = STORY_H - footerH - ticketH - 40;
      const ticketX = pad;
      const ticketW = STORY_W - pad * 2;

      ctx.fillStyle = colors.tealDark;
      roundRect(ctx, ticketX, ticketY, ticketW, ticketH, 20);
      ctx.fill();

      const artSize = ticketH - 40;
      const artX = ticketX + 20;
      const artY = ticketY + 20;

      const artImg = await loadImage(d.album_art, { crossOrigin: 'anonymous' });
      ctx.save();
      roundRect(ctx, artX, artY, artSize, artSize, 10);
      ctx.clip();
      if (artImg) {
        ctx.drawImage(artImg, artX, artY, artSize, artSize);
      } else {
        ctx.fillStyle = colors.teal;
        ctx.fillRect(artX, artY, artSize, artSize);
      }
      ctx.restore();

      const textX = artX + artSize + 28;
      const eqReserve = 70;
      const maxTextW = ticketX + ticketW - eqReserve - textX;

      ctx.fillStyle = colors.paper;
      ctx.font = '600 38px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(truncateToWidth(ctx, d.song_title, maxTextW), textX, ticketY + ticketH / 2 - 6);

      ctx.fillStyle = 'rgba(244, 238, 220, 0.72)';
      ctx.font = '400 32px "JetBrains Mono", monospace';
      ctx.fillText(truncateToWidth(ctx, d.song_artist || '', maxTextW), textX, ticketY + ticketH / 2 + 36);

      const eqX = ticketX + ticketW - 56;
      const eqY = ticketY + ticketH / 2;
      ctx.fillStyle = colors.paper;
      [10, 22, 15].forEach((h, i) => {
        ctx.fillRect(eqX + i * 13, eqY - h / 2, 7, h);
      });
    }

    ctx.fillStyle = 'rgba(244, 238, 220, 0.5)';
    ctx.font = '400 28px "Work Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const footerLabel = hasSong ? `${window.location.host}/wall — tap to listen` : `${window.location.host}/wall`;
    ctx.fillText(footerLabel, STORY_W / 2, STORY_H - 40);

    return new Promise(resolve => {
      canvas.toBlob(blob => resolve(blob), 'image/png', 0.95);
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  const META_APP_ID = '000000000000';

  const shareSheetOverlay = document.getElementById('shareSheetOverlay');
  const shareToInstagramBtn = document.getElementById('shareToInstagram');
  const shareToFacebookBtn = document.getElementById('shareToFacebook');
  const shareToMoreBtn = document.getElementById('shareToMore');
  const shareSheetCancelBtn = document.getElementById('shareSheetCancel');

  let pendingShareNote = null;
  let pendingShareBlob = null;

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS reports as Mac
  }

  function attachShareHandler(btn, d) {
    btn.addEventListener('click', () => openShareSheet(d, btn));
  }

  function openShareSheet(d, btn) {
    // Only iOS has a real "share straight to Stories" mechanism (the
    // instagram-stories:// / facebook-stories:// URL schemes). On Android
    // there's no way for a website to deep-link into a specific app, so the
    // Instagram/Facebook buttons would just open the exact same native share
    // sheet as "More options" — showing all three is misleading, not helpful.
    // Skip the custom picker there and go straight to the native share sheet.
    if (!isIOS()) {
      shareNote(btn, d);
      return;
    }

    if (!shareSheetOverlay) return;
    pendingShareNote = d;
    pendingShareBlob = null;
    shareSheetOverlay.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeShareSheet() {
    if (!shareSheetOverlay) return;
    shareSheetOverlay.hidden = true;
    document.body.style.overflow = '';
    pendingShareNote = null;
    pendingShareBlob = null;
    [shareToInstagramBtn, shareToFacebookBtn, shareToMoreBtn].forEach(btn => {
      if (!btn) return;
      btn.disabled = false;
      btn.classList.remove('is-loading');
    });
  }

  async function getPendingBlob() {
    if (pendingShareBlob) return pendingShareBlob;
    pendingShareBlob = await buildStoryCard(pendingShareNote);
    return pendingShareBlob;
  }

  if (shareSheetOverlay) {
    shareSheetCancelBtn.addEventListener('click', closeShareSheet);
    shareSheetOverlay.addEventListener('click', e => {
      if (e.target === shareSheetOverlay) closeShareSheet();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !shareSheetOverlay.hidden) closeShareSheet();
    });

    shareToInstagramBtn.addEventListener('click', () => handleStoryShare('instagram', shareToInstagramBtn));
    shareToFacebookBtn.addEventListener('click', () => handleStoryShare('facebook', shareToFacebookBtn));

    shareToMoreBtn.addEventListener('click', async () => {
      const d = pendingShareNote;
      const btn = shareToMoreBtn;
      if (!d || btn.disabled) return;
      btn.disabled = true;
      btn.classList.add('is-loading');
      closeShareSheet();
      await shareNote(btn, d);
    });
  }

  const STORY_SCHEMES = {
    instagram: 'instagram-stories://share',
    facebook: 'facebook-stories://share'
  };

  const APP_LABELS = { instagram: 'Instagram', facebook: 'Facebook' };

  async function handleStoryShare(target, btn) {
    if (!pendingShareNote || btn.disabled) return;
    btn.disabled = true;
    btn.classList.add('is-loading');

    let blob = null;
    try {
      blob = await getPendingBlob();
      if (!blob) throw new Error('Could not render the image.');

      if (isIOS()) {
        await shareToStoriesIOS(target, blob);
      } else {
        await shareToStoriesAndroid(target, blob);
      }
    } catch (err) {
      console.error(`${target} share failed:`, err);
      if (blob) downloadBlob(blob, 'maximino-note.png');
      showToast(`Couldn't open ${APP_LABELS[target]} directly — image saved, add it from your gallery.`);
    } finally {
      closeShareSheet();
    }
  }

  async function shareToStoriesIOS(target, blob) {
    if (!navigator.clipboard || !navigator.clipboard.write || typeof ClipboardItem === 'undefined') {
      throw new Error('Clipboard image write not supported on this browser.');
    }

    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);

    const url = `${STORY_SCHEMES[target]}?source_application=${META_APP_ID}`;

    const leftPage = new Promise(resolve => {
      const onHide = () => {
        document.removeEventListener('visibilitychange', onHide);
        resolve(true);
      };
      document.addEventListener('visibilitychange', onHide);
      setTimeout(() => {
        document.removeEventListener('visibilitychange', onHide);
        resolve(false);
      }, 1600);
    });

    window.location.href = url;

    const opened = await leftPage;
    if (!opened) {
      downloadBlob(blob, 'maximino-note.png');
      showToast(`${APP_LABELS[target]} not found — image saved instead.`);
    }
  }

  async function shareToStoriesAndroid(target, blob) {
    // Android has no public "share straight to Stories" URL scheme like iOS does,
    // and there's no reliable way to hand a blob to another app via intent:// —
    // that always forced a redundant download and, since the intent had no
    // resolvable action, sent people to the Play Store even with the app installed.
    // The native Web Share API is the right tool here: it hands the file straight
    // to the OS share sheet, which lists Instagram/Facebook as targets directly
    // (and surfaces "Add to Story" on versions that support it) — no download,
    // no Play Store detour.
    const file = new File([blob], 'maximino-note.png', { type: 'image/png' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Maximino' });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return; // user closed the share sheet — not an error
        throw err;
      }
    }

    // Very old/unsupported browsers: no way to hand off the file directly.
    downloadBlob(blob, 'maximino-note.png');
    showToast(`Image saved — open ${APP_LABELS[target]} and add it to your story from your gallery.`);
  }

  async function shareNote(btn, d) {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.classList.add('is-sharing');

    try {
      const blob = await buildStoryCard(d);
      if (!blob) throw new Error('Canvas produced no image data.');

      const file = new File([blob], 'maximino-note.png', { type: 'image/png' });
      const shareText = d.song_title
        ? `"${d.message}" — paired with "${d.song_title}" by ${d.song_artist || ''}`.trim()
        : `"${d.message}"`;
      const shareUrl = noteShareUrl(d);

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Maximino', text: shareText, url: shareUrl });
      } else {
        downloadBlob(blob, 'maximino-note.png');
        showToast('Image saved — add it to your story.');
      }
    } catch (err) {
      if (err.name === 'AbortError') {
      } else {
        console.error('Image share failed, falling back to a text share:', err);
        await legacyShare(d);
      }
    } finally {
      btn.disabled = false;
      btn.classList.remove('is-sharing');
    }
  }

  async function legacyShare(d) {
    const shareText = d.song_title
      ? `"${d.message}" — dedicated with "${d.song_title}" by ${d.song_artist || ''}`.trim()
      : `"${d.message}"`;
    const shareUrl = noteShareUrl(d);

    if (navigator.share) {
      try {
        await navigator.share({ title: 'Maximino', text: shareText, url: shareUrl });
      } catch (err) {
        if (err.name !== 'AbortError') console.error('Share failed:', err);
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(`${shareText} ${shareUrl}`);
      showToast('Copied to clipboard.');
    } catch (err) {
      console.error('Clipboard copy failed:', err);
    }
  }

  function togglePreview(ticketBtn) {
    const url = ticketBtn.dataset.preview;
    if (!url) return;

    if (activeTicket === ticketBtn && !player.paused) {
      player.pause();
      ticketBtn.classList.remove('is-playing');
      activeTicket = null;
      return;
    }

    if (activeTicket) activeTicket.classList.remove('is-playing');

    player.src = url;
    player.play().catch(() => {});
    ticketBtn.classList.add('is-playing');
    activeTicket = ticketBtn;
  }

  player.addEventListener('ended', () => {
    if (activeTicket) activeTicket.classList.remove('is-playing');
    activeTicket = null;
  });

  const loadMoreBtn = document.getElementById('loadMoreBtn');
  let oldestTimestamp = null;
  let wallHasMore = false;

async function fetchWallPage(before) {
  const params = new URLSearchParams({ limit: '20' });

  if (before) {
    params.set('before', before);
  }

  const res = await fetch(`/api/messages?${params.toString()}`);

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to load messages (${res.status})`);
  }

  return res.json();
}

  async function refreshWallCount() {
    if (!wallCountEl) return;
    try {
      const res = await fetch('/api/messages/count');
      const data = await res.json();
      if (typeof data.count === 'number') {
        wallCountEl.textContent = `${data.count} pinned`;
      }
    } catch (err) {
      console.error('Failed to load wall count:', err);
    }
  }

  async function loadWall() {
    if (!wallEl) return; 

    try {
      const data = await fetchWallPage();
      const items = Array.isArray(data.items) ? data.items : [];

      wallEl.innerHTML = '';

      if (items.length === 0) {
        wallEmptyEl.hidden = false;
        if (loadMoreBtn) loadMoreBtn.hidden = true;
        await refreshWallCount();
        return;
      }

      wallEmptyEl.hidden = true;
      items.forEach(d => wallEl.appendChild(renderMessage(d)));

      oldestTimestamp = items[items.length - 1].timestamp;
      wallHasMore = !!data.hasMore;
      if (loadMoreBtn) loadMoreBtn.hidden = !wallHasMore;

      await refreshWallCount();
    } catch (err) {
      console.error('Failed to load wall:', err);
      wallEmptyEl.hidden = false;
      wallEmptyEl.textContent = "Couldn't load the wall right now. Try refreshing.";
    }
  }

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', async () => {
      if (!wallHasMore || loadMoreBtn.disabled) return;

      loadMoreBtn.disabled = true;
      loadMoreBtn.textContent = 'Loading…';

      try {
        const data = await fetchWallPage(oldestTimestamp);
        const items = Array.isArray(data.items) ? data.items : [];

        items.forEach(d => wallEl.appendChild(renderMessage(d)));

        if (items.length > 0) {
          oldestTimestamp = items[items.length - 1].timestamp;
        }
        wallHasMore = !!data.hasMore;
        loadMoreBtn.hidden = !wallHasMore;
      } catch (err) {
        console.error('Failed to load more:', err);
      } finally {
        loadMoreBtn.disabled = false;
        loadMoreBtn.textContent = 'Load more';
      }
    });
  }


  function openComposer() {
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    messageInput.focus();
  }

  function closeComposer() {
    overlay.hidden = true;
    document.body.style.overflow = '';
    resetForm();
  }

  openBtns.forEach(btn => btn && btn.addEventListener('click', openComposer));
  closeBtn.addEventListener('click', closeComposer);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeComposer(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !overlay.hidden) closeComposer();
  });

  function resetForm() {
    form.reset();
    selectedSong = null;
    songPickedEl.hidden = true;
    songResultsEl.hidden = true;
    songResultsEl.innerHTML = '';
    errorEl.hidden = true;
    messageCount.textContent = `${MESSAGE_MAX} left`;
    submitBtn.disabled = false;
  }


  messageInput.addEventListener('input', () => {
    const left = MESSAGE_MAX - messageInput.value.length;
    messageCount.textContent = `${left} left`;
  });


  songSearchInput.addEventListener('input', () => {
    const q = songSearchInput.value.trim();
    clearTimeout(searchDebounce);

    if (!q) {
      songResultsEl.hidden = true;
      songResultsEl.innerHTML = '';
      return;
    }

    searchDebounce = setTimeout(() => runSearch(q), 350);
  });

  async function runSearch(q) {
    try {
      const res = await fetch(`/api/search-song?q=${encodeURIComponent(q)}`);
      const results = await res.json();

      songResultsEl.innerHTML = '';
      if (!Array.isArray(results) || results.length === 0) {
        songResultsEl.hidden = true;
        return;
      }

      results.forEach(track => {
        const li = document.createElement('li');
        li.innerHTML = `
          <button type="button" class="song-result">
            <img src="${escapeHtml(track.album_art || '')}" alt="">
            <span class="song-result__meta">
              <span class="song-result__title">${escapeHtml(track.title)}</span>
              <span class="song-result__artist">${escapeHtml(track.artist)}</span>
            </span>
          </button>
        `;
        li.querySelector('button').addEventListener('click', () => pickSong(track));
        songResultsEl.appendChild(li);
      });
      songResultsEl.hidden = false;
    } catch (err) {
      console.error('Song search failed:', err);
      songResultsEl.hidden = true;
    }
  }

  function pickSong(track) {
    selectedSong = track;
    songPickedArt.src = track.album_art || '';
    songPickedTitle.textContent = track.title;
    songPickedArtist.textContent = track.artist;
    songPickedEl.hidden = false;

    songResultsEl.hidden = true;
    songResultsEl.innerHTML = '';
    songSearchInput.value = '';
  }

  songPickedRemove.addEventListener('click', () => {
    selectedSong = null;
    songPickedEl.hidden = true;
  });


  function showToast(msg) {
    let toastEl = document.getElementById('toastMessage');
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'toastMessage';
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.remove('is-visible');
    void toastEl.offsetWidth;
    toastEl.classList.add('is-visible');

    clearTimeout(showToast._timeout);
    showToast._timeout = setTimeout(() => {
      toastEl.classList.remove('is-visible');
    }, 3200);
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    errorEl.hidden = true;

    const message = messageInput.value.trim();
    if (!message) {
      showError('Write something before pinning it.');
      return;
    }

    submitBtn.disabled = true;

    const payload = {
      recipient: recipientInput.value.trim(),
      message,
      song_title: selectedSong ? selectedSong.title : '',
      song_artist: selectedSong ? selectedSong.artist : '',
      album_art: selectedSong ? selectedSong.album_art : '',
      preview_url: selectedSong ? selectedSong.preview_url : ''
    };

    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Server rejected the message.');
      }

      closeComposer();

      if (wallEl) {
        await loadWall();
        document.getElementById('wallSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        showToast('Message pinned to the wall.');
      }
    } catch (err) {
      console.error(err);
      showError(err.message || "Couldn't pin that right now. Try again in a moment.");
      submitBtn.disabled = false;
    }
  });

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  const heroStatEl = document.getElementById('heroStat');

  if (heroStatEl) {
    fetch('/api/messages/count')
      .then(res => res.json())
      .then(data => {
        if (typeof data.count === 'number') {
          animateCountUp(heroStatEl, data.count);
        }
      })
      .catch(err => console.error('Failed to load wall count:', err));
  }

  function animateCountUp(el, target) {
    el.hidden = false;
    const textEl = document.getElementById('heroStatText') || el;
    const dotEl = el.querySelector('.hero__stat-dot');

    if (target === 0) {
      if (dotEl) dotEl.hidden = true;
      textEl.textContent = 'Be the first to pin something.';
      return;
    }

    const duration = 900;
    const start = performance.now();

    function frame(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(eased * target);
      textEl.textContent = `${current} note${current === 1 ? '' : 's'} pinned so far`;
      if (progress < 1) requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }

  const feedbackOverlay = document.getElementById('feedbackOverlay');

  if (feedbackOverlay) {
    const openFeedbackBtn = document.getElementById('openFeedbackTop');
    const closeFeedbackBtn = document.getElementById('closeFeedback');
    const feedbackForm = document.getElementById('feedbackForm');
    const feedbackNameInput = document.getElementById('feedbackNameInput');
    const feedbackMessageInput = document.getElementById('feedbackMessageInput');
    const feedbackErrorEl = document.getElementById('feedbackError');
    const submitFeedbackBtn = document.getElementById('submitFeedback');

    function openFeedback() {
      feedbackOverlay.hidden = false;
      document.body.style.overflow = 'hidden';
      feedbackMessageInput.focus();
    }

    function closeFeedback() {
      feedbackOverlay.hidden = true;
      document.body.style.overflow = '';
      feedbackForm.reset();
      feedbackErrorEl.hidden = true;
      submitFeedbackBtn.disabled = false;
    }

    if (openFeedbackBtn) openFeedbackBtn.addEventListener('click', openFeedback);
    closeFeedbackBtn.addEventListener('click', closeFeedback);
    feedbackOverlay.addEventListener('click', e => {
      if (e.target === feedbackOverlay) closeFeedback();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !feedbackOverlay.hidden) closeFeedback();
    });

    feedbackForm.addEventListener('submit', async e => {
      e.preventDefault();
      feedbackErrorEl.hidden = true;

      const message = feedbackMessageInput.value.trim();
      if (!message) {
        feedbackErrorEl.textContent = 'Write your feedback before sending.';
        feedbackErrorEl.hidden = false;
        return;
      }

      submitFeedbackBtn.disabled = true;

      try {
        const res = await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: feedbackNameInput.value.trim(),
            message
          })
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Could not send feedback.');
        }

        closeFeedback();
        showToast('Thanks - your feedback was sent.');
      } catch (err) {
        console.error(err);
        feedbackErrorEl.textContent = err.message || "Couldn't send that right now. Try again in a moment.";
        feedbackErrorEl.hidden = false;
        submitFeedbackBtn.disabled = false;
      }
    });
  }

  async function handleSharedNoteLink() {
    if (!wallEl) return;

    const params = new URLSearchParams(window.location.search);
    const noteId = params.get('note');
    if (!noteId) return;

    const shouldPlay = params.get('play') === '1';

    let noteEl = wallEl.querySelector(`[data-id="${CSS.escape(noteId)}"]`);

    if (!noteEl) {
      // Not on the first page of the wall (e.g. an older note) — fetch it
      // directly and pin it to the top so the shared link always resolves.
      try {
        const res = await fetch(`/api/messages/${encodeURIComponent(noteId)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!data.item) return;

        noteEl = renderMessage(data.item);
        wallEl.insertBefore(noteEl, wallEl.firstChild);
        wallEmptyEl.hidden = true;
      } catch (err) {
        console.error('Failed to load shared note:', err);
        return;
      }
    }

    noteEl.classList.add('note--shared-highlight');
    noteEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

    if (!shouldPlay) return;

    const ticketBtn = noteEl.querySelector('.ticket');
    if (!ticketBtn || !ticketBtn.dataset.preview) return;

    // Browsers only allow audio autoplay when it's tied to a user gesture,
    // and that gesture doesn't reliably carry over from a link tap in
    // another app into this page load. Try it — if it's blocked, leave the
    // ticket visibly cued (glowing) so a single tap plays it instead of
    // silently doing nothing.
    try {
      player.src = ticketBtn.dataset.preview;
      await player.play();
      ticketBtn.classList.add('is-playing');
      activeTicket = ticketBtn;
    } catch (err) {
      ticketBtn.classList.add('is-cued');
      showToast('Tap the song to hear it.');
    }
  }

  loadWall().then(handleSharedNoteLink);
})();