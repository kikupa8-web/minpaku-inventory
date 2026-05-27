var UI = (function() {
  // ============================================================
  // 同期ステータス
  // ============================================================
  function setSyncStatus(status) {
    var el = document.getElementById('sync-status');
    if (!el) return;
    var map = {
      saved:   { text: '保存済み', cls: 'sync-saved',   icon: '✅' },
      syncing: { text: '送信中…', cls: 'sync-syncing', icon: '🔄' },
      offline: { text: 'オフライン', cls: 'sync-offline', icon: '⚠️' },
      error:   { text: 'エラー',  cls: 'sync-error',   icon: '❌' }
    };
    var info = map[status] || map.saved;
    el.className = 'sync-bar ' + info.cls;
    el.innerHTML = info.icon + ' ' + info.text;
    var pending = Api.getPendingCount();
    if (pending > 0) el.innerHTML += ' <span class="pending-badge">送信待ち ' + pending + '件</span>';
  }

  function updatePendingBadge(count) {
    var el = document.getElementById('sync-status');
    if (!el) return;
    var badge = el.querySelector('.pending-badge');
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'pending-badge';
        el.appendChild(badge);
      }
      badge.textContent = '送信待ち ' + count + '件';
      setSyncStatus('offline');
    } else {
      if (badge) badge.remove();
    }
  }

  // ============================================================
  // トースト通知
  // ============================================================
  function showToast(msg, type) {
    var container = document.getElementById('toast-container');
    var toast = document.createElement('div');
    toast.className = 'toast toast-' + (type || 'info');
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(function() { toast.classList.add('toast-show'); }, 10);
    setTimeout(function() {
      toast.classList.remove('toast-show');
      setTimeout(function() { toast.remove(); }, 300);
    }, 3000);
  }

  // ============================================================
  // ローディング
  // ============================================================
  function showLoading() {
    document.getElementById('loading-overlay').style.display = 'flex';
  }
  function hideLoading() {
    document.getElementById('loading-overlay').style.display = 'none';
  }

  // ============================================================
  // ログイン画面
  // ============================================================
  function showLoginScreen() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app-screen').style.display = 'none';
    Auth.renderButton(document.getElementById('google-signin-btn'));
  }

  function showAppScreen() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'block';
  }

  // ============================================================
  // ヘッダー
  // ============================================================
  function renderHeader() {
    var user = Auth.getUser();
    var el = document.getElementById('user-info');
    if (user) {
      el.innerHTML = '<span class="user-name">' + esc(user.name) + '</span>'
        + '<span class="user-role">' + (user.role === 'admin' ? '管理者' : 'スタッフ') + '</span>';
    }
    var adminTab = document.getElementById('tab-settings');
    if (adminTab) adminTab.style.display = user && user.role === 'admin' ? '' : 'none';
  }

  // ============================================================
  // タブ切り替え
  // ============================================================
  function switchTab(tabName) {
    Store.setCurrentTab(tabName);
    document.querySelectorAll('.tab-btn').forEach(function(b) {
      b.classList.toggle('active', b.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-content').forEach(function(c) {
      c.classList.toggle('active', c.id === 'content-' + tabName);
    });

    switch(tabName) {
      case 'stock': renderStockTab(); break;
      case 'overview': renderOverviewTab(); break;
      case 'order': renderOrderTab(); break;
      case 'history': renderHistoryTab(); break;
      case 'settings': renderSettingsTab(); break;
    }
  }

  // ============================================================
  // 在庫タブ
  // ============================================================
  function renderStockTab() {
    renderPropertySelector();
    renderCategoryFilter();
    renderAlertSummary();
    renderStockList();
  }

  function renderPropertySelector() {
    var sel = document.getElementById('property-select');
    var current = Store.getSelectedPropertyId();
    sel.innerHTML = '';
    Store.getProperties().forEach(function(p) {
      var opt = document.createElement('option');
      opt.value = p.propertyId;
      opt.textContent = p.name;
      if (p.propertyId === current) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function renderCategoryFilter() {
    var container = document.getElementById('category-filter');
    var current = Store.getSelectedCategory();
    var cats = ['all'].concat(Store.getCategories());
    var labels = { all: 'すべて', 'アメニティ': 'アメニティ', '消耗品': '消耗品', 'リネン': 'リネン', '備品': '備品' };

    container.innerHTML = '';
    cats.forEach(function(cat) {
      var btn = document.createElement('button');
      btn.className = 'filter-btn' + (cat === current ? ' active' : '');
      btn.textContent = labels[cat] || cat;
      btn.onclick = function() {
        Store.setSelectedCategory(cat);
        renderStockTab();
      };
      container.appendChild(btn);
    });
  }

  function renderAlertSummary() {
    var el = document.getElementById('alert-summary');
    var shortage = Store.getShortageCount();
    var low = Store.getLowCount();
    var parts = [];
    if (shortage > 0) parts.push('<span class="alert-shortage">要補充 ' + shortage + '件</span>');
    if (low > 0) parts.push('<span class="alert-low">残り少 ' + low + '件</span>');
    el.innerHTML = parts.length > 0 ? parts.join('  ') : '<span class="alert-ok">すべてOK</span>';
  }

  function renderStockList() {
    var container = document.getElementById('stock-list');
    var stocks = Store.getStocksForProperty();
    var cat = Store.getSelectedCategory();
    if (cat !== 'all') stocks = stocks.filter(function(s) { return s.category === cat; });

    if (stocks.length === 0) {
      container.innerHTML = '<div class="empty-msg">この物件の在庫データがありません</div>';
      return;
    }

    var html = '';
    stocks.forEach(function(s) {
      var rowClass = s.status === '要補充' ? 'row-shortage' : (s.status === '残り少' ? 'row-low' : 'row-ok');
      html += '<div class="stock-row ' + rowClass + '" data-pid="' + s.propertyId + '" data-iid="' + s.itemId + '">'
        + '<div class="stock-info">'
        + '<div class="stock-name">' + esc(s.itemName) + '</div>'
        + '<div class="stock-meta">最低 ' + s.minimum + ' ／ ' + esc(s.status) + '</div>'
        + '</div>'
        + '<div class="stock-controls">'
        + '<button class="btn-minus" aria-label="1減らす" onclick="App.handleStock(\'' + s.propertyId + '\',\'' + s.itemId + '\',-1)">−</button>'
        + '<span class="stock-value">' + s.current + '</span>'
        + '<button class="btn-plus" aria-label="1増やす" onclick="App.handleStock(\'' + s.propertyId + '\',\'' + s.itemId + '\',1)">＋</button>'
        + '</div>'
        + '</div>';
    });
    container.innerHTML = html;
  }

  // ============================================================
  // 全体俯瞰タブ
  // ============================================================
  function renderOverviewTab() {
    var container = document.getElementById('content-overview');
    var properties = Store.getProperties();
    var allStocks = Store.getAllStocks();
    var itemSet = {};
    allStocks.forEach(function(s) { itemSet[s.itemId] = s.itemName; });
    var itemIds = Object.keys(itemSet).sort();

    var html = '<div class="overview-actions">'
      + '<button class="action-btn" onclick="App.exportCSV()">CSV出力</button>'
      + '</div>';

    html += '<div class="overview-scroll"><table class="overview-table"><thead><tr><th>品目</th>';
    properties.forEach(function(p) { html += '<th>' + esc(p.name) + '</th>'; });
    html += '</tr></thead><tbody>';

    itemIds.forEach(function(iid) {
      html += '<tr><td class="item-label">' + esc(itemSet[iid]) + '</td>';
      properties.forEach(function(p) {
        var stock = Store.getStock(p.propertyId, iid);
        if (stock) {
          var cls = stock.status === '要補充' ? 'cell-shortage' : (stock.status === '残り少' ? 'cell-low' : '');
          html += '<td class="' + cls + '">' + stock.current + '</td>';
        } else {
          html += '<td class="cell-na">—</td>';
        }
      });
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
  }

  // ============================================================
  // 発注リストタブ
  // ============================================================
  function renderOrderTab() {
    var container = document.getElementById('content-order');
    container.innerHTML = '<div class="loading-inline">読み込み中…</div>';

    Api.getShortageList().then(function(result) {
      if (!result.ok) { container.innerHTML = '<div class="empty-msg">読み込みに失敗しました</div>'; return; }
      var list = result.data;
      if (list.length === 0) {
        container.innerHTML = '<div class="empty-msg">発注が必要な品目はありません</div>';
        return;
      }

      var grouped = {};
      list.forEach(function(r) {
        if (!grouped[r.propertyName]) grouped[r.propertyName] = [];
        grouped[r.propertyName].push(r);
      });

      var html = '<div class="order-actions">'
        + '<button class="action-btn" onclick="App.sendOrderEmail()">発注リストをメールで送る</button>'
        + '</div>';

      Object.keys(grouped).forEach(function(pn) {
        html += '<div class="order-group"><h3 class="order-property">' + esc(pn) + '</h3>';
        grouped[pn].forEach(function(r) {
          var cls = r.status === '要補充' ? 'row-shortage' : 'row-low';
          html += '<div class="order-row ' + cls + '">'
            + '<div class="order-info">'
            + '<div class="order-name">' + esc(r.itemName) + ' <span class="order-status">' + esc(r.status) + '</span></div>'
            + '<div class="order-detail">現在 ' + r.current + ' ／ 最低 ' + r.minimum + '</div>'
            + '</div>';
          if (r.supplierUrl) {
            html += '<a href="' + esc(r.supplierUrl) + '" target="_blank" rel="noopener" class="order-link">購入</a>';
          }
          html += '</div>';
        });
        html += '</div>';
      });
      container.innerHTML = html;
    }).catch(function() {
      container.innerHTML = '<div class="empty-msg">通信エラーです</div>';
    });
  }

  // ============================================================
  // 履歴タブ
  // ============================================================
  function renderHistoryTab() {
    var container = document.getElementById('content-history');
    container.innerHTML = '<div class="loading-inline">読み込み中…</div>';

    Api.getLogs(100).then(function(result) {
      if (!result.ok) { container.innerHTML = '<div class="empty-msg">読み込みに失敗しました</div>'; return; }
      var logs = result.data;
      if (logs.length === 0) {
        container.innerHTML = '<div class="empty-msg">更新履歴がありません</div>';
        return;
      }

      var html = '<div class="history-scroll"><table class="history-table"><thead><tr>'
        + '<th>日時</th><th>物件</th><th>品目</th><th>変更</th><th>操作</th><th>更新者</th>'
        + '</tr></thead><tbody>';

      logs.forEach(function(l) {
        html += '<tr>'
          + '<td class="td-date">' + esc(l.datetime) + '</td>'
          + '<td>' + esc(l.propertyName) + '</td>'
          + '<td>' + esc(l.itemName) + '</td>'
          + '<td class="td-diff">' + l.before + ' → ' + l.after + ' (' + esc(String(l.diff)) + ')</td>'
          + '<td>' + esc(l.operation) + '</td>'
          + '<td>' + esc(l.updatedBy) + '</td>'
          + '</tr>';
      });
      html += '</tbody></table></div>';
      container.innerHTML = html;
    }).catch(function() {
      container.innerHTML = '<div class="empty-msg">通信エラーです</div>';
    });
  }

  // ============================================================
  // 設定タブ (admin)
  // ============================================================
  function renderSettingsTab() {
    var container = document.getElementById('content-settings');
    var properties = Store.getProperties();

    // 登録済み物件一覧
    var html = '<div class="settings-section">'
      + '<h3>📋 登録済み物件</h3>';

    if (properties.length === 0) {
      html += '<p class="settings-empty">物件がまだ登録されていません</p>';
    } else {
      properties.forEach(function(p) {
        html += '<div class="prop-card" id="prop-card-' + p.propertyId + '">'
          + '<div class="prop-card-header">'
          + '<div class="prop-card-name">' + esc(p.name) + '</div>'
          + '<div class="prop-card-actions">'
          + '<button class="prop-btn prop-btn-edit" onclick="App.showEditProperty(\'' + p.propertyId + '\')" title="編集">✏️</button>'
          + '<button class="prop-btn prop-btn-delete" onclick="App.deleteProperty(\'' + p.propertyId + '\',\'' + esc(p.name).replace(/'/g, "\\'") + '\')" title="削除">🗑️</button>'
          + '</div>'
          + '</div>'
          + '<div class="prop-card-details">'
          + '<div class="prop-detail">📍 ' + esc(p.location || '未設定') + '</div>'
          + '<div class="prop-detail">🛏️ ' + (p.rooms || 0) + '部屋</div>'
          + '<div class="prop-detail">👤 ' + esc(p.manager || '未設定') + '</div>'
          + '<div class="prop-detail">📧 ' + esc(p.notifyEmail || '未設定') + '</div>'
          + '</div>'
          + '<div class="prop-card-edit" id="prop-edit-' + p.propertyId + '" style="display:none;">'
          + '<div class="form-group"><label>物件名</label><input type="text" id="edit-name-' + p.propertyId + '" value="' + esc(p.name) + '"></div>'
          + '<div class="form-group"><label>所在地</label><input type="text" id="edit-location-' + p.propertyId + '" value="' + esc(p.location || '') + '"></div>'
          + '<div class="form-group"><label>部屋数</label><input type="number" id="edit-rooms-' + p.propertyId + '" value="' + (p.rooms || 1) + '" min="1"></div>'
          + '<div class="form-group"><label>担当者</label><input type="text" id="edit-manager-' + p.propertyId + '" value="' + esc(p.manager || '') + '"></div>'
          + '<div class="form-group"><label>通知メール</label><input type="email" id="edit-email-' + p.propertyId + '" value="' + esc(p.notifyEmail || '') + '"></div>'
          + '<div class="prop-edit-buttons">'
          + '<button class="action-btn" onclick="App.saveEditProperty(\'' + p.propertyId + '\')">保存</button>'
          + '<button class="action-btn action-btn-cancel" onclick="App.cancelEditProperty(\'' + p.propertyId + '\')">キャンセル</button>'
          + '</div>'
          + '</div>'
          + '</div>';
      });
    }
    html += '</div>';

    // 物件追加フォーム
    html += '<div class="settings-section">'
      + '<h3>➕ 物件を追加</h3>'
      + '<div class="form-group"><label>物件名</label><input type="text" id="new-prop-name" placeholder="例: 高松ゲストハウス"></div>'
      + '<div class="form-group"><label>所在地</label><input type="text" id="new-prop-location" placeholder="例: 香川県高松市"></div>'
      + '<div class="form-group"><label>部屋数</label><input type="number" id="new-prop-rooms" value="1" min="1"></div>'
      + '<div class="form-group"><label>担当者</label><input type="text" id="new-prop-manager"></div>'
      + '<div class="form-group"><label>通知メール</label><input type="email" id="new-prop-email"></div>'
      + '<button class="action-btn" onclick="App.addProperty()">物件を追加</button>'
      + '</div>';

    // 品目追加
    html += '<div class="settings-section">'
      + '<h3>➕ 品目を追加</h3>'
      + '<div class="form-group"><label>品目名</label><input type="text" id="new-item-name" placeholder="例: ハンドソープ"></div>'
      + '<div class="form-group"><label>カテゴリ</label><select id="new-item-category">'
      + '<option>アメニティ</option><option>消耗品</option><option>リネン</option><option>備品</option></select></div>'
      + '<div class="form-group"><label>単位</label><input type="text" id="new-item-unit" value="個"></div>'
      + '<div class="form-group"><label>発注単位数</label><input type="number" id="new-item-orderqty" value="1" min="1"></div>'
      + '<div class="form-group"><label>単価(円)</label><input type="number" id="new-item-price" value="0" min="0"></div>'
      + '<div class="form-group"><label>購入先</label><input type="text" id="new-item-supplier"></div>'
      + '<div class="form-group"><label>購入先URL</label><input type="url" id="new-item-url"></div>'
      + '<button class="action-btn" onclick="App.addItem()">品目を追加</button>'
      + '</div>';

    html += '<div class="settings-section">'
      + '<h3>👥 権限マスタ</h3>'
      + '<p>スタッフの追加・削除はGoogle スプレッドシートの「権限マスタ」シートを直接編集してください。</p>'
      + '</div>';

    container.innerHTML = html;
  }

  // ============================================================
  // ユーティリティ
  // ============================================================
  function esc(str) {
    if (str == null) return '';
    var d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
  }

  return {
    setSyncStatus: setSyncStatus, updatePendingBadge: updatePendingBadge,
    showToast: showToast, showLoading: showLoading, hideLoading: hideLoading,
    showLoginScreen: showLoginScreen, showAppScreen: showAppScreen,
    renderHeader: renderHeader, switchTab: switchTab,
    renderStockTab: renderStockTab, renderStockList: renderStockList, renderAlertSummary: renderAlertSummary,
    renderOverviewTab: renderOverviewTab, renderOrderTab: renderOrderTab,
    renderHistoryTab: renderHistoryTab, renderSettingsTab: renderSettingsTab
  };
})();
