var App = (function() {

  function init() {
    Auth.init();

    if (Auth.isLoggedIn()) {
      onLoginSuccess();
    } else {
      UI.showLoginScreen();
      UI.hideLoading();
    }

    document.querySelectorAll('.tab-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        UI.switchTab(btn.dataset.tab);
      });
    });

    document.getElementById('property-select').addEventListener('change', function() {
      Store.setSelectedPropertyId(this.value);
      UI.renderStockTab();
    });

    document.getElementById('btn-logout').addEventListener('click', function() {
      Auth.logout();
      localStorage.removeItem('minpaku_store');
      UI.showLoginScreen();
    });

    window.addEventListener('online', function() {
      UI.setSyncStatus('syncing');
      Api.processPendingQueue();
    });

    window.addEventListener('offline', function() {
      UI.setSyncStatus('offline');
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('service-worker.js').catch(function(e) {
        console.log('SW registration failed:', e);
      });
    }

    window.addEventListener('beforeinstallprompt', function(e) {
      e.preventDefault();
      var installBtn = document.getElementById('btn-install');
      if (installBtn) {
        installBtn.style.display = 'inline-block';
        installBtn.addEventListener('click', function() {
          e.prompt();
          e.userChoice.then(function() { installBtn.style.display = 'none'; });
        });
      }
    });
  }

  function onLoginSuccess() {
    UI.showAppScreen();
    UI.showLoading();

    var hasCached = Store.loadCache();
    if (hasCached) {
      UI.renderHeader();
      UI.switchTab('stock');
      UI.hideLoading();
    }

    Api.getInitialData().then(function(result) {
      UI.hideLoading();
      if (!result.ok) {
        UI.showToast(result.error, 'error');
        if (result.error.indexOf('権限') >= 0) {
          Auth.logout();
          UI.showLoginScreen();
        }
        return;
      }

      Auth.setUser(result.data.user);
      Store.setData(result.data);
      UI.renderHeader();
      UI.switchTab(Store.getCurrentTab());
      UI.setSyncStatus(navigator.onLine ? 'saved' : 'offline');

      if (Api.getPendingCount() > 0 && navigator.onLine) {
        Api.processPendingQueue();
      }
    }).catch(function(err) {
      UI.hideLoading();
      if (!hasCached) {
        UI.showToast('サーバーに接続できません', 'error');
      }
      UI.setSyncStatus('offline');
    });
  }

  function refreshData() {
    Api.getInitialData().then(function(result) {
      if (result.ok) {
        Auth.setUser(result.data.user);
        Store.setData(result.data);
        UI.renderStockTab();
        UI.setSyncStatus('saved');
      }
    });
  }

  function handleStock(propertyId, itemId, delta) {
    var stock = Store.getStock(propertyId, itemId);
    if (!stock) return;

    var previousValue = stock.current;
    var newValue = previousValue + delta;
    if (newValue < 0) { UI.showToast('0未満にはできません', 'error'); return; }

    var operation = delta > 0 ? '補充' : '使用';
    var user = Auth.getUser();

    Store.updateStockLocal(propertyId, itemId, newValue, null,
      formatNow(), user ? user.name : '');
    UI.renderStockList();
    UI.renderAlertSummary();
    UI.setSyncStatus('syncing');

    Api.updateStock(propertyId, itemId, delta, previousValue, operation)
      .then(function(result) {
        if (result.offline) {
          UI.setSyncStatus('offline');
          return;
        }
        if (!result.ok) {
          Store.updateStockLocal(propertyId, itemId, previousValue);
          UI.renderStockList();
          UI.renderAlertSummary();
          UI.showToast(result.error, 'error');
          if (result.currentValue !== undefined) {
            Store.updateStockLocal(propertyId, itemId, result.currentValue);
            UI.renderStockList();
          }
          UI.setSyncStatus('error');
          return;
        }
        Store.updateStockLocal(propertyId, itemId, result.data.newValue,
          result.data.status, result.data.updatedAt, result.data.updatedBy);
        UI.renderStockList();
        UI.renderAlertSummary();
        UI.setSyncStatus('saved');
      })
      .catch(function() {
        Store.updateStockLocal(propertyId, itemId, previousValue);
        UI.renderStockList();
        UI.showToast('通信エラーが発生しました', 'error');
        UI.setSyncStatus('error');
      });
  }

  function exportCSV() {
    var stocks = Store.getAllStocks();
    var BOM = '﻿';
    var csv = BOM + '物件名,品目名,カテゴリ,現在数,最低数,差分,ステータス,最終更新,更新者\n';
    stocks.forEach(function(s) {
      csv += [s.propertyName, s.itemName, s.category, s.current, s.minimum,
        s.diff, s.status, s.updatedAt, s.updatedBy].map(function(v) {
        return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      }).join(',') + '\n';
    });
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '在庫一覧_' + formatNow().replace(/[: ]/g, '') + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    UI.showToast('CSVをダウンロードしました', 'success');
  }

  function sendOrderEmail() {
    UI.showToast('発注リストをオーナーにメール送信します（GAS経由）', 'info');
  }

  function addProperty() {
    var name = document.getElementById('new-prop-name').value.trim();
    if (!name) { UI.showToast('物件名を入力してください', 'error'); return; }

    UI.showLoading();
    Api.addProperty({
      name: name,
      location: document.getElementById('new-prop-location').value.trim(),
      rooms: document.getElementById('new-prop-rooms').value,
      manager: document.getElementById('new-prop-manager').value.trim(),
      notifyEmail: document.getElementById('new-prop-email').value.trim()
    }).then(function(result) {
      UI.hideLoading();
      if (result.ok) {
        UI.showToast('物件を追加しました: ' + result.data.propertyId, 'success');
        refreshData();
      } else {
        UI.showToast(result.error, 'error');
      }
    }).catch(function() {
      UI.hideLoading();
      UI.showToast('通信エラーです', 'error');
    });
  }

  function addItem() {
    var name = document.getElementById('new-item-name').value.trim();
    if (!name) { UI.showToast('品目名を入力してください', 'error'); return; }

    UI.showLoading();
    Api.addItem({
      name: name,
      category: document.getElementById('new-item-category').value,
      unit: document.getElementById('new-item-unit').value.trim(),
      orderQty: document.getElementById('new-item-orderqty').value,
      price: document.getElementById('new-item-price').value,
      supplier: document.getElementById('new-item-supplier').value.trim(),
      supplierUrl: document.getElementById('new-item-url').value.trim()
    }).then(function(result) {
      UI.hideLoading();
      if (result.ok) {
        UI.showToast('品目を追加しました: ' + result.data.itemId, 'success');
        refreshData();
      } else {
        UI.showToast(result.error, 'error');
      }
    }).catch(function() {
      UI.hideLoading();
      UI.showToast('通信エラーです', 'error');
    });
  }

  function formatNow() {
    var d = new Date();
    var p = function(n) { return n < 10 ? '0' + n : n; };
    return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  return {
    init: init, onLoginSuccess: onLoginSuccess, refreshData: refreshData,
    handleStock: handleStock, exportCSV: exportCSV, sendOrderEmail: sendOrderEmail,
    addProperty: addProperty, addItem: addItem
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
