// ============================================================
// 民泊在庫管理 API — Google Apps Script
// ============================================================
// 【設定手順】下の2つを自分の値に書き換えてください
var CONFIG = {
  SPREADSHEET_ID: '1kR2vjwsdWhteTEPpRgGVSQXnPUT6tzcIHkv_UBiPfjQ',
  GOOGLE_CLIENT_ID: '449521724423-6qlv4uommuankajslp6amp9r14daaogv.apps.googleusercontent.com'
};

var SHEETS = {
  PROPERTIES: '物件マスタ',
  ITEMS:      '品目マスタ',
  STOCKS:     '在庫マスタ',
  LOGS:       '更新ログ',
  DASHBOARD:  'ダッシュボード',
  PERMISSIONS:'権限マスタ'
};

// 在庫マスタのカラム番号 (1-based)
var SC = { PID:1, PNAME:2, IID:3, INAME:4, CAT:5, CUR:6, MIN:7, DIFF:8, STAT:9, UPDATED:10, UPDATER:11 };

// ============================================================
// エントリーポイント
// ============================================================
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;
    var idToken = body.idToken;

    var user = verifyToken_(idToken);
    if (!user) return res_({ ok:false, error:'認証に失敗しました。再ログインしてください。' });

    var perm = getPermission_(user.email);
    if (!perm) return res_({ ok:false, error:'権限がありません。管理者に連絡してください。' });

    user.displayName = perm.displayName;
    user.role = perm.role;

    switch (action) {
      case 'getInitialData': return res_(doGetInitialData_(user));
      case 'updateStock':    return res_(doUpdateStock_(body, user));
      case 'setStock':       return res_(doSetStock_(body, user));
      case 'addProperty':    return res_(doAddProperty_(body, user));
      case 'addItem':        return res_(doAddItem_(body, user));
      case 'getShortageList':return res_(doGetShortageList_());
      case 'getLogs':        return res_(doGetLogs_(body));
      default: return res_({ ok:false, error:'不明なアクションです: ' + action });
    }
  } catch (err) {
    Logger.log('doPost Error: ' + err + '\n' + err.stack);
    return res_({ ok:false, error:'サーバーエラーが発生しました。しばらく待ってから再試行してください。' });
  }
}

function doGet() {
  return ContentService.createTextOutput('民泊在庫管理APIは正常に動作しています。')
    .setMimeType(ContentService.MimeType.TEXT);
}

// ============================================================
// 認証・権限
// ============================================================
function verifyToken_(idToken) {
  if (!idToken) return null;
  try {
    var resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + idToken, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    var info = JSON.parse(resp.getContentText());
    if (info.aud !== CONFIG.GOOGLE_CLIENT_ID) {
      Logger.log('Token aud mismatch: ' + info.aud);
      return null;
    }
    return { email: info.email, name: info.name || info.email };
  } catch (e) {
    Logger.log('Token verification error: ' + e);
    return null;
  }
}

function getPermission_(email) {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEETS.PERMISSIONS);
  if (!sheet) return null;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase().trim() === email.toLowerCase().trim()) {
      if (String(data[i][3]).toUpperCase() === 'TRUE' || data[i][3] === true) {
        return { displayName: data[i][1], role: String(data[i][2]).toLowerCase() };
      }
      return null;
    }
  }
  return null;
}

