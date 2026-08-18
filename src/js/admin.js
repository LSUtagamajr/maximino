
      (() => {
        const STORAGE_KEY = 'maximino_admin_key';

        const loginScreen = document.getElementById('loginScreen');
        const adminApp = document.getElementById('adminApp');
        const loginForm = document.getElementById('loginForm');
        const passwordInput = document.getElementById('passwordInput');
        const loginError = document.getElementById('loginError');
        const logoutBtn = document.getElementById('logoutBtn');

        const tabs = document.querySelectorAll('.admin-tab');
        const panels = {
          messages: document.getElementById('panel-messages'),
          reports: document.getElementById('panel-reports'),
          feedback: document.getElementById('panel-feedback'),
        };

        function escapeHtml(str) {
          const div = document.createElement('div');
          div.textContent = str == null ? '' : str;
          return div.innerHTML;
        }

        function formatTime(dateStr) {
          if (!dateStr) return '';
          return new Date(dateStr).toLocaleString();
        }

        function getKey() {
          return sessionStorage.getItem(STORAGE_KEY) || '';
        }

        async function adminFetch(path, options = {}) {
          const res = await fetch(path, {
            ...options,
            headers: {
              ...(options.headers || {}),
              'x-admin-key': getKey(),
            },
          });
          if (res.status === 401) {
            sessionStorage.removeItem(STORAGE_KEY);
            showLogin('Session expired. Enter the password again.');
            throw new Error('Unauthorized');
          }
          return res;
        }

        function showLogin(message) {
          loginScreen.hidden = false;
          adminApp.hidden = true;
          loginError.textContent = message || '';
        }

        function showApp() {
          loginScreen.hidden = true;
          adminApp.hidden = false;
          loadActiveTab();
        }

        loginForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const value = passwordInput.value.trim();
          if (!value) return;

          sessionStorage.setItem(STORAGE_KEY, value);

          try {
            const res = await fetch('/api/admin/verify', {
              headers: { 'x-admin-key': value },
            });
            if (res.ok) {
              loginError.textContent = '';
              showApp();
            } else if (res.status === 503) {
              sessionStorage.removeItem(STORAGE_KEY);
              loginError.textContent = 'Admin access is not configured on the server yet.';
            } else {
              sessionStorage.removeItem(STORAGE_KEY);
              loginError.textContent = 'Incorrect password.';
            }
          } catch (err) {
            sessionStorage.removeItem(STORAGE_KEY);
            loginError.textContent = "Couldn't reach the server. Try again.";
          }
        });

        logoutBtn.addEventListener('click', () => {
          sessionStorage.removeItem(STORAGE_KEY);
          showLogin();
        });

        tabs.forEach(tab => {
          tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('is-active'));
            tab.classList.add('is-active');
            Object.values(panels).forEach(p => p.classList.remove('is-active'));
            panels[tab.dataset.tab].classList.add('is-active');
            loadTab(tab.dataset.tab);
          });
        });

        function loadActiveTab() {
          const active = document.querySelector('.admin-tab.is-active');
          loadTab(active ? active.dataset.tab : 'messages');
        }

        const loadedTabs = new Set();

        function loadTab(name, force) {
          if (loadedTabs.has(name) && !force) return;
          loadedTabs.add(name);
          if (name === 'messages') loadMessages();
          if (name === 'reports') loadReports();
          if (name === 'feedback') loadFeedback();
        }

        async function loadMessages() {
          const panel = panels.messages;
          try {
            const res = await adminFetch('/api/admin/messages');
            const items = await res.json();

            if (!Array.isArray(items) || items.length === 0) {
              panel.innerHTML = '<p class="admin-empty">No dedications yet.</p>';
              return;
            }

            panel.innerHTML = items.map(d => `
              <div class="admin-row" data-id="${d._id}">
                <div class="admin-row__top">
                  <span class="admin-row__recipient">${d.recipient ? 'for ' + escapeHtml(d.recipient) : 'no recipient'}</span>
                  <span class="admin-row__time">${formatTime(d.timestamp)}</span>
                </div>
                <p class="admin-row__message">${escapeHtml(d.message)}</p>
                ${d.song_title ? `<p class="admin-row__song">♪ ${escapeHtml(d.song_title)} — ${escapeHtml(d.song_artist || '')}</p>` : ''}
                <div class="admin-row__actions">
                  <button class="admin-btn admin-btn--danger" data-action="delete-message" data-id="${d._id}">Delete</button>
                </div>
              </div>
            `).join('');
          } catch (err) {
            if (err.message !== 'Unauthorized') {
              panel.innerHTML = '<p class="admin-empty">Failed to load messages.</p>';
            }
          }
        }

        async function loadReports() {
          const panel = panels.reports;
          try {
            const res = await adminFetch('/api/admin/reports');
            const items = await res.json();

            if (!Array.isArray(items) || items.length === 0) {
              panel.innerHTML = '<p class="admin-empty">No reports right now.</p>';
              return;
            }

            panel.innerHTML = items.map(r => {
              const msg = r.messageId;
              if (!msg) {
                return `
                  <div class="admin-row" data-report-id="${r._id}">
                    <p class="admin-row__message">The reported message was already deleted.</p>
                    <div class="admin-row__actions">
                      <button class="admin-btn" data-action="dismiss-report" data-id="${r._id}">Dismiss</button>
                    </div>
                  </div>
                `;
              }
              return `
                <div class="admin-row" data-report-id="${r._id}">
                  <div class="admin-row__top">
                    <span class="admin-row__recipient">${msg.recipient ? 'for ' + escapeHtml(msg.recipient) : 'no recipient'}</span>
                    <span class="admin-row__time">reported ${formatTime(r.timestamp)}</span>
                  </div>
                  <p class="admin-row__message">${escapeHtml(msg.message)}</p>
                  <div class="admin-row__actions">
                    <button class="admin-btn" data-action="dismiss-report" data-id="${r._id}">Dismiss</button>
                    <button class="admin-btn admin-btn--danger" data-action="delete-message" data-id="${msg._id}" data-report-id="${r._id}">Delete message</button>
                  </div>
                </div>
              `;
            }).join('');
          } catch (err) {
            if (err.message !== 'Unauthorized') {
              panel.innerHTML = '<p class="admin-empty">Failed to load reports.</p>';
            }
          }
        }

        async function loadFeedback() {
          const panel = panels.feedback;
          try {
            const res = await adminFetch('/api/admin/feedback');
            const items = await res.json();

            if (!Array.isArray(items) || items.length === 0) {
              panel.innerHTML = '<p class="admin-empty">No feedback yet.</p>';
              return;
            }

            panel.innerHTML = items.map(f => `
              <div class="admin-row">
                <div class="admin-row__top">
                  <span class="admin-row__recipient">${f.name ? escapeHtml(f.name) : 'anonymous'}</span>
                  <span class="admin-row__time">${formatTime(f.timestamp)}</span>
                </div>
                <p class="admin-row__message">${escapeHtml(f.message)}</p>
              </div>
            `).join('');
          } catch (err) {
            if (err.message !== 'Unauthorized') {
              panel.innerHTML = '<p class="admin-empty">Failed to load feedback.</p>';
            }
          }
        }

        document.addEventListener('click', async (e) => {
          const btn = e.target.closest('button[data-action]');
          if (!btn) return;

          const action = btn.dataset.action;

          if (action === 'delete-message') {
            if (btn.textContent === 'Delete' || btn.textContent === 'Delete message') {
              btn.textContent = 'Confirm?';
              setTimeout(() => {
                if (btn.textContent === 'Confirm?') {
                  btn.textContent = action === 'delete-message' && btn.dataset.reportId ? 'Delete message' : 'Delete';
                }
              }, 3000);
              return;
            }
            btn.disabled = true;
            try {
              await adminFetch(`/api/admin/messages/${btn.dataset.id}`, { method: 'DELETE' });
              loadedTabs.delete('messages');
              loadedTabs.delete('reports');
              loadTab('messages', true);
              loadTab('reports', true);
            } catch (err) {
              btn.disabled = false;
            }
          }

          if (action === 'dismiss-report') {
            if (btn.textContent === 'Dismiss') {
              btn.textContent = 'Confirm?';
              setTimeout(() => {
                if (btn.textContent === 'Confirm?') btn.textContent = 'Dismiss';
              }, 3000);
              return;
            }
            btn.disabled = true;
            try {
              await adminFetch(`/api/admin/reports/${btn.dataset.id}`, { method: 'DELETE' });
              loadTab('reports', true);
            } catch (err) {
              btn.disabled = false;
            }
          }
        });

        if (getKey()) {
          fetch('/api/admin/verify', { headers: { 'x-admin-key': getKey() } })
            .then(res => {
              if (res.ok) showApp();
              else {
                sessionStorage.removeItem(STORAGE_KEY);
                showLogin();
              }
            })
            .catch(() => showLogin());
        } else {
          showLogin();
        }
      })();