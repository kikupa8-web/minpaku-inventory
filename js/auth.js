var Auth = (function() {
  var idToken = null;
  var user = null;
  var refreshTimer = null;

  function init() {
    var saved = localStorage.getItem('minpaku_token');
    if (saved) {
      try {
        var parsed = JSON.parse(saved);
        if (parsed.exp && parsed.exp > Date.now()) {
          idToken = parsed.token;
          scheduleRefresh();
        } else {
          localStorage.removeItem('minpaku_token');
        }
      } catch(e) { localStorage.removeItem('minpaku_token'); }
    }

    initGIS();
  }

  var gisRetry = 0;
  function initGIS() {
    if (typeof google !== 'undefined' && google.accounts) {
      try {
        google.accounts.id.initialize({
          client_id: AppConfig.GOOGLE_CLIENT_ID,
          callback: handleCredentialResponse,
          auto_select: true
        });
        var el = document.getElementById('google-signin-btn');
        if (el) renderButton(el);
        setTimeout(showManualButton, 2000);
      } catch(e) {
        showError('GIS初期化エラー: ' + e.message);
        showManualButton();
      }
    } else {
      gisRetry++;
      if (gisRetry < 50) {
        setTimeout(initGIS, 200);
      } else {
        showError('Googleログインの読み込みに失敗しました。ページを再読み込みしてください。');
        showManualButton();
      }
    }
  }

  function showManualButton() {
    var btn = document.getElementById('manual-signin-btn');
    var gsiBtn = document.getElementById('google-signin-btn');
    if (btn && gsiBtn && gsiBtn.children.length === 0) {
      btn.style.display = 'block';
      btn.onclick = function() {
        if (typeof google !== 'undefined' && google.accounts) {
          google.accounts.id.prompt(function(notification) {
            if (notification.isNotDisplayed()) {
              showError('ポップアップがブロックされました。ブラウザの設定を確認してください。理由: ' + notification.getNotDisplayedReason());
            }
          });
        } else {
          showError('Googleログインが読み込まれていません。ページを再読み込みしてください。');
        }
      };
    }
  }

  function showError(msg) {
    var el = document.getElementById('login-error');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }

  function renderButton(el) {
    if (typeof google !== 'undefined' && google.accounts) {
      google.accounts.id.renderButton(el, {
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        locale: 'ja',
        width: 300
      });
      google.accounts.id.prompt();
    } else {
      setTimeout(function() { renderButton(el); }, 200);
    }
  }

  function handleCredentialResponse(response) {
    idToken = response.credential;
    var payload = parseJwt(idToken);
    var expMs = payload.exp * 1000;
    localStorage.setItem('minpaku_token', JSON.stringify({ token: idToken, exp: expMs }));
    scheduleRefresh();
    if (typeof App !== 'undefined') App.onLoginSuccess();
  }

  // トークン期限の5分前に自動更新をスケジュール
  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    if (!idToken) return;

    var payload = parseJwt(idToken);
    if (!payload.exp) return;

    var expMs = payload.exp * 1000;
    var now = Date.now();
    // 期限の5分前に更新（最低30秒後）
    var refreshIn = Math.max((expMs - now) - 5 * 60 * 1000, 30000);

    refreshTimer = setTimeout(function() {
      refreshToken();
    }, refreshIn);
  }

  // サイレントリフレッシュ
  function refreshToken() {
    if (typeof google === 'undefined' || !google.accounts) return;
    try {
      google.accounts.id.prompt(function(notification) {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          // サイレント更新失敗 → 50分後にもう一度試す
          refreshTimer = setTimeout(refreshToken, 50 * 60 * 1000);
        }
        // 成功時は handleCredentialResponse が呼ばれ、scheduleRefresh が再設定される
      });
    } catch(e) {
      // エラー時は50分後にリトライ
      refreshTimer = setTimeout(refreshToken, 50 * 60 * 1000);
    }
  }

  // API認証エラー時にリフレッシュを試みる（1回だけ）
  function tryRefreshAndRetry(retryFn) {
    if (typeof google === 'undefined' || !google.accounts) return false;
    try {
      google.accounts.id.prompt(function(notification) {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          // リフレッシュ失敗 → ログアウト
          UI.showToast('ログインの有効期限が切れました。再ログインしてください。', 'error');
          logout();
          setTimeout(function() { location.reload(); }, 2000);
        }
        // 成功時は handleCredentialResponse → retryFn で元の処理をリトライ
      });
    } catch(e) {
      return false;
    }
    return true;
  }

  function parseJwt(token) {
    try {
      var base64Url = token.split('.')[1];
      var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join('')));
    } catch(e) { return {}; }
  }

  function getToken() { return idToken; }
  function getUser() { return user; }
  function setUser(u) { user = u; }
  function isLoggedIn() { return !!idToken; }

  function logout() {
    idToken = null;
    user = null;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
    localStorage.removeItem('minpaku_token');
    if (typeof google !== 'undefined' && google.accounts) {
      google.accounts.id.disableAutoSelect();
    }
  }

  return {
    init: init, renderButton: renderButton, getToken: getToken,
    getUser: getUser, setUser: setUser, isLoggedIn: isLoggedIn,
    logout: logout, refreshToken: refreshToken, tryRefreshAndRetry: tryRefreshAndRetry
  };
})();