// ============================================================
// getInitialData
// ============================================================
function doGetInitialData_(user) {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  var propSheet = ss.getSheetByName(SHEETS.PROPERTIES);
  var propData = propSheet.getDataRange().getValues();
  var properties = [];
  for (var i = 1; i < propData.length; i++) {
    if (String(propData[i][6]) === '稼働中') {
      properties.push({
        propertyId: propData[i][0], name: propData[i][1], location: propData[i][2],
        rooms: propData[i][3], manager: propData[i][4], notifyEmail: propData[i][5],
        status: propData[i][6], memo: propData[i][7]
      });
    }
  }

  var itemSheet = ss.getSheetByName(SHEETS.ITEMS);
  var itemData = itemSheet.getDataRange().getValues();
  var items = [];
  for (var i = 1; i < itemData.length; i++) {
    items.push({
      itemId: itemData[i][0], category: itemData[i][1], name: itemData[i][2],
      unit: itemData[i][3], orderQty: itemData[i][4], price: itemData[i][5],
      supplier: itemData[i][6], supplierUrl: itemData[i][7], note: itemData[i][8]
    });
  }

  var stockSheet = ss.getSheetByName(SHEETS.STOCKS);
  var stockData = stockSheet.getDataRange().getValues();
  var stocks = [];
  for (var i = 1; i < stockData.length; i++) {
    stocks.push({
      propertyId: stockData[i][0], propertyName: stockData[i][1],
      itemId: stockData[i][2], itemName: stockData[i][3], category: stockData[i][4],
      current: Number(stockData[i][5]), minimum: Number(stockData[i][6]),
      diff: Number(stockData[i][7]),
      status: String(stockData[i][8]),
      updatedAt: stockData[i][9] ? Utilities.formatDate(new Date(stockData[i][9]), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm') : '',
      updatedBy: stockData[i][10] || ''
    });
  }

  return {
    ok: true,
    data: {
      user: { email: user.email, name: user.displayName, role: user.role },
      properties: properties,
      items: items,
      stocks: stocks
    }
  };
}

// ============================================================
// updateStock (差分更新 — 楽観的ロック)
// ============================================================
function doUpdateStock_(body, user) {
  var propertyId = body.propertyId;
  var itemId = body.itemId;
  var delta = Number(body.delta);
  var previousValue = Number(body.previousValue);
  var operation = body.operation || (delta > 0 ? '補充' : '使用');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { ok:false, error:'他のユーザーが更新中です。数秒後に再試行してください。' };
  }

  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEETS.STOCKS);
    var data = sheet.getDataRange().getValues();
    var rowIndex = -1;

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(propertyId) && String(data[i][2]) === String(itemId)) {
        rowIndex = i + 1;
        break;
      }
    }
    if (rowIndex === -1) return { ok:false, error:'在庫レコードが見つかりません。' };

    var currentValue = Number(data[rowIndex - 1][SC.CUR - 1]);
    if (currentValue !== previousValue) {
      return {
        ok: false,
        error: '他のスタッフが先に更新しました。画面を更新してください。',
        currentValue: currentValue
      };
    }

    var newValue = currentValue + delta;
    if (newValue < 0) newValue = 0;

    var now = new Date();
    var nowStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');

    sheet.getRange(rowIndex, SC.CUR).setValue(newValue);
    sheet.getRange(rowIndex, SC.UPDATED).setValue(nowStr);
    sheet.getRange(rowIndex, SC.UPDATER).setValue(user.displayName);

    writeLog_(ss, now, propertyId, data[rowIndex-1][1], itemId, data[rowIndex-1][3], currentValue, newValue, delta, user.displayName, operation);

    var minimum = Number(data[rowIndex - 1][SC.MIN - 1]);
    var newStatus = calcStatus_(newValue, minimum);
    if (newValue < minimum) {
      checkAndNotify_(ss, propertyId, data[rowIndex-1][1], itemId, data[rowIndex-1][3], newValue, minimum);
    }

    return { ok:true, data:{ newValue:newValue, status:newStatus, updatedAt:nowStr, updatedBy:user.displayName } };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// setStock (絶対値設定)
