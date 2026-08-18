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
    if (before) params.set('before', before);
    const res = await fetch(`/api/messages?${params.toString()}`);
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

  loadWall();
})();
