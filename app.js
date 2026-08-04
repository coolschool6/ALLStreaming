(function () {
  'use strict';

  var SESSION_KEY = 'ak_session';
  var REDIRECT_KEY = 'ak_redirect';
  var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyRQiSEI4-JGds65tngAD3adPKO10ng2BbXLydBbn5Y42JWSugBveJLSyZPhqF-rn6sEQ/exec';

  var gateView = document.getElementById('gate-view');
  var expiredView = document.getElementById('expired-view');
  var streamView = document.getElementById('stream-view');
  var streamFrame = document.getElementById('stream-frame');
  var streamCountdown = document.getElementById('stream-countdown');
  var keyInput = document.getElementById('key-input');
  var errorMsg = document.getElementById('error-msg');
  var statusMsg = document.getElementById('status-msg');
  var countdownEl = document.getElementById('countdown-timer');

  var countdownInterval = null;
  var autoRedirectTimer = null;
  var autoRedirectListener = null;

  function showView(view) {
    gateView.classList.remove('active');
    expiredView.classList.remove('active');
    streamView.classList.remove('active');
    view.classList.add('active');
  }

  function showError() {
    errorMsg.classList.add('visible');
    keyInput.value = '';
    keyInput.focus();
  }

  function showErrorMessage(text) {
    errorMsg.textContent = text;
    errorMsg.classList.add('visible');
    keyInput.value = '';
    keyInput.focus();
  }

  function hideError() {
    errorMsg.classList.remove('visible');
    errorMsg.textContent = 'Invalid or expired access key. Please check and try again.';
  }

  function showStatus(text) {
    statusMsg.textContent = text;
    statusMsg.classList.add('visible');
  }

  function hideStatus() {
    statusMsg.textContent = '';
    statusMsg.classList.remove('visible');
  }

  function showCountdown(text) {
    countdownEl.textContent = text;
    countdownEl.classList.add('visible');
    streamCountdown.textContent = text;
  }

  function hideCountdown() {
    countdownEl.textContent = '';
    countdownEl.classList.remove('visible');
    streamCountdown.textContent = '';
  }

  function setLoading(btn, loading) {
    if (loading) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent;
      btn.textContent = 'Verifying...';
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || btn.textContent;
    }
  }

  function base64UrlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return decodeURIComponent(
      atob(str).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join('')
    );
  }

  function decodeToken(token) {
    try {
      var parts = token.split('.');
      if (parts.length !== 2) return null;
      return JSON.parse(base64UrlDecode(parts[0]));
    } catch (e) {
      return null;
    }
  }

  function decodeRedirect(b64) {
    try {
      return atob(b64);
    } catch (e) {
      return null;
    }
  }

  async function apiCall(action, payload) {
    var body = Object.assign({ action: action }, payload || {});
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

  function saveSession(token) {
    localStorage.setItem(SESSION_KEY, token);
  }

  function saveRedirect(b64) {
    try { localStorage.setItem(REDIRECT_KEY, b64); } catch (e) {}
  }

  function getSession() {
    try {
      return localStorage.getItem(SESSION_KEY) || null;
    } catch (e) {
      return null;
    }
  }

  function getRedirect() {
    try {
      return localStorage.getItem(REDIRECT_KEY) || null;
    } catch (e) {
      return null;
    }
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(REDIRECT_KEY);
  }

  function startCountdown(expiresAt, onExpired) {
    if (countdownInterval) clearInterval(countdownInterval);

    function update() {
      var diff = expiresAt - Date.now();
      if (diff <= 0) {
        clearInterval(countdownInterval);
        hideCountdown();
        if (onExpired) onExpired();
        return;
      }
      var days = Math.floor(diff / 86400000);
      var hours = Math.floor((diff % 86400000) / 3600000);
      var mins = Math.floor((diff % 3600000) / 60000);
      var secs = Math.floor((diff % 60000) / 1000);
      showCountdown(days + 'd ' + hours + 'h ' + mins + 'm ' + secs + 's remaining');
    }

    update();
    countdownInterval = setInterval(update, 1000);
  }

  function stopCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);
    hideCountdown();
  }

  function armAutoRedirect(url) {
    if (autoRedirectTimer) return;
    var fired = false;
    function go() {
      if (fired) return;
      fired = true;
      stopAutoRedirect();
      var w = window.open(url, '_blank');
      if (!w) {
        window.location.href = url;
      } else {
        try { w.opener = null; } catch (e) {}
      }
    }
    autoRedirectListener = go;
    streamFrame.addEventListener('focus', go);
    autoRedirectTimer = setInterval(function () {
      if (document.activeElement === streamFrame) go();
    }, 300);
  }

  function stopAutoRedirect() {
    if (autoRedirectTimer) {
      clearInterval(autoRedirectTimer);
      autoRedirectTimer = null;
    }
    if (autoRedirectListener) {
      streamFrame.removeEventListener('focus', autoRedirectListener);
      autoRedirectListener = null;
    }
  }

  function openStream(expiresAt, redirectB64) {
    var url = decodeRedirect(redirectB64);
    if (!url) {
      showErrorMessage('The platform URL is not configured yet. Contact the administrator.');
      return false;
    }
    stopCountdown();
    stopAutoRedirect();
    streamFrame.src = url;
    showView(streamView);
    armAutoRedirect(url);
    if (expiresAt) {
      startCountdown(expiresAt, function () {
        stopAutoRedirect();
        streamFrame.src = 'about:blank';
        clearSession();
        showView(expiredView);
      });
    }
    return true;
  }

  async function attemptLogin(inputKey) {
    var btn = document.querySelector('.btn-primary');
    setLoading(btn, true);
    hideError();
    hideStatus();
    stopCountdown();

    try {
      var result = await apiCall('validate-key', { key: inputKey });

      if (result.valid && result.token) {
        saveSession(result.token);
        if (result.redirectB64) saveRedirect(result.redirectB64);
        var data = decodeToken(result.token);
        openStream(data && data.e, result.redirectB64 || getRedirect());
      } else {
        showError();
      }
    } catch (e) {
      var msg = e.message || '';
      if (msg === 'expired') {
        showErrorMessage('This key has already started and its time period has ended.');
      } else if (msg === 'revoked') {
        showErrorMessage('This key has been revoked by the administrator.');
      } else if (msg === 'Invalid key') {
        showErrorMessage('That key does not match exactly. Check spelling, case, and spaces.');
      } else if (msg === 'Invalid key configuration') {
        showErrorMessage('This key is misconfigured in the spreadsheet.');
      } else {
        showErrorMessage('Validation failed. Please try again or contact the administrator.');
      }
    } finally {
      setLoading(btn, false);
    }
  }

  async function checkExistingSession() {
    var token = getSession();
    if (!token) {
      showView(gateView);
      return;
    }

    var data = decodeToken(token);
    var cachedRedirect = getRedirect();

    if (data && data.e) {
      if (data.e <= Date.now()) {
        clearSession();
        showView(expiredView);
        stopCountdown();
        return;
      }
      if (cachedRedirect) {
        openStream(data.e, cachedRedirect);
        return;
      }
    }

    // No usable cached redirect: ask the server (also re-checks revocation).
    try {
      var result = await apiCall('verify-token', { token: token });
      if (result.valid) {
        if (result.redirectB64) saveRedirect(result.redirectB64);
        openStream(data && data.e, result.redirectB64 || cachedRedirect);
        return;
      }
    } catch (e) {
      // token invalid or API unreachable
    }

    clearSession();
    showView(gateView);
  }

  document.getElementById('gate-form').addEventListener('submit', function (e) {
    e.preventDefault();
    hideError();
    var val = keyInput.value.trim();
    if (!val) {
      keyInput.focus();
      return;
    }
    attemptLogin(val);
  });

  document.getElementById('btn-retry').addEventListener('click', function () {
    stopAutoRedirect();
    keyInput.value = '';
    hideError();
    hideStatus();
    stopCountdown();
    showView(gateView);
    keyInput.focus();
  });

  document.getElementById('btn-clear-session').addEventListener('click', function () {
    stopAutoRedirect();
    clearSession();
    keyInput.value = '';
    hideError();
    hideStatus();
    stopCountdown();
    showView(gateView);
    keyInput.focus();
  });

  document.getElementById('btn-stream-exit').addEventListener('click', function () {
    stopAutoRedirect();
    streamFrame.src = 'about:blank';
    clearSession();
    hideStatus();
    stopCountdown();
    showView(gateView);
    keyInput.focus();
  });

  keyInput.addEventListener('input', hideError);

  checkExistingSession();
})();