// ============================================================
function doSetStock_(body, user) {
  var propertyId = body.propertyId;
  var itemId = body.itemId;
  var value = Number(body.value);
  var operation = body.operation || '修正';

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { ok:false, error:'他のユーザーが更新中です。数秒後に再試行してください。' };
  }

  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEETS.STOCKS);
    var data = sheet.getDataRange().getValues();
    var rowIndex = -1;

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(propertyId) && String(data[i][2]) === String(itemId)) {
        rowIndex = i + 1;
        break;
      }
    }
    if (rowIndex === -1) return { ok:false, error:'在庫レコードが見つかりません。' };

    var currentValue = Number(data[rowIndex - 1][SC.CUR - 1]);
    if (value < 0) value = 0;

    var now = new Date();
    var nowStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    var delta = value - currentValue;

    sheet.getRange(rowIndex, SC.CUR).setValue(value);
    sheet.getRange(rowIndex, SC.UPDATED).setValue(nowStr);
    sheet.getRange(rowIndex, SC.UPDATER).setValue(user.displayName);

    writeLog_(ss, now, propertyId, data[rowIndex-1][1], itemId, data[rowIndex-1][3], currentValue, value, delta, user.displayName, operation);

    var minimum = Number(data[rowIndex - 1][SC.MIN - 1]);
    var newStatus = calcStatus_(value, minimum);
    if (value < minimum) {
      checkAndNotify_(ss, propertyId, data[rowIndex-1][1], itemId, data[rowIndex-1][3], value, minimum);
    }

    return { ok:true, data:{ newValue:value, status:newStatus, updatedAt:nowStr, updatedBy:user.displayName } };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// addProperty (admin のみ)
// ============================================================
function doAddProperty_(body, user) {
  if (user.role !== 'admin') return { ok:false, error:'管理者権限が必要です。' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok:false, error:'他のユーザーが更新中です。' };

  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEETS.PROPERTIES);
    var data = sheet.getDataRange().getValues();

    var maxNum = 0;
    for (var i = 1; i < data.length; i++) {
      var num = parseInt(String(data[i][0]).replace('P',''), 10);
      if (num > maxNum) maxNum = num;
    }
    var newId = 'P' + String(maxNum + 1).padStart(3, '0');

    sheet.appendRow([
      newId,
      body.name || '',
      body.location || '',
      Number(body.rooms) || 0,
      body.manager || '',
      body.notifyEmail || '',
      body.status || '準備中',
      body.memo || ''
    ]);

    return { ok:true, data:{ propertyId:newId } };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// addItem (admin のみ)
// ============================================================
function doAddItem_(body, user) {
  if (user.role !== 'admin') return { ok:false, error:'管理者権限が必要です。' };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok:false, error:'他のユーザーが更新中です。' };

  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEETS.ITEMS);
    var data = sheet.getDataRange().getValues();

    var maxNum = 0;
    for (var i = 1; i < data.length; i++) {
      var m = String(data[i][0]).match(/I(\d+)/);
      if (m) { var n = parseInt(m[1],10); if (n > maxNum) maxNum = n; }
    }
    var catPrefix = { 'アメニティ':0, '消耗品':100, 'リネン':200, '備品':300 };
    var prefix = catPrefix[body.category] !== undefined ? catPrefix[body.category] : 0;
    var nextInCat = prefix + 1;
    for (var i = 1; i < data.length; i++) {
      var m2 = String(data[i][0]).match(/I(\d+)/);
      if (m2) {
        var n2 = parseInt(m2[1],10);
        if (n2 >= prefix && n2 < prefix + 100 && n2 >= nextInCat) nextInCat = n2 + 1;
      }
    }
    var newId = 'I' + String(nextInCat).padStart(3, '0');

    sheet.appendRow([
      newId,
      body.category || '',
      body.name || '',
      body.unit || '個',
      Number(body.orderQty) || 1,
      Number(body.price) || 0,
      body.supplier || '',
      body.supplierUrl || '',
      body.note || ''
    ]);

    return { ok:true, data:{ itemId:newId } };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// getShortageList
