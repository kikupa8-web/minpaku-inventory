var UI = (function() {
  // ============================================================
  // カテゴリ折りたたみ・並び替え状態
  // ============================================================
  var collapsedStockCats = {};
  var collapsedSettingsCats = {};
  var stockSortKey = 'name-asc';
  var CAT_ORDER = ['アメニティ', '消耗品', 'リネン', '備品'];
  var SUPPLIER_OPTIONS = ['Amazon', '楽天', 'スーパー', 'ニトリ', '無印良品'];

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
    var duration = type === 'error' ? 5000 : 3000;
    setTimeout(function() {
      toast.classList.remove('toast-show');
      setTimeout(function() { toast.remove(); }, 300);
    }, duration);
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
  // ヘルパー：カテゴリ順にグループ化
  // ============================================================
  function groupByCategory(arr, catKey) {
    var groups = {};
    arr.forEach(function(item) {
      var c = item[catKey] || 'その他';
      if (!groups[c]) groups[c] = [];
      groups[c].push(item);
    });
    var ordered = [];
    CAT_ORDER.forEach(function(c) { if (groups[c]) ordered.push(c); });
    Object.keys(groups).forEach(function(c) {
      if (ordered.indexOf(c) === -1) ordered.push(c);
    });
    return { groups: groups, order: ordered };
  }

  // ヘルパー：在庫ソート
  function sortStockItems(arr, key) {
    var sorted = arr.slice();
    switch(key) {
      case 'name-asc':
        sorted.sort(function(a,b) { return (a.itemName||'').localeCompare(b.itemName||'', 'ja'); });
        break;
      case 'name-desc':
        sorted.sort(function(a,b) { return (b.itemName||'').localeCompare(a.itemName||'', 'ja'); });
        break;
      case 'stock-asc':
        sorted.sort(function(a,b) { return a.current - b.current; });
        break;
      case 'stock-desc':
        sorted.sort(function(a,b) { return b.current - a.current; });
        break;
      case 'status':
        sorted.sort(function(a,b) {
          var o = {'要補充': 0, '残り少': 1, 'OK': 2};
          return (o[a.status]!=null?o[a.status]:2) - (o[b.status]!=null?o[b.status]:2);
        });
        break;
    }
    return sorted;
  }

  // ヘルパー：類似品グルーピング
  function longestCommonSub(a, b) {
    if (!a || !b) return '';
    var best = '';
    for (var i = 0; i < a.length; i++) {
      for (var len = 2; len <= a.length - i; len++) {
        var sub = a.substring(i, i + len);
        if (sub.length > best.length && b.indexOf(sub) >= 0) best = sub;
      }
    }
    return best;
  }

  function smartGroupSort(items, nameKey) {
    if (items.length <= 1) return { items: items.slice(), breaks: [] };
    var names = items.map(function(it) { return it[nameKey] || ''; });
    var keys = names.map(function(name, i) {
      var bestKey = '';
      for (var j = 0; j < names.length; j++) {
        if (i === j) continue;
        var common = longestCommonSub(name, names[j]);
        if (common.length > bestKey.length) bestKey = common;
      }
      return bestKey.length >= 2 ? bestKey : name;
    });
    var indexed = items.map(function(it, i) { return { item: it, key: keys[i], name: names[i] }; });
    indexed.sort(function(a, b) {
      if (a.key !== b.key) return a.key.localeCompare(b.key, 'ja');
      return a.name.localeCompare(b.name, 'ja');
    });
    var breaks = [];
    for (var i = 1; i < indexed.length; i++) {
      if (indexed[i].key !== indexed[i - 1].key) breaks.push(i);
    }
    return { items: indexed.map(function(x) { return x.item; }), breaks: breaks };
  }

  // ============================================================
  // 折りたたみ・並び替え操作
  // ============================================================
  function toggleStockCat(cat) {
    collapsedStockCats[cat] = !collapsedStockCats[cat];
    renderStockList();
  }
  function toggleSettingsCat(cat) {
    collapsedSettingsCats[cat] = !collapsedSettingsCats[cat];
    renderSettingsTab();
  }
  function toggleAllStockCats() {
    var cats = Store.getCategories();
    var allCollapsed = cats.every(function(c) { return !!collapsedStockCats[c]; });
    cats.forEach(function(c) { collapsedStockCats[c] = !allCollapsed; });
    renderStockList();
  }
  function toggleAllSettingsCats() {
    var cats = Store.getCategories();
    var allCollapsed = cats.every(function(c) { return !!collapsedSettingsCats[c]; });
    cats.forEach(function(c) { collapsedSettingsCats[c] = !allCollapsed; });
    renderSettingsTab();
  }
  function setStockSort(key) {
    stockSortKey = key;
    renderStockList();
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

    var user = Auth.getUser();
    var isAdmin = user && user.role === 'admin';

    var html = '';

    // 並び替えバー
    html += '<div class="sort-bar">'
      + '<label>並び替え</label>'
      + '<select class="sort-select" onchange="UI.setStockSort(this.value)">'
      + '<option value="name-asc"' + (stockSortKey==='name-asc'?' selected':'') + '>類似品まとめ</option>'
      + '<option value="stock-asc"' + (stockSortKey==='stock-asc'?' selected':'') + '>在庫少ない順</option>'
      + '<option value="stock-desc"' + (stockSortKey==='stock-desc'?' selected':'') + '>在庫多い順</option>'
      + '<option value="status"' + (stockSortKey==='status'?' selected':'') + '>ステータス順</option>'
      + '</select>'
      + '<button class="btn-expand-all" onclick="UI.toggleAllStockCats()">全開閉</button>'
      + '</div>';

    if (stocks.length === 0) {
      html += '<div class="empty-msg">この物件の在庫データがありません</div>';
    } else {
      var result = groupByCategory(stocks, 'category');

      result.order.forEach(function(catName) {
        var catItems = result.groups[catName];
        var items, breakSet = {};
        if (stockSortKey === 'name-asc') {
          var sg = smartGroupSort(catItems, 'itemName');
          items = sg.items;
          sg.breaks.forEach(function(b) { breakSet[b] = true; });
        } else {
          items = sortStockItems(catItems, stockSortKey);
        }
        var isCollapsed = !!collapsedStockCats[catName];
        var shortage = items.filter(function(s){ return s.status === '要補充'; }).length;
        var low = items.filter(function(s){ return s.status === '残り少'; }).length;
        var alertHtml = '';
        if (shortage > 0) alertHtml += ' <span class="cat-alert cat-alert-shortage">要補充' + shortage + '</span>';
        if (low > 0) alertHtml += ' <span class="cat-alert cat-alert-low">残少' + low + '</span>';

        html += '<div class="cat-group">'
          + '<div class="cat-header" onclick="UI.toggleStockCat(\'' + escAttr(catName) + '\')">'
          + '<div class="cat-header-left">'
          + '<span class="cat-toggle' + (isCollapsed ? ' collapsed' : '') + '">▼</span>'
          + '<span>' + esc(catName) + '</span>'
          + '<span class="cat-count">' + items.length + '件</span>'
          + alertHtml
          + '</div></div>'
          + '<div class="cat-body' + (isCollapsed ? ' collapsed' : '') + '">';

        items.forEach(function(s, idx) {
          var rowClass = s.status === '要補充' ? 'row-shortage' : (s.status === '残り少' ? 'row-low' : 'row-ok');
          var gapClass = breakSet[idx] ? ' item-group-gap' : '';
          var editKey = s.propertyId + '-' + s.itemId;
          html += '<div class="stock-row-wrap ' + gapClass + '">'
            + '<div class="stock-row ' + rowClass + '">'
            + '<div class="stock-info">'
            + '<div class="stock-name">' + esc(s.itemName) + '</div>'
            + '<div class="stock-meta">最低 ' + s.minimum + ' ／ ' + esc(s.status) + '</div>'
            + '</div>'
            + '<div class="stock-controls">'
            + '<button class="btn-minus" aria-label="1減らす" onclick="App.handleStock(\'' + s.propertyId + '\',\'' + s.itemId + '\',-1)">−</button>'
            + '<span class="stock-value">' + s.current + '</span>'
            + '<button class="btn-plus" aria-label="1増やす" onclick="App.handleStock(\'' + s.propertyId + '\',\'' + s.itemId + '\',1)">＋</button>'
            + (isAdmin ? '<button class="btn-stock-edit" aria-label="編集" onclick="App.showEditStock(\'' + s.propertyId + '\',\'' + s.itemId + '\')">✏️</button>' : '')
            + (isAdmin ? '<button class="btn-stock-remove" aria-label="削除" onclick="App.removeStockRecord(\'' + s.propertyId + '\',\'' + s.itemId + '\',\'' + escAttr(s.itemName) + '\')">🗑️</button>' : '')
            + '</div></div>'
            + (isAdmin ? '<div class="stock-edit-panel" id="stock-edit-' + editKey + '" style="display:none;">'
              + '<div class="stock-edit-row">'
              + '<div class="form-group"><label>最低数</label><input type="number" id="stock-edit-min-' + editKey + '" value="' + s.minimum + '" min="0"></div>'
              + '<div class="form-group"><label>在庫数</label><input type="number" id="stock-edit-cur-' + editKey + '" value="' + s.current + '" min="0"></div>'
              + '</div>'
              + '<div class="mgmt-edit-buttons">'
              + '<button class="action-btn" onclick="App.saveEditStock(\'' + s.propertyId + '\',\'' + s.itemId + '\')">保存</button>'
              + '<button class="action-btn action-btn-cancel" onclick="App.showEditStock(\'' + s.propertyId + '\',\'' + s.itemId + '\')">閉じる</button>'
              + '</div></div>' : '')
            + '</div>';
        });
        html += '</div></div>';
      });
    }

    // 管理者のみ：品目追加
    if (isAdmin) {
      html += '<div id="stock-add-area" class="stock-add-area">'
        + '<button class="action-btn stock-add-btn" onclick="App.showAddStockForm()">＋ この物件に品目を追加</button>'
        + '<div id="stock-add-form" style="display:none;" class="stock-add-form">'
        + '<div class="form-group"><label>カテゴリで絞り込み</label><select id="stock-add-cat-filter" class="property-select" onchange="UI.filterStockAddItems()"><option value="">すべて</option><option>アメニティ</option><option>消耗品</option><option>リネン</option><option>備品</option></select></div>'
        + '<div class="form-group"><label>品目を選択</label><select id="stock-add-item" class="property-select"></select></div>'
        + '<div class="form-group"><label>最低数（これを下回るとアラート）</label><input type="number" id="stock-add-min" value="5" min="0"></div>'
        + '<div class="form-group"><label>初期在庫数</label><input type="number" id="stock-add-initial" value="0" min="0"></div>'
        + '<div class="mgmt-edit-buttons">'
        + '<button class="action-btn" onclick="App.addStockRecord()">追加</button>'
        + '<button class="action-btn action-btn-cancel" onclick="App.hideAddStockForm()">キャンセル</button>'
        + '</div></div></div>';
    }

    container.innerHTML = html;

    // 品目セレクトボックスを埋める（未登録品目のみ）
    if (isAdmin) {
      filterStockAddItems();
    }
  }

  // ============================================================
  // 全体俯瞰タブ
  // ============================================================
  function renderOverviewTab() {
    var container = document.getElementById('content-overview');
    var properties = Store.getProperties();
    var allStocks = Store.getAllStocks();
    var itemSet = {};
    allStocks.forEach(function(s) {
      itemSet[s.itemId] = { name: s.itemName, category: s.category || 'その他' };
    });
    var itemIds = Object.keys(itemSet);

    // カテゴリ順にソート
    itemIds.sort(function(a, b) {
      var ca = CAT_ORDER.indexOf(itemSet[a].category);
      var cb = CAT_ORDER.indexOf(itemSet[b].category);
      if (ca === -1) ca = 99;
      if (cb === -1) cb = 99;
      if (ca !== cb) return ca - cb;
      return (itemSet[a].name || '').localeCompare(itemSet[b].name || '', 'ja');
    });

    var html = '<div class="overview-actions">'
      + '<button class="action-btn" onclick="App.exportCSV()">CSV出力</button>'
      + '</div>';

    html += '<div class="overview-scroll"><table class="overview-table"><thead><tr><th>カテゴリ</th><th>品目</th>';
    properties.forEach(function(p) { html += '<th>' + esc(p.name) + '</th>'; });
    html += '</tr></thead><tbody>';

    var prevCat = '';
    itemIds.forEach(function(iid) {
      var info = itemSet[iid];
      var showCat = info.category !== prevCat;
      prevCat = info.category;
      html += '<tr><td class="item-label">' + (showCat ? esc(info.category) : '') + '</td>';
      html += '<td class="item-label">' + esc(info.name) + '</td>';
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
    var items = Store.getItems();
    var permissions = Store.getPermissions();

    // ========== 登録済み物件一覧 ==========
    var html = '<div class="settings-section">'
      + '<h3>📋 登録済み物件</h3>';
    if (properties.length === 0) {
      html += '<p class="settings-empty">物件がまだ登録されていません</p>';
    } else {
      properties.forEach(function(p) {
        html += renderPropertyCard(p);
      });
    }
    html += '</div>';

    // ========== 物件追加 ==========
    html += '<div class="settings-section">'
      + '<h3>➕ 物件を追加</h3>'
      + '<div class="form-group"><label>物件名</label><input type="text" id="new-prop-name" placeholder="例: 高松ゲストハウス"></div>'
      + '<div class="form-group"><label>所在地</label><input type="text" id="new-prop-location" placeholder="例: 香川県高松市"></div>'
      + '<div class="form-group"><label>部屋数</label><input type="number" id="new-prop-rooms" value="1" min="1"></div>'
      + '<div class="form-group"><label>担当者</label><input type="text" id="new-prop-manager"></div>'
      + '<div class="form-group"><label>通知メール</label><input type="email" id="new-prop-email"></div>'
      + '<button class="action-btn" onclick="App.addProperty()">物件を追加</button>'
      + '</div>';

    // ========== 登録済み品目一覧（カテゴリ別折りたたみ） ==========
    html += '<div class="settings-section">'
      + '<h3>📦 登録済み品目'
      + (items.length > 0 ? ' <button class="btn-expand-all" onclick="UI.toggleAllSettingsCats()" style="margin-left:8px;">全開閉</button>' : '')
      + '</h3>';
    if (items.length === 0) {
      html += '<p class="settings-empty">品目がまだ登録されていません</p>';
    } else {
      var result = groupByCategory(items, 'category');

      result.order.forEach(function(catName) {
        var sg = smartGroupSort(result.groups[catName], 'name');
        var catItems = sg.items;
        var breakSet = {};
        sg.breaks.forEach(function(b) { breakSet[b] = true; });
        var isCollapsed = !!collapsedSettingsCats[catName];

        html += '<div class="cat-group">'
          + '<div class="cat-header" onclick="UI.toggleSettingsCat(\'' + escAttr(catName) + '\')">'
          + '<div class="cat-header-left">'
          + '<span class="cat-toggle' + (isCollapsed ? ' collapsed' : '') + '">▼</span>'
          + '<span>' + esc(catName) + '</span>'
          + '<span class="cat-count">' + catItems.length + '件</span>'
          + '</div></div>'
          + '<div class="cat-body' + (isCollapsed ? ' collapsed' : '') + '">';

        catItems.forEach(function(it, idx) {
          html += (breakSet[idx] ? '<div class="item-group-gap"></div>' : '') + renderItemCard(it);
        });
        html += '</div></div>';
      });
    }
    html += '</div>';

    // ========== 品目追加 ==========
    html += '<div class="settings-section">'
      + '<h3>➕ 品目を追加</h3>'
      + '<div class="form-group"><label>品目名</label><input type="text" id="new-item-name" placeholder="例: ハンドソープ"></div>'
      + '<div class="form-group"><label>カテゴリ</label><select id="new-item-category">'
      + '<option>アメニティ</option><option>消耗品</option><option>リネン</option><option>備品</option></select></div>'
      + '<div class="form-group"><label>単位</label><input type="text" id="new-item-unit" value="個"></div>'
      + '<div class="form-group"><label>発注単位数</label><input type="number" id="new-item-orderqty" value="1" min="1"></div>'
      + '<div class="form-group"><label>単価(円)</label><input type="number" id="new-item-price" value="0" min="0"></div>'
      + '<div class="form-group"><label>購入先</label>' + renderSupplierSelect('new-item-supplier', 'new-item-supplier-custom', '') + '</div>'
      + '<div class="form-group"><label>購入先URL</label><input type="url" id="new-item-url"></div>'
      + '<div class="form-group"><label>備考</label><input type="text" id="new-item-note" placeholder="例: 50個入"></div>'
      + '<button class="action-btn" onclick="App.addItem()">品目を追加</button>'
      + '</div>';

    // ========== スタッフ一覧 ==========
    html += '<div class="settings-section">'
      + '<h3>👥 スタッフ管理</h3>';
    if (permissions.length === 0) {
      html += '<p class="settings-empty">スタッフデータがありません</p>';
    } else {
      permissions.forEach(function(pm) {
        html += renderPermCard(pm);
      });
    }
    html += '</div>';

    // ========== スタッフ追加 ==========
    html += '<div class="settings-section">'
      + '<h3>➕ スタッフを追加</h3>'
      + '<div class="form-group"><label>メールアドレス</label><input type="email" id="new-perm-email" placeholder="例: staff@gmail.com"></div>'
      + '<div class="form-group"><label>表示名</label><input type="text" id="new-perm-name" placeholder="例: 田中太郎"></div>'
      + '<div class="form-group"><label>権限</label><select id="new-perm-role">'
      + '<option value="staff">スタッフ</option><option value="admin">管理者</option></select></div>'
      + '<button class="action-btn" onclick="App.addPermission()">スタッフを追加</button>'
      + '</div>';

    container.innerHTML = html;
  }

  // ============================================================
  // カード描画ヘルパー
  // ============================================================
  function renderPropertyCard(p) {
    return '<div class="mgmt-card" id="prop-card-' + p.propertyId + '">'
      + '<div class="mgmt-card-header">'
      + '<div class="mgmt-card-name">' + esc(p.name) + '</div>'
      + '<div class="mgmt-card-actions">'
      + '<button class="mgmt-btn mgmt-btn-edit" onclick="App.showEditProperty(\'' + p.propertyId + '\')" title="編集">✏️</button>'
      + '<button class="mgmt-btn mgmt-btn-delete" onclick="App.deleteProperty(\'' + p.propertyId + '\',\'' + escAttr(p.name) + '\')" title="削除">🗑️</button>'
      + '</div></div>'
      + '<div class="mgmt-card-details" id="prop-details-' + p.propertyId + '">'
      + '<div class="mgmt-detail">📍 ' + esc(p.location || '未設定') + '</div>'
      + '<div class="mgmt-detail">🛏️ ' + (p.rooms || 0) + '部屋　👤 ' + esc(p.manager || '未設定') + '</div>'
      + '<div class="mgmt-detail">📧 ' + esc(p.notifyEmail || '未設定') + '</div>'
      + '</div>'
      + '<div class="mgmt-card-edit" id="prop-edit-' + p.propertyId + '" style="display:none;">'
      + '<div class="form-group"><label>物件名</label><input type="text" id="edit-name-' + p.propertyId + '" value="' + esc(p.name) + '"></div>'
      + '<div class="form-group"><label>所在地</label><input type="text" id="edit-location-' + p.propertyId + '" value="' + esc(p.location || '') + '"></div>'
      + '<div class="form-group"><label>部屋数</label><input type="number" id="edit-rooms-' + p.propertyId + '" value="' + (p.rooms || 1) + '" min="1"></div>'
      + '<div class="form-group"><label>担当者</label><input type="text" id="edit-manager-' + p.propertyId + '" value="' + esc(p.manager || '') + '"></div>'
      + '<div class="form-group"><label>通知メール</label><input type="email" id="edit-email-' + p.propertyId + '" value="' + esc(p.notifyEmail || '') + '"></div>'
      + '<div class="mgmt-edit-buttons">'
      + '<button class="action-btn" onclick="App.saveEditProperty(\'' + p.propertyId + '\')">保存</button>'
      + '<button class="action-btn action-btn-cancel" onclick="App.cancelEditProperty(\'' + p.propertyId + '\')">キャンセル</button>'
      + '</div></div></div>';
  }

  function renderItemCard(it) {
    var safeId = it.itemId;
    return '<div class="mgmt-card" id="item-card-' + safeId + '">'
      + '<div class="mgmt-card-header">'
      + '<div class="mgmt-card-name">' + esc(it.name) + '</div>'
      + '<div class="mgmt-card-actions">'
      + '<button class="mgmt-btn mgmt-btn-edit" onclick="App.showEditItem(\'' + safeId + '\')" title="編集">✏️</button>'
      + '<button class="mgmt-btn mgmt-btn-delete" onclick="App.deleteItem(\'' + safeId + '\',\'' + escAttr(it.name) + '\')" title="削除">🗑️</button>'
      + '</div></div>'
      + '<div class="mgmt-card-details" id="item-details-' + safeId + '">'
      + '<div class="mgmt-detail">' + esc(it.unit || '個') + ' ／ 発注: ' + (it.orderQty || 1) + ' ／ ¥' + (it.price || 0) + '</div>'
      + (it.supplier ? '<div class="mgmt-detail">🛒 ' + esc(it.supplier) + '</div>' : '')
      + (it.note ? '<div class="mgmt-detail">📝 ' + esc(it.note) + '</div>' : '')
      + '</div>'
      + '<div class="mgmt-card-edit" id="item-edit-' + safeId + '" style="display:none;">'
      + '<div class="form-group"><label>品目名</label><input type="text" id="edit-item-name-' + safeId + '" value="' + esc(it.name) + '"></div>'
      + '<div class="form-group"><label>カテゴリ</label><select id="edit-item-cat-' + safeId + '">'
      + '<option' + (it.category==='アメニティ'?' selected':'') + '>アメニティ</option>'
      + '<option' + (it.category==='消耗品'?' selected':'') + '>消耗品</option>'
      + '<option' + (it.category==='リネン'?' selected':'') + '>リネン</option>'
      + '<option' + (it.category==='備品'?' selected':'') + '>備品</option></select></div>'
      + '<div class="form-group"><label>単位</label><input type="text" id="edit-item-unit-' + safeId + '" value="' + esc(it.unit || '個') + '"></div>'
      + '<div class="form-group"><label>発注単位数</label><input type="number" id="edit-item-oq-' + safeId + '" value="' + (it.orderQty || 1) + '" min="1"></div>'
      + '<div class="form-group"><label>単価(円)</label><input type="number" id="edit-item-price-' + safeId + '" value="' + (it.price || 0) + '" min="0"></div>'
      + '<div class="form-group"><label>購入先</label>' + renderSupplierSelect('edit-item-sup-' + safeId, 'edit-item-sup-custom-' + safeId, it.supplier || '') + '</div>'
      + '<div class="form-group"><label>購入先URL</label><input type="url" id="edit-item-url-' + safeId + '" value="' + esc(it.supplierUrl || '') + '"></div>'
      + '<div class="form-group"><label>備考</label><input type="text" id="edit-item-note-' + safeId + '" value="' + esc(it.note || '') + '"></div>'
      + '<div class="mgmt-edit-buttons">'
      + '<button class="action-btn" onclick="App.saveEditItem(\'' + safeId + '\')">保存</button>'
      + '<button class="action-btn action-btn-cancel" onclick="App.cancelEditItem(\'' + safeId + '\')">キャンセル</button>'
      + '</div></div></div>';
  }

  function renderPermCard(pm) {
    var safeEmail = escAttr(pm.email);
    return '<div class="mgmt-card" id="perm-card-' + esc(pm.email) + '">'
      + '<div class="mgmt-card-header">'
      + '<div class="mgmt-card-name">' + esc(pm.displayName || pm.email)
      + ' <span class="mgmt-badge ' + (pm.role==='admin'?'mgmt-badge-admin':'') + '">' + (pm.role==='admin'?'管理者':'スタッフ') + '</span>'
      + (!pm.active ? ' <span class="mgmt-badge mgmt-badge-inactive">無効</span>' : '')
      + '</div>'
      + '<div class="mgmt-card-actions">'
      + '<button class="mgmt-btn mgmt-btn-edit" onclick="App.showEditPerm(\'' + safeEmail + '\')" title="編集">✏️</button>'
      + '<button class="mgmt-btn mgmt-btn-delete" onclick="App.deletePerm(\'' + safeEmail + '\',\'' + escAttr(pm.displayName || pm.email) + '\')" title="削除">🗑️</button>'
      + '</div></div>'
      + '<div class="mgmt-card-details" id="perm-details-' + esc(pm.email) + '">'
      + '<div class="mgmt-detail">📧 ' + esc(pm.email) + '</div>'
      + '</div>'
      + '<div class="mgmt-card-edit" id="perm-edit-' + esc(pm.email) + '" style="display:none;">'
      + '<div class="form-group"><label>表示名</label><input type="text" id="edit-perm-name-' + esc(pm.email) + '" value="' + esc(pm.displayName || '') + '"></div>'
      + '<div class="form-group"><label>権限</label><select id="edit-perm-role-' + esc(pm.email) + '">'
      + '<option value="admin"' + (pm.role==='admin'?' selected':'') + '>管理者</option>'
      + '<option value="staff"' + (pm.role==='staff'?' selected':'') + '>スタッフ</option></select></div>'
      + '<div class="form-group"><label>有効</label><select id="edit-perm-active-' + esc(pm.email) + '">'
      + '<option value="true"' + (pm.active?' selected':'') + '>有効</option>'
      + '<option value="false"' + (!pm.active?' selected':'') + '>無効</option></select></div>'
      + '<div class="mgmt-edit-buttons">'
      + '<button class="action-btn" onclick="App.saveEditPerm(\'' + safeEmail + '\')">保存</button>'
      + '<button class="action-btn action-btn-cancel" onclick="App.cancelEditPerm(\'' + safeEmail + '\')">キャンセル</button>'
      + '</div></div></div>';
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

  function escAttr(str) {
    return esc(str).replace(/'/g, "\\'");
  }

  // 品目追加フォーム：カテゴリ絞り込み
  function filterStockAddItems() {
    var catFilter = document.getElementById('stock-add-cat-filter');
    var sel = document.getElementById('stock-add-item');
    if (!catFilter || !sel) return;
    var filterCat = catFilter.value;
    var pid = Store.getSelectedPropertyId();
    var existingItemIds = {};
    Store.getStocksForProperty(pid).forEach(function(s) { existingItemIds[s.itemId] = true; });
    var allItems = Store.getItems();
    var available = allItems.filter(function(it) {
      if (existingItemIds[it.itemId]) return false;
      if (filterCat && it.category !== filterCat) return false;
      return true;
    });
    sel.innerHTML = '';
    if (available.length === 0) {
      sel.innerHTML = '<option value="">' + (filterCat ? 'このカテゴリの未登録品目はありません' : 'すべての品目が登録済みです') + '</option>';
    } else {
      available.forEach(function(it) {
        var opt = document.createElement('option');
        opt.value = it.itemId;
        opt.textContent = it.name + (filterCat ? '' : '（' + it.category + '）');
        sel.appendChild(opt);
      });
    }
  }

  // 購入先セレクト
  function renderSupplierSelect(selectId, customId, currentValue) {
    var isPreset = !currentValue || SUPPLIER_OPTIONS.indexOf(currentValue) >= 0;
    var html = '<select id="' + selectId + '" class="property-select" onchange="UI.onSupplierChange(\'' + selectId + '\',\'' + customId + '\')">'
      + '<option value="">未選択</option>';
    SUPPLIER_OPTIONS.forEach(function(s) {
      html += '<option value="' + s + '"' + (currentValue === s ? ' selected' : '') + '>' + s + '</option>';
    });
    html += '<option value="__other__"' + (!isPreset && currentValue ? ' selected' : '') + '>その他（手入力）</option></select>'
      + '<input type="text" id="' + customId + '" class="supplier-custom" style="' + (isPreset || !currentValue ? 'display:none;' : '') + '" placeholder="購入先を入力" value="' + (!isPreset ? esc(currentValue || '') : '') + '">';
    return html;
  }

  function onSupplierChange(selectId, customId) {
    var sel = document.getElementById(selectId);
    var inp = document.getElementById(customId);
    if (sel.value === '__other__') {
      inp.style.display = 'block';
      inp.focus();
    } else {
      inp.style.display = 'none';
      inp.value = '';
    }
  }

  function getSupplierValue(selectId, customId) {
    var sel = document.getElementById(selectId);
    if (!sel) return '';
    if (sel.value === '__other__') {
      return document.getElementById(customId).value.trim();
    }
    return sel.value;
  }

  return {
    setSyncStatus: setSyncStatus, updatePendingBadge: updatePendingBadge,
    showToast: showToast, showLoading: showLoading, hideLoading: hideLoading,
    showLoginScreen: showLoginScreen, showAppScreen: showAppScreen,
    renderHeader: renderHeader, switchTab: switchTab,
    renderStockTab: renderStockTab, renderStockList: renderStockList, renderAlertSummary: renderAlertSummary,
    renderOverviewTab: renderOverviewTab, renderOrderTab: renderOrderTab,
    renderHistoryTab: renderHistoryTab, renderSettingsTab: renderSettingsTab,
    toggleStockCat: toggleStockCat, toggleSettingsCat: toggleSettingsCat,
    toggleAllStockCats: toggleAllStockCats, toggleAllSettingsCats: toggleAllSettingsCats,
    setStockSort: setStockSort,
    filterStockAddItems: filterStockAddItems,
    onSupplierChange: onSupplierChange, getSupplierValue: getSupplierValue
  };
})();
