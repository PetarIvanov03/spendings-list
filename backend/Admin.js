// Sheet-side bootstrap: menu, secrets init, PIN setting (no PINs ever committed).

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Expenses admin')
    .addItem('Set PIN for user…', 'promptSetPin')
    .addItem('Initialize secrets', 'initSecrets')
    .addToUi();
}

// One-off: generates PIN_SALT and TOKEN_SECRET if missing. Run manually from the editor.
function initSecrets() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PIN_SALT')) {
    props.setProperty('PIN_SALT', Utilities.getUuid());
  }
  if (!props.getProperty('TOKEN_SECRET')) {
    props.setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
  }
}

function promptSetPin() {
  var ui = SpreadsheetApp.getUi();

  var nameResponse = ui.prompt('Set PIN', 'User name:', ui.ButtonSet.OK_CANCEL);
  if (nameResponse.getSelectedButton() !== ui.Button.OK) return;
  var userName = nameResponse.getResponseText().trim();

  var user = findUser(userName);
  if (!user) {
    ui.alert('No such user in the Users sheet: ' + userName);
    return;
  }

  var pinResponse = ui.prompt(
    'Set PIN',
    'PIN for ' + userName + ' (' + (user.role === 'admin' ? '6 digits' : '4 digits') + '):',
    ui.ButtonSet.OK_CANCEL
  );
  if (pinResponse.getSelectedButton() !== ui.Button.OK) return;
  var pin = pinResponse.getResponseText().trim();

  var expectedLength = user.role === 'admin' ? 6 : 4;
  if (!/^\d+$/.test(pin) || pin.length !== expectedLength) {
    ui.alert('PIN must be exactly ' + expectedLength + ' digits.');
    return;
  }

  setPinForUser(userName, pin);
  ui.alert('PIN set for ' + userName + '.');
}

// Shared by the menu and the setPin admin endpoint (added in a later step).
function setPinForUser(userName, pin) {
  var props = PropertiesService.getScriptProperties();
  var salt = props.getProperty('PIN_SALT');
  if (!salt) {
    throw new Error('PIN_SALT not set, run initSecrets first');
  }
  props.setProperty('pin:' + userName, hashPin(pin, salt));
  var currentVersion = Number(props.getProperty('tv:' + userName) || '0');
  props.setProperty('tv:' + userName, String(currentVersion + 1));
}
