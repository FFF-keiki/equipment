/**
 * Bind this to the actual equipment Google Spreadsheet:
 * Extensions -> Apps Script. Then set Script Properties WEBHOOK_URL,
 * SHEET_WEBHOOK_SECRET and SHEET_TAB; run installEquipmentTriggers once.
 *
 * This is an installable trigger, not the simple onEdit trigger.
 */
function installEquipmentTriggers() {
  const props = PropertiesService.getScriptProperties();
  ['WEBHOOK_URL', 'SHEET_WEBHOOK_SECRET', 'SHEET_TAB'].forEach(function (name) {
    if (!props.getProperty(name)) throw new Error('Script Properties missing: ' + name);
  });
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('スプレッドシートから Apps Script を開いてください。');
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['equipmentOnEdit', 'equipmentOnChange'].includes(t.getHandlerFunction())) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('equipmentOnEdit').forSpreadsheet(spreadsheet).onEdit().create();
  ScriptApp.newTrigger('equipmentOnChange').forSpreadsheet(spreadsheet).onChange().create();
  Logger.log('機材管理: 編集・構造変更トリガーを設定しました。');
}

function equipmentOnEdit(e) {
  if (!e || !e.range) return;
  const tab = PropertiesService.getScriptProperties().getProperty('SHEET_TAB');
  const sheet = e.range.getSheet();
  if (sheet.getName() !== tab) return;
  equipmentSendEvent_('edit',sheet.getName());
}

function equipmentOnChange(e) {
  // onEdit already covers normal editing; don't issue duplicate notifications.
  if (!e || !e.changeType || e.changeType === 'EDIT' || e.changeType === 'FORMAT') return;
  const tab = PropertiesService.getScriptProperties().getProperty('SHEET_TAB');
  // onChange does not expose the changed sheet/range. To avoid missing INSERT_ROW
  // performed while a different tab is active, send a conservative notification.
  equipmentSendEvent_('structure',tab);
}

function equipmentSendEvent_(kind, sheet) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('WEBHOOK_URL');
  const secret = props.getProperty('SHEET_WEBHOOK_SECRET');
  if (!url || !secret) throw new Error('WEBHOOK_URL / SHEET_WEBHOOK_SECRET is missing.');
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: {'X-Equipment-Webhook-Secret':secret},
    payload: JSON.stringify({event:kind,sheet:sheet}),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error('Webhook HTTP ' + response.getResponseCode() + ' ' + response.getContentText().slice(0,300));
  }
}
