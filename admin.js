(function () {
  'use strict';

  var ADMIN_TOKEN_KEY = 'ak_admin_token';
  var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyRQiSEI4-JGds65tngAD3adPKO10ng2BbXLydBbn5Y42JWSugBveJLSyZPhqF-rn6sEQ/exec';

  var loginView = document.getElementById('login-view');
  var dashboardView = document.getElementById('dashboard-view');
  var loginForm = document.getElementById('login-form');
  var loginError = document.getElementById('login-error');
  var keysTbody = document.getElementById('keys-tbody');
  var keysLoading = document.getElementById('keys-loading');
  var keysTableWrap = document.getElementById('keys-table-wrap');
  var keysEmpty = document.getElementById('keys-empty');

  function showView(view) {
    loginView.classList.remove('active');
    dashboardView.classList.remove('active');
    view.classList.add('active');
  }

  function showError(el, text) {
    el.textContent = text;
    el.classList.add('visible', 'error');
  }

  function hideError(el) {
    el.textContent = '';
    el.classList.remove('visible', 'error');
  }

  function showStatus(el, text) {
    el.textContent = text;
    el.classList.remove('error');
    el.classList.add('visible');
  }

  function hideStatus(el) {
    el.textContent = '';
    el.classList.remove('visible', 'error');
  }

  function getAdminToken() {
    try { return localStorage.getItem(ADMIN_TOKEN_KEY) || null; } catch (e) { return null; }
  }

  function saveAdminToken(token) {
    localStorage.setItem(ADMIN_TOKEN_KEY, token);
  }

  function clearAdminToken() {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
  }

  async function apiCall(action, payload) {
    var body = Object.assign({ action: action }, payload || {});
    var token = getAdminToken();
    if (token) body.token = token;

    var res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    var data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error('Bad response from server');
    }
    if (!data || data.ok === false) throw new Error((data && data.error) || 'API error');
    return data;
  }

  function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function escAttr(s) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderKeys(keys) {
    keysLoading.style.display = 'none';

    if (!keys || keys.length === 0) {
      keysTableWrap.style.display = 'none';
      keysEmpty.style.display = 'block';
      document.getElementById('stat-total').textContent = '0';
      document.getElementById('stat-active').textContent = '0';
      document.getElementById('stat-expired').textContent = '0';
      document.getElementById('stat-disabled').textContent = '0';
      return;
    }

    keysEmpty.style.display = 'none';
    keysTableWrap.style.display = 'block';
    keysTbody.innerHTML = '';

    var total = keys.length;
    var activeCount = 0;
    var expiredCount = 0;
    var disabledCount = 0;

    keys.forEach(function (k) {
      var tr = document.createElement('tr');
      if (k.disabled) tr.className = 'row-disabled';

      var statusText, statusClass;
      if (k.disabled) {
        statusText = 'Disabled';
        statusClass = 'status-disabled';
        disabledCount++;
      } else if (k.activatedAt) {
        var remainingMs = k.remainingMs || 0;
        if (remainingMs <= 0) {
          statusText = 'Expired';
          statusClass = 'status-expired';
          expiredCount++;
        } else {
          var remDays = Math.floor(remainingMs / 86400000);
          var remHrs = Math.floor((remainingMs % 86400000) / 3600000);
          var remMin = Math.floor((remainingMs % 3600000) / 60000);
          statusText = 'Active (' + remDays + 'd ' + remHrs + 'h ' + remMin + 'm)';
          statusClass = 'status-active';
          activeCount++;
        }
      } else {
        statusText = 'Available';
        statusClass = 'status-unused';
      }

      var note = k.userNote || '-';
      var activatedStr = k.activatedAt ? new Date(k.activatedAt).toLocaleString() : '-';
      var expiresStr = k.expiresAt ? new Date(k.expiresAt).toLocaleString() : '-';
      var durLabel = k.durationLabel || (k.validDays + 'd');

      tr.innerHTML =
        '<td class="key-name">' + escHtml(k.key) + '</td>' +
        '<td>' + durLabel + '</td>' +
        '<td class="key-note">' + escHtml(note) + '</td>' +
        '<td>' + activatedStr + '</td>' +
        '<td>' + expiresStr + '</td>' +
        '<td><span class="badge ' + statusClass + '">' + statusText + '</span></td>' +
        '<td class="actions">' +
          (k.disabled
            ? '<button class="btn-sm btn-enable" data-key="' + escAttr(k.key) + '">Enable</button>'
            : '<button class="btn-sm btn-disable" data-key="' + escAttr(k.key) + '">Disable</button>'
          ) +
          '<button class="btn-sm btn-danger" data-key="' + escAttr(k.key) + '" data-action="delete">Delete</button>' +
        '</td>';

      keysTbody.appendChild(tr);
    });

    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-active').textContent = activeCount;
    document.getElementById('stat-expired').textContent = expiredCount;
    document.getElementById('stat-disabled').textContent = disabledCount;
  }

  async function loadKeys() {
    keysLoading.style.display = 'block';
    keysLoading.textContent = 'Loading keys...';
    keysTableWrap.style.display = 'none';
    keysEmpty.style.display = 'none';
    try {
      var result = await apiCall('admin-list');
      renderKeys(result.keys || []);
    } catch (e) {
      keysLoading.textContent = 'Failed to load keys: ' + e.message;
    }
  }

  loginForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    hideError(loginError);
    var pw = document.getElementById('admin-password').value;
    if (!pw) return;

    var btn = loginForm.querySelector('button');
    btn.disabled = true;
    try {
      var result = await apiCall('admin-login', { password: pw });
      saveAdminToken(result.token);
      showView(dashboardView);
      loadKeys();
    } catch (err) {
      showError(loginError, 'Wrong password.');
      document.getElementById('admin-password').value = '';
      document.getElementById('admin-password').focus();
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('add-key-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var msg = document.getElementById('add-key-msg');
    hideStatus(msg);

    var name = document.getElementById('new-key-name').value.trim();
    var days = parseInt(document.getElementById('new-key-days').value, 10) || 0;
    var minutes = parseInt(document.getElementById('new-key-minutes').value, 10) || 0;
    var note = document.getElementById('new-key-note').value.trim();

    if (!name || (days <= 0 && minutes <= 0)) {
      showError(msg, 'Enter a key name and a valid duration.');
      return;
    }

    try {
      await apiCall('admin-add', { key: name, validDays: days, validMinutes: minutes, userNote: note });
      showStatus(msg, 'Key "' + name + '" added.');
      document.getElementById('new-key-name').value = '';
      document.getElementById('new-key-days').value = '';
      document.getElementById('new-key-minutes').value = '';
      document.getElementById('new-key-note').value = '';
      setTimeout(loadKeys, 1500);
    } catch (err) {
      showError(msg, 'Failed: ' + err.message);
    }
  });

  document.getElementById('extend-key-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var msg = document.getElementById('extend-key-msg');
    hideStatus(msg);

    var name = document.getElementById('extend-key-name').value.trim();
    var days = parseInt(document.getElementById('extend-key-days').value, 10);

    if (!name || !days || days <= 0) {
      showError(msg, 'Enter a key name and days to add.');
      return;
    }

    try {
      await apiCall('admin-extend', { key: name, addDays: days });
      showStatus(msg, 'Extended "' + name + '" by ' + days + ' days.');
      document.getElementById('extend-key-name').value = '';
      document.getElementById('extend-key-days').value = '';
      setTimeout(loadKeys, 1500);
    } catch (err) {
      showError(msg, 'Failed: ' + err.message);
    }
  });

  document.getElementById('check-key-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var msg = document.getElementById('check-key-msg');
    hideStatus(msg);

    var name = document.getElementById('check-key-name').value.trim();
    if (!name) {
      showError(msg, 'Enter a key name to check.');
      return;
    }

    try {
      var result = await apiCall('admin-check-key', { key: name });
      if (result.valid) {
        var actDate = result.activatedAt ? new Date(result.activatedAt).toLocaleString() : 'Not yet';
        var expDate = result.expiresAt ? new Date(result.expiresAt).toLocaleString() : '-';
        showStatus(msg,
          'Key: ' + name + ' — VALID\n' +
          'Activated: ' + actDate + '\n' +
          'Expires: ' + expDate + '\n' +
          'Days remaining: ' + result.remaining
        );
      } else {
        showError(msg, 'Key: ' + name + ' — ' + (result.error || 'INVALID'));
      }
      document.getElementById('check-key-name').value = '';
    } catch (err) {
      showError(msg, 'Failed: ' + err.message);
    }
  });

  keysTbody.addEventListener('click', async function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    var keyName = btn.dataset.key;
    var action = btn.dataset.action || (btn.classList.contains('btn-disable') ? 'disable' : btn.classList.contains('btn-enable') ? 'enable' : null);

    if (!action || !keyName) return;

    if (action === 'delete' && !confirm('Delete key "' + keyName + '"? This cannot be undone.')) return;
    if (action === 'disable' && !confirm('Disable key "' + keyName + '"?')) return;

    btn.disabled = true;
    btn.textContent = '...';

    try {
      await apiCall('admin-' + action, { key: keyName });
      setTimeout(loadKeys, 1000);
    } catch (err) {
      alert('Failed: ' + err.message);
      btn.disabled = false;
      btn.textContent = action === 'disable' ? 'Disable' : action === 'enable' ? 'Enable' : 'Delete';
    }
  });

  document.getElementById('btn-refresh').addEventListener('click', loadKeys);

  document.getElementById('btn-logout').addEventListener('click', function () {
    clearAdminToken();
    showView(loginView);
    document.getElementById('admin-password').value = '';
  });

  async function init() {
    var token = getAdminToken();
    if (token) {
      try {
        var result = await apiCall('admin-check');
        if (result.valid) {
          showView(dashboardView);
          loadKeys();
          return;
        }
      } catch (e) {
        clearAdminToken();
      }
    }
    showView(loginView);
  }

  init();
})();
