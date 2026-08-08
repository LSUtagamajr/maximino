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

    const hasSong = d.song_title && d.song_title.trim();

    note.innerHTML = `
      ${d.recipient ? `<p class="note__recipient">for ${escapeHtml(d.recipient)}</p>` : ''}
      <p class="note__message">${escapeHtml(d.message)}</p>
      <div class="note__footer">
        <span class="note__time">${d.timestamp ? timeAgo(d.timestamp) : ''}</span>
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

  async function loadWall() {
    try {
      const res = await fetch('/api/messages');
      const data = await res.json();

      wallEl.innerHTML = '';
      if (!Array.isArray(data) || data.length === 0) {
        wallEmptyEl.hidden = false;
        wallCountEl.textContent = '';
        return;
      }

      wallEmptyEl.hidden = true;
      wallCountEl.textContent = `${data.length} pinned`;
      data.forEach(d => wallEl.appendChild(renderMessage(d)));
    } catch (err) {
      console.error('Failed to load wall:', err);
      wallEmptyEl.hidden = false;
      wallEmptyEl.textContent = "Couldn't load the wall right now. Try refreshing.";
    }
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

      if (!res.ok) throw new Error('Server rejected the message.');

      closeComposer();
      await loadWall();
      document.getElementById('wallSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error(err);
      showError("Couldn't pin that right now. Try again in a moment.");
      submitBtn.disabled = false;
    }
  });

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  loadWall();
})();
