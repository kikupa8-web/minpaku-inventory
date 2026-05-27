var Api = (function() {
  var PENDING_KEY = 'minpaku_pending';

  function callAPI(action, data) {
    var payload = Object.assign({}, data || {}, {
      action: action,
      idToken: Auth.getToken()
    });

    return fetch(AppConfig.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    })
    .then(function(r) { return r.json(); })
    .then(function(result) {
      if (!result.ok && result.error && result.error.indexOf('認証') >= 0) {
        Auth.logout();
        location.reload();
      }
      return result;
    });
  }

  function getInitialData() {
    return callAPI('getInitialData');
  }

  function updateStock(propertyId, itemId, delta, previousValue, operation) {
    var params = {
      propertyId: propertyId,
      itemId: itemId,
      delta: delta,
      previousValue: previousValue,
      operation: operation || (delta > 0 ? '補充' : '使用')
    };

    if (!navigator.onLine) {
      queuePending(Object.assign({ action: 'updateStock' }, params));
      return Promise.resolve({ ok: true, offline: true, data: {
        newValue: previousValue + delta,
        status: '',
        updatedAt: formatNow(),
        updatedBy: Auth.getUser() ? Auth.getUser().name : ''
      }});
    }

    return callAPI('updateStock', params);
  }

  function setStock(propertyId, itemId, value, operation) {
    return callAPI('setStock', {
      propertyId: propertyId, itemId: itemId,
      value: value, operation: operation || '修正'
    });
  }

  function addProperty(data) { return callAPI('addProperty', data); }
  function editProperty(data) { return callAPI('editProperty', data); }
  function deleteProperty(propertyId) { return callAPI('deleteProperty', { propertyId: propertyId }); }
  function addItem(data) { return callAPI('addItem', data); }
  function editItem(data) { return callAPI('editItem', data); }
  function deleteItem(itemId) { return callAPI('deleteItem', { itemId: itemId }); }
  function addStockRecord(data) { return callAPI('addStockRecord', data); }
  function removeStockRecord(propertyId, itemId) { return callAPI('removeStockRecord', { propertyId: propertyId, itemId: itemId }); }
  function addPermission(data) { return callAPI('addPermission', data); }
  function editPermission(data) { return callAPI('editPermission', data); }
  function deletePermission(email) { return callAPI('deletePermission', { email: email }); }
  function getShortageList() { return callAPI('getShortageList'); }
  function getLogs(limit) { return callAPI('getLogs', { limit: limit || 100 }); }

  function queuePending(item) {
    var q = getPendingQueue();
    item._ts = Date.now();
    q.push(item);
    localStorage.setItem(PENDING_KEY, JSON.stringify(q));
    UI.updatePendingBadge(q.length);
  }

  function getPendingQueue() {
    try { return JSON.parse(localStorage.getItem(PENDING_KEY)) || []; }
    catch(e) { return []; }
  }

  function processPendingQueue() {
    var q = getPendingQueue();
    if (q.length === 0) return Promise.resolve();

    UI.setSyncStatus('syncing');
    var chain = Promise.resolve();

    q.forEach(function(item, idx) {
      chain = chain.then(function() {
        return callAPI(item.action, item).then(function(result) {
          if (result.ok) {
            var remaining = getPendingQueue().filter(function(x) { return x._ts !== item._ts; });
            localStorage.setItem(PENDING_KEY, JSON.stringify(remaining));
            UI.updatePendingBadge(remaining.length);
          }
          return result;
        }).catch(function() { /* retry next time */ });
      });
    });

    return chain.then(function() {
      var remain = getPendingQueue();
      UI.setSyncStatus(remain.length > 0 ? 'error' : 'saved');
      if (remain.length === 0) App.refreshData();
    });
  }

  function formatNow() {
    var d = new Date();
    var pad = function(n) { return n < 10 ? '0' + n : n; };
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function getPendingCount() { return getPendingQueue().length; }

  return {
    getInitialData: getInitialData, updateStock: updateStock, setStock: setStock,
    addProperty: addProperty, editProperty: editProperty, deleteProperty: deleteProperty,
    addItem: addItem, editItem: editItem, deleteItem: deleteItem,
    addStockRecord: addStockRecord, removeStockRecord: removeStockRecord,
    addPermission: addPermission, editPermission: editPermission, deletePermission: deletePermission,
    getShortageList: getShortageList,
    getLogs: getLogs, processPendingQueue: processPendingQueue, getPendingCount: getPendingCount
  };
})();