// ============================================================
function doGetShortageList_() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEETS.STOCKS);
  var data = sheet.getDataRange().getValues();
  var list = [];

  var itemSheet = ss.getSheetByName(SHEETS.ITEMS);
  var itemData = itemSheet.getDataRange().getValues();
  var itemMap = {};
  for (var i = 1; i < itemData.length; i++) {
    itemMap[String(itemData[i][0])] = {
      unit: itemData[i][3], orderQty: itemData[i][4], price: itemData[i][5],
      supplier: itemData[i][6], supplierUrl: itemData[i][7]
    };
  }

  for (var i = 1; i < data.length; i++) {
    var cur = Number(data[i][SC.CUR-1]);
    var min = Number(data[i][SC.MIN-1]);
    if (cur < min * 1.2) {
      var iid = String(data[i][SC.IID-1]);
      var info = itemMap[iid] || {};
      list.push({
        propertyId: data[i][0], propertyName: data[i][1],
        itemId: iid, itemName: data[i][3], category: data[i][4],
        current: cur, minimum: min, diff: cur - min,
        status: cur < min ? '要補充' : '残り少',
        unit: info.unit, orderQty: info.orderQty, price: info.price,
        supplier: info.supplier, supplierUrl: info.supplierUrl
      });
    }
  }
  return { ok:true, data:list };
}

// ============================================================
// getLogs
// ============================================================
function doGetLogs_(body) {
  var limit = Number(body.limit) || 100;
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEETS.LOGS);
  var data = sheet.getDataRange().getValues();
  var logs = [];

  for (var i = data.length - 1; i >= 1 && logs.length < limit; i--) {
    logs.push({
      datetime: data[i][0] ? Utilities.formatDate(new Date(data[i][0]), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm') : '',
      propertyId: data[i][1], propertyName: data[i][2],
      itemId: data[i][3], itemName: data[i][4],
      before: data[i][5], after: data[i][6],
      diff: data[i][7], updatedBy: data[i][8], operation: data[i][9]
    });
  }
  return { ok:true, data:logs };
}

// ============================================================
// ヘルパー関数
// ============================================================
function writeLog_(ss, date, pId, pName, iId, iName, before, after, delta, who, operation) {
  var sheet = ss.getSheetByName(SHEETS.LOGS);
  var diffStr = (delta >= 0 ? '+' : '') + delta;
  sheet.appendRow([
    Utilities.formatDate(date, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'),
    pId, pName, iId, iName,
    before, after, diffStr, who, operation
  ]);
}

function calcStatus_(current, minimum) {
  if (current < minimum) return '要補充';
  if (current < minimum * 1.2) return '残り少';
  return 'OK';
}

function checkAndNotify_(ss, pId, pName, iId, iName, current, minimum) {
  var key = 'notify_' + pId + '_' + iId;
  var props = PropertiesService.getScriptProperties();
  var lastSent = props.getProperty(key);
  var now = new Date().getTime();

  if (lastSent && (now - Number(lastSent)) < 24 * 60 * 60 * 1000) return;

  var propSheet = ss.getSheetByName(SHEETS.PROPERTIES);
  var propData = propSheet.getDataRange().getValues();
  var email = '';
  for (var i = 1; i < propData.length; i++) {
    if (String(propData[i][0]) === String(pId)) { email = propData[i][5]; break; }
  }
  if (!email) return;

  try {
    MailApp.sendEmail({
      to: email,
      subject: '【在庫アラート】' + pName + ' — ' + iName + ' が不足しています',
      body: pName + ' の「' + iName + '」が最低数を下回りました。\n\n'
          + '現在数: ' + current + '\n'
          + '最低数: ' + minimum + '\n\n'
          + '早めの補充をお願いします。\n'
          + '---\n民泊在庫管理システム'
    });
    props.setProperty(key, String(now));
  } catch (e) {
    Logger.log('Mail send error: ' + e);
  }
}

function res_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// 定期実行トリガー
// ============================================================
function setupTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) { ScriptApp.deleteTrigger(t); });

  ScriptApp.newTrigger('sendWeeklyReport')
    .timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).create();

  ScriptApp.newTrigger('sendMonthlyReport')
    .timeBased().onMonthDay(1).atHour(7).create();
}

