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
    return Api.getInitialData().then(function(result) {
      if (result.ok) {
        Auth.setUser(result.data.user);
        Store.setData(result.data);
        UI.switchTab(Store.getCurrentTab());
        UI.setSyncStatus('saved');
      }
      return result;
    }).catch(function(err) {
      console.log('refreshData error:', err);
      UI.setSyncStatus('error');
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
      if (result.ok) {
        UI.showToast('物件を追加しました', 'success');
        return refreshData();
      } else {
        UI.showToast(result.error, 'error');
      }
    }).catch(function() {
      UI.showToast('通信エラーです', 'error');
    }).finally(function() {
      UI.hideLoading();
    });
  }

  function showEditProperty(propertyId) {
    var editPanel = document.getElementById('prop-edit-' + propertyId);
    var details = editPanel.previousElementSibling;
    if (editPanel) {
      editPanel.style.display = 'block';
      details.style.display = 'none';
    }
  }

  function cancelEditProperty(propertyId) {
    var editPanel = document.getElementById('prop-edit-' + propertyId);
    var details = editPanel.previousElementSibling;
    if (editPanel) {
      editPanel.style.display = 'none';
      details.style.display = 'block';
    }
  }

  function saveEditProperty(propertyId) {
    var name = document.getElementById('edit-name-' + propertyId).value.trim();
    if (!name) { UI.showToast('物件名を入力してください', 'error'); return; }

    UI.showLoading();
    Api.editProperty({
      propertyId: propertyId,
      name: name,
      location: document.getElementById('edit-location-' + propertyId).value.trim(),
      rooms: document.getElementById('edit-rooms-' + propertyId).value,
      manager: document.getElementById('edit-manager-' + propertyId).value.trim(),
      notifyEmail: document.getElementById('edit-email-' + propertyId).value.trim()
    }).then(function(result) {
      if (result.ok) {
        UI.showToast('物件を更新しました', 'success');
        return refreshData();
      } else {
        UI.showToast(result.error, 'error');
      }
    }).catch(function() {
      UI.showToast('通信エラーです', 'error');
    }).finally(function() {
      UI.hideLoading();
    });
  }

  function deleteProperty(propertyId, propertyName) {
    if (!confirm('「' + propertyName + '」を削除しますか？\n\nこの物件の在庫データもすべて削除されます。')) return;

    UI.showLoading();
    Api.deleteProperty(propertyId).then(function(result) {
      if (result.ok) {
        UI.showToast('物件を削除しました', 'success');
        return refreshData();
      } else {
        UI.showToast(result.error, 'error');
      }
    }).catch(function() {
      UI.showToast('通信エラーです', 'error');
    }).finally(function() {
      UI.hideLoading();
    });
  }

  // ============ 物件への品目追加 ============
  function showAddStockForm() {
    document.getElementById('stock-add-form').style.display = 'block';
  }
  function hideAddStockForm() {
    document.getElementById('stock-add-form').style.display = 'none';
  }
  function addStockRecord() {
    var itemId = document.getElementById('stock-add-item').value;
    if (!itemId) { UI.showToast('品目を選択してください', 'error'); return; }
    var pid = Store.getSelectedPropertyId();
    var minimum = document.getElementById('stock-add-min').value;
    var initial = document.getElementById('stock-add-initial').value;

    UI.showLoading();
    Api.addStockRecord({
      propertyId: pid,
      itemId: itemId,
      minimum: minimum,
      initial: initial
    }).then(function(result) {
      if (result.ok) {
        UI.showToast('品目を物件に追加しました', 'success');
        return refreshData();
      } else {
        UI.showToast(result.error, 'error');
      }
    }).catch(function() {
      UI.showToast('通信エラーです', 'error');
    }).finally(function() {
      UI.hideLoading();
    });
  }

  function removeStockRecord(propertyId, itemId, itemName) {
    if (!confirm('「' + itemName + '」をこの物件から外しますか？')) return;
    UI.showLoading();
    Api.removeStockRecord(propertyId, itemId).then(function(result) {
      if (result.ok) {
        UI.showToast('品目を物件から外しました', 'success');
        return refreshData();
      } else {
        UI.showToast(result.error, 'error');
      }
    }).catch(function() {
      UI.showToast('通信エラーです', 'error');
    }).finally(function() {
      UI.hideLoading();
    });
  }

  // ============ 品目管理 ============
  function showEditItem(itemId) {
    document.getElementById('item-edit-' + itemId).style.display = 'block';
    document.getElementById('item-details-' + itemId).style.display = 'none';
  }
  function cancelEditItem(itemId) {
    document.getElementById('item-edit-' + itemId).style.display = 'none';
    document.getElementById('item-details-' + itemId).style.display = 'block';
  }
  function saveEditItem(itemId) {
    var name = document.getElementById('edit-item-name-' + itemId).value.trim();
    if (!name) { UI.showToast('品目名を入力してください', 'error'); return; }
    UI.showLoading();
    Api.editItem({
      itemId: itemId,
      name: name,
      category: document.getElementById('edit-item-cat-' + itemId).value,
      unit: document.getElementById('edit-item-unit-' + itemId).value.trim(),
      orderQty: document.getElementById('edit-item-oq-' + itemId).value,
      price: document.getElementById('edit-item-price-' + itemId).value,
      supplier: document.getElementById('edit-item-sup-' + itemId).value.trim(),
      supplierUrl: document.getElementById('edit-item-url-' + itemId).value.trim(),
      note: document.getElementById('edit-item-note-' + itemId).value.trim()
    }).then(function(result) {
      if (result.ok) {
        UI.showToast('品目を更新しました', 'success');
        return refreshData();
      } else {
        UI.showToast(result.error, 'error');
      }
    }).catch(function() {
      UI.showToast('通信エラーです', 'error');
    }).finally(function() {
      UI.hideLoading();
    });
  }
  function deleteItem(itemId, itemName) {
    if (!confirm('「' + itemName + '」を削除しますか？\n\nこの品目の在庫データもすべて削除されます。')) return;
    UI.showLoading();
    Api.deleteItem(itemId).then(function(result) {
      if (result.ok) {
        UI.showToast('品目を削除しました', 'success');
        return refreshData();
      } else {
        UI.showToast(result.error, 'error');
      }
    }).catch(function() {
      UI.showToast('通信エラーです', 'error');
    }).finally(function() {
      UI.hideLoading();
    });
  }

  // ============ スタッフ管理 ============
  function showEditPerm(email) {
    document.getElementById('perm-edit-' + email).style.display = 'block';
    document.getElementById('perm-details-' + email).style.display = 'none';
  }
  function cancelEditPerm(email) {
    document.getElementById('perm-edit-' + email).style.display = 'none';
    document.getElementById('perm-details-' + email).style.display = 'block';
  }
  function saveEditPerm(email) {
    UI.showLoading();
    Api.editPermission({
      email: email,
      displayName: document.getElementById('edit-perm-name-' + email).value.trim(),
      role: document.getElementById('edit-perm-role-' + email).value,
      active: document.getElementById('edit-perm-active-' + email).value === 'true'
    }).then(function(result) {
      if (result.ok) {
        UI.showToast('スタッフ情報を更新しました', 'success');
        return refreshData();
      } else {
        UI.showToast(result.error, 'error');
      }
    }).catch(function() {
      UI.showToast('通信エラーです', 'error');
    }).finally(function() {
      UI.hideLoading();
    });
  }
  function deletePerm(email, name) {
    if (!confirm('「' + name + '」を削除しますか？\n\nこのスタッフはログインできなくなります。')) return;
    UI.showLoading();
    Api.deletePermission(email).then(function(result) {
      if (result.ok) {
        UI.showToast('スタッフを削除しました', 'success');
        return refreshData();
      } else {
        UI.showToast(result.error, 'error');
      }
    }).catch(function() {
      UI.showToast('通信エラーです', 'error');
    }).finally(function() {
      UI.hideLoading();
    });
  }
  function addPermission() {
    var email = document.getElementById('new-perm-email').value.trim();
    if (!email) { UI.showToast('メールアドレスを入力してください', 'error'); return; }
    UI.showLoading();
    Api.addPermission({
      email: email,
      displayName: document.getElementById('new-perm-name').value.trim(),
      role: document.getElementById('new-perm-role').value
    }).then(function(result) {
      if (result.ok) {
        UI.showToast('スタッフを追加しました', 'success');
        return refreshData();
      } else {
        UI.showToast(result.error, 'error');
      }
    }).catch(function() {
      UI.showToast('通信エラーです', 'error');
    }).finally(function() {
      UI.hideLoading();
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
      supplierUrl: document.getElementById('new-item-url').value.trim(),
      note: document.getElementById('new-item-note').value.trim()
    }).then(function(result) {
      if (result.ok) {
        UI.showToast('品目を追加しました', 'success');
        return refreshData();
      } else {
        UI.showToast(result.error, 'error');
      }
    }).catch(function() {
      UI.showToast('通信エラーです', 'error');
    }).finally(function() {
      UI.hideLoading();
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
    showAddStockForm: showAddStockForm, hideAddStockForm: hideAddStockForm,
    addStockRecord: addStockRecord, removeStockRecord: removeStockRecord,
    addProperty: addProperty, showEditProperty: showEditProperty,
    cancelEditProperty: cancelEditProperty, saveEditProperty: saveEditProperty,
    deleteProperty: deleteProperty,
    showEditItem: showEditItem, cancelEditItem: cancelEditItem,
    saveEditItem: saveEditItem, deleteItem: deleteItem,
    showEditPerm: showEditPerm, cancelEditPerm: cancelEditPerm,
    saveEditPerm: saveEditPerm, deletePerm: deletePerm, addPermission: addPermission,
    addItem: addItem
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
