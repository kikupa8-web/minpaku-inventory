var Store = (function() {
  var state = {
    properties: [],
    items: [],
    stocks: [],
    selectedPropertyId: null,
    selectedCategory: 'all',
    currentTab: 'stock'
  };

  var STORAGE_KEY = 'minpaku_store';

  function loadCache() {
    try {
      var cached = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (cached && cached.stocks && cached.stocks.length > 0) {
        state.properties = cached.properties || [];
        state.items = cached.items || [];
        state.stocks = cached.stocks || [];
        return true;
      }
    } catch(e) {}
    return false;
  }

  function saveCache() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      properties: state.properties,
      items: state.items,
      stocks: state.stocks
    }));
  }

  function setData(data) {
    state.properties = data.properties || [];
    state.items = data.items || [];
    state.stocks = data.stocks || [];
    if (state.properties.length > 0 && !state.selectedPropertyId) {
      state.selectedPropertyId = state.properties[0].propertyId;
    }
    saveCache();
  }

  function getProperties() { return state.properties; }
  function getItems() { return state.items; }

  function getStocksForProperty(propertyId) {
    var pid = propertyId || state.selectedPropertyId;
    return state.stocks.filter(function(s) { return s.propertyId === pid; });
  }

  function getAllStocks() { return state.stocks; }

  function getStock(propertyId, itemId) {
    for (var i = 0; i < state.stocks.length; i++) {
      if (state.stocks[i].propertyId === propertyId && state.stocks[i].itemId === itemId) {
        return state.stocks[i];
      }
    }
    return null;
  }

  function updateStockLocal(propertyId, itemId, newValue, status, updatedAt, updatedBy) {
    for (var i = 0; i < state.stocks.length; i++) {
      if (state.stocks[i].propertyId === propertyId && state.stocks[i].itemId === itemId) {
        state.stocks[i].current = newValue;
        state.stocks[i].diff = newValue - state.stocks[i].minimum;
        if (status) state.stocks[i].status = status;
        else {
          var min = state.stocks[i].minimum;
          state.stocks[i].status = newValue < min ? '要補充' : (newValue < min * 1.2 ? '残り少' : 'OK');
        }
        if (updatedAt) state.stocks[i].updatedAt = updatedAt;
        if (updatedBy) state.stocks[i].updatedBy = updatedBy;
        saveCache();
        return state.stocks[i];
      }
    }
    return null;
  }

  function getSelectedPropertyId() { return state.selectedPropertyId; }
  function setSelectedPropertyId(id) { state.selectedPropertyId = id; }
  function getSelectedCategory() { return state.selectedCategory; }
  function setSelectedCategory(cat) { state.selectedCategory = cat; }
  function getCurrentTab() { return state.currentTab; }
  function setCurrentTab(tab) { state.currentTab = tab; }

  function getCategories() {
    var cats = {};
    state.items.forEach(function(it) { if (it.category) cats[it.category] = true; });
    return Object.keys(cats);
  }

  function getShortageCount() {
    var pid = state.selectedPropertyId;
    return state.stocks.filter(function(s) {
      return s.propertyId === pid && s.status === '要補充';
    }).length;
  }

  function getLowCount() {
    var pid = state.selectedPropertyId;
    return state.stocks.filter(function(s) {
      return s.propertyId === pid && s.status === '残り少';
    }).length;
  }

  return {
    loadCache: loadCache, setData: setData,
    getProperties: getProperties, getItems: getItems,
    getStocksForProperty: getStocksForProperty, getAllStocks: getAllStocks,
    getStock: getStock, updateStockLocal: updateStockLocal,
    getSelectedPropertyId: getSelectedPropertyId, setSelectedPropertyId: setSelectedPropertyId,
    getSelectedCategory: getSelectedCategory, setSelectedCategory: setSelectedCategory,
    getCurrentTab: getCurrentTab, setCurrentTab: setCurrentTab,
    getCategories: getCategories, getShortageCount: getShortageCount, getLowCount: getLowCount
  };
})();