function sendWeeklyReport() {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var result = doGetShortageList_();
    if (!result.ok || result.data.length === 0) return;

    var propSheet = ss.getSheetByName(SHEETS.PROPERTIES);
    var propData = propSheet.getDataRange().getValues();
    var ownerEmail = '';
    for (var i = 1; i < propData.length; i++) {
      if (propData[i][5]) { ownerEmail = propData[i][5]; break; }
    }
    if (!ownerEmail) return;

    var body = '【週次 発注リスト】\n\n';
    var grouped = {};
    result.data.forEach(function(r) {
      if (!grouped[r.propertyName]) grouped[r.propertyName] = [];
      grouped[r.propertyName].push(r);
    });

    Object.keys(grouped).forEach(function(pn) {
      body += '■ ' + pn + '\n';
      grouped[pn].forEach(function(r) {
        body += '  ・' + r.itemName + '  現在:' + r.current + ' / 最低:' + r.minimum + '  [' + r.status + ']';
        if (r.supplier) body += '  購入先:' + r.supplier;
        body += '\n';
      });
      body += '\n';
    });

    body += '---\n民泊在庫管理システム（自動送信）';

    MailApp.sendEmail({ to: ownerEmail, subject: '【週次】発注リスト (' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd') + ')', body: body });
  } catch (e) {
    Logger.log('Weekly report error: ' + e);
  }
}

function sendMonthlyReport() {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    var logSheet = ss.getSheetByName(SHEETS.LOGS);
    var data = logSheet.getDataRange().getValues();

    var now = new Date();
    var lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    var thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    var consumption = {};
    for (var i = 1; i < data.length; i++) {
      var d = new Date(data[i][0]);
      if (d >= lastMonth && d < thisMonth) {
        var key = data[i][2] + ' / ' + data[i][4];
        var diff = Number(String(data[i][7]).replace('+',''));
        if (diff < 0) {
          if (!consumption[key]) consumption[key] = 0;
          consumption[key] += Math.abs(diff);
        }
      }
    }

    var propSheet = ss.getSheetByName(SHEETS.PROPERTIES);
    var propData = propSheet.getDataRange().getValues();
    var ownerEmail = '';
    for (var i = 1; i < propData.length; i++) {
      if (propData[i][5]) { ownerEmail = propData[i][5]; break; }
    }
    if (!ownerEmail) return;

    var monthName = Utilities.formatDate(lastMonth, 'Asia/Tokyo', 'yyyy年MM月');
    var body = '【月次レポート】' + monthName + ' の消費量\n\n';

    var keys = Object.keys(consumption).sort();
    if (keys.length === 0) {
      body += '先月の消費記録はありません。\n';
    } else {
      keys.forEach(function(k) {
        body += '  ' + k + ': ' + consumption[k] + ' 消費\n';
      });
    }

    body += '\n---\n民泊在庫管理システム（自動送信）';

    MailApp.sendEmail({ to: ownerEmail, subject: '【月次】消費量レポート (' + monthName + ')', body: body });
  } catch (e) {
    Logger.log('Monthly report error: ' + e);
  }
}

// ============================================================
// 初期セットアップ（最初に1回だけ実行）
// Apps Scriptエディタで setupDatabase を選択して ▶ 実行
// ============================================================
function setupDatabase() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var ownerEmail = Session.getActiveUser().getEmail();

  // デフォルトシートを物件マスタにリネーム
  var first = ss.getSheets()[0];
  first.setName('物件マスタ');

  // 物件マスタ
  var ps = first;
  ps.clear();
  ps.appendRow(['物件ID','物件名','所在地','部屋数','担当者','通知メール','ステータス','メモ']);
  ps.appendRow(['P001','琴平荘','香川県琴平町',2,'管理者',ownerEmail,'稼働中','古民家・ファミリー向け']);
  ps.appendRow(['P002','高松ベイハウス','香川県高松市',3,'管理者',ownerEmail,'稼働中','駅近・ビジネス向け']);
  ps.appendRow(['P003','小豆島ゲストハウス','香川県小豆島',2,'管理者',ownerEmail,'稼働中','オリーブ園近く・観光客向け']);
  ps.appendRow(['P004','さぬきヴィラ','香川県さぬき市',4,'管理者',ownerEmail,'稼働中','オリーブ園近く・大人数向け']);
  ps.appendRow(['P005','直島アートハウス','香川県直島町',2,'管理者',ownerEmail,'準備中','アート島巡り向け・2026年OPEN予定']);

  // 品目マスタ
  var is = ss.insertSheet('品目マスタ');
  is.appendRow(['品目ID','カテゴリ','品目名','単位','発注単位数','単価(円)','購入先','購入先URL','備考']);
  is.appendRow(['I001','アメニティ','シャンプー(個)','個',50,30,'Amazon','https://www.amazon.co.jp/','50個入']);
  is.appendRow(['I002','アメニティ','コンディショナー(個)','個',50,30,'Amazon','https://www.amazon.co.jp/','50個入']);
  is.appendRow(['I003','アメニティ','ボディソープ(個)','個',50,30,'Amazon','https://www.amazon.co.jp/','50個入']);
  is.appendRow(['I004','アメニティ','歯ブラシセット','セット',100,25,'Amazon','https://www.amazon.co.jp/','歯磨き粉付']);
  is.appendRow(['I005','アメニティ','カミソリ','本',100,20,'Amazon','https://www.amazon.co.jp/','']);
  is.appendRow(['I006','アメニティ','シャワーキャップ','個',100,15,'Amazon','https://www.amazon.co.jp/','']);
  is.appendRow(['I007','アメニティ','コットン・綿棒セット','セット',100,18,'Amazon','https://www.amazon.co.jp/','']);
  is.appendRow(['I101','消耗品','トイレットペーパー','個',12,50,'コストコ','','12ロール']);
  is.appendRow(['I102','消耗品','ティッシュペーパー','個',5,100,'ドラッグストア','','5箱パック']);
  is.appendRow(['I103','消耗品','ハンドソープ詰替','個',1,300,'ドラッグストア','','']);
  is.appendRow(['I104','消耗品','食器用洗剤','本',1,250,'ドラッグストア','','']);
  is.appendRow(['I105','消耗品','ゴミ袋(45L)','枚',30,5,'ドラッグストア','','30枚入']);
  is.appendRow(['I106','消耗品','コーヒーパック','個',20,40,'楽天','https://www.rakuten.co.jp/','ドリップタイプ']);
  is.appendRow(['I107','消耗品','緑茶ティーバッグ','個',50,8,'楽天','https://www.rakuten.co.jp/','']);
  is.appendRow(['I201','リネン','バスタオル','枚',1,1500,'楽天','','白・80×140cm']);
  is.appendRow(['I202','リネン','フェイスタオル','枚',1,500,'楽天','','白・34×80cm']);
  is.appendRow(['I203','リネン','シーツ(シングル)','枚',1,2000,'楽天','','白']);
  is.appendRow(['I204','リネン','シーツ(ダブル)','枚',1,2500,'楽天','','白']);
  is.appendRow(['I205','リネン','枕カバー','枚',1,600,'楽天','','白']);
  is.appendRow(['I206','リネン','布団カバー','枚',1,2800,'楽天','','白']);
  is.appendRow(['I301','備品','ドライヤー','台',1,3500,'Amazon','','故障時の予備']);
  is.appendRow(['I302','備品','電気ケトル','台',1,3000,'Amazon','','']);
  is.appendRow(['I303','備品','マグカップ','個',1,400,'ニトリ','','']);

  // 在庫マスタ
  var st = ss.insertSheet('在庫マスタ');
  st.appendRow(['物件ID','物件名','品目ID','品目名','カテゴリ','現在数','最低数','差分','ステータス','最終更新','更新者']);
  var stockData = [
    ['P001','琴平荘','I001','シャンプー(個)','アメニティ',8,10],
    ['P001','琴平荘','I002','コンディショナー(個)','アメニティ',12,10],
    ['P001','琴平荘','I004','歯ブラシセット','アメニティ',18,15],
    ['P001','琴平荘','I101','トイレットペーパー','消耗品',3,6],
    ['P001','琴平荘','I105','ゴミ袋(45L)','消耗品',25,20],
    ['P001','琴平荘','I201','バスタオル','リネン',12,8],
    ['P001','琴平荘','I202','フェイスタオル','リネン',16,12],
    ['P002','高松ベイハウス','I001','シャンプー(個)','アメニティ',15,12],
    ['P002','高松ベイハウス','I002','コンディショナー(個)','アメニティ',14,12],
    ['P002','高松ベイハウス','I004','歯ブラシセット','アメニティ',22,18],
    ['P002','高松ベイハウス','I101','トイレットペーパー','消耗品',12,8],
    ['P002','高松ベイハウス','I106','コーヒーパック','消耗品',16,10],
    ['P002','高松ベイハウス','I201','バスタオル','リネン',18,12],
    ['P002','高松ベイハウス','I203','シーツ(シングル)','リネン',10,8],
    ['P003','小豆島ゲストハウス','I001','シャンプー(個)','アメニティ',6,8],
    ['P003','小豆島ゲストハウス','I004','歯ブラシセット','アメニティ',15,12],
    ['P003','小豆島ゲストハウス','I101','トイレットペーパー','消耗品',8,6],
    ['P003','小豆島ゲストハウス','I201','バスタオル','リネン',9,10],
    ['P003','小豆島ゲストハウス','I202','フェイスタオル','リネン',14,12],
    ['P004','さぬきヴィラ','I001','シャンプー(個)','アメニティ',20,16],
    ['P004','さぬきヴィラ','I004','歯ブラシセット','アメニティ',25,20],
    ['P004','さぬきヴィラ','I101','トイレットペーパー','消耗品',7,8],
    ['P004','さぬきヴィラ','I106','コーヒーパック','消耗品',9,10],
    ['P004','さぬきヴィラ','I201','バスタオル','リネン',20,16],
    ['P004','さぬきヴィラ','I204','シーツ(ダブル)','リネン',12,10]
  ];
  for (var i = 0; i < stockData.length; i++) {
    var r = i + 2;
    var d = stockData[i];
    st.appendRow([d[0],d[1],d[2],d[3],d[4],d[5],d[6],'=F'+r+'-G'+r,'=IF(F'+r+'<G'+r+',"要補充",IF(F'+r+'<G'+r+'*1.2,"残り少","OK"))','','']);
  }

  // 更新ログ
  var lg = ss.insertSheet('更新ログ');
  lg.appendRow(['日時','物件ID','物件名','品目ID','品目名','変更前','変更後','差分','更新者','操作']);
  lg.appendRow(['2026-05-21 16:30','P002','高松ベイハウス','I001','シャンプー(個)',14,15,'+1','スタッフA','補充']);
  lg.appendRow(['2026-05-21 09:15','P001','琴平荘','I101','トイレットペーパー',5,3,'-2','スタッフA','使用']);
  lg.appendRow(['2026-05-20 14:30','P001','琴平荘','I001','シャンプー(個)',12,8,'-4','管理者','使用']);

  // ダッシュボード
  var db = ss.insertSheet('ダッシュボード');
  db.getRange('A1').setValue('民泊在庫管理 ダッシュボード');
  db.getRange('A3').setValue('このシートは参照用です。アプリから自動更新されます。');

  // 権限マスタ
  var pm = ss.insertSheet('権限マスタ');
  pm.appendRow(['メールアドレス','表示名','権限','有効']);
  pm.appendRow([ownerEmail, '管理者', 'admin', true]);

  Logger.log('✅ セットアップ完了！ シート6枚を作成し、サンプルデータを投入しました。');
  Logger.log('✅ あなたのメール ' + ownerEmail + ' を管理者として権限マスタに登録しました。');
}
