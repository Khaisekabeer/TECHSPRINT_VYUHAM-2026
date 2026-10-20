// Question sets ("Main set", "Trial set", ...) on top of vault.js. Each set has its own key (DEK),
// sealed with the set's PIN + the server secret, and a one-time recovery code. The PIN belongs to
// the set: the quiz master who creates it chooses it, and the coordinator enters it to load the
// set into the game. Nobody else (admins included) can read a set's questions.
const vault = require('./vault');
const store = require('./store');

const { VaultError } = vault;
const PIN_RE = /^\d{4,12}$/;

const checkPin = pin => {
  if (!PIN_RE.test(String(pin ?? ''))) throw new VaultError('The PIN must be 4 to 12 digits', 'BAD_INPUT');
  return String(pin);
};

async function loadBank(bankId) {
  const bank = await store.getBank(bankId);
  if (!bank) throw new VaultError('Question set not found', 'NOT_FOUND');
  return bank;
}

// Seal a set's key with a new PIN and a fresh recovery code (returned once, to show the user).
async function sealNew(dek, pin) {
  const recoveryCode = vault.newRecoveryCode();
  return {
    fields: { ...(await vault.sealBankKey(dek, pin)), ...(await vault.wrapWithRecoveryCode(dek, recoveryCode)) },
    recoveryCode,
  };
}

async function createBank(name, pin, staffId) {
  const dek = vault.newDek();
  const { fields, recoveryCode } = await sealNew(dek, checkPin(pin));
  const bank = await store.insertBank({ name, ...fields, created_by: staffId });
  return { bank, dek, recoveryCode };
}

// The set's key, given its PIN.
async function openBank(bankId, pin) {
  const bank = await loadBank(bankId);
  if (!bank.wrapped_dek) throw new VaultError('This set has no PIN yet — the quiz master sets it up first', 'NOT_SET_UP');
  try {
    return { bank, dek: await vault.openBankKey(bank, String(pin ?? '')) };
  } catch {
    throw new VaultError('Wrong PIN for this set', 'BAD_PIN');
  }
}

// ─── Moving the old single bank into a set (once) ────────────────────────────
// Before sets existed, the key was opened with a quiz master's account PIN (or the old recovery
// code). The quiz master proves one of those once; the same key is then sealed with the set PIN,
// so the existing encrypted questions stay readable.
async function legacyKey({ staffRow, legacyPin, legacyRecoveryCode }) {
  if (legacyRecoveryCode) {
    const old = await store.getVault();
    if (!old) throw new VaultError('There is no old question bank to move', 'NO_LEGACY');
    try { return await vault.unwrapWithRecoveryCode(old, legacyRecoveryCode); } catch { throw new VaultError('That recovery code is not correct', 'BAD_RECOVERY'); }
  }
  if (!staffRow?.vault_private_key) throw new VaultError('This account never unlocked the old bank — use the old recovery code instead', 'NO_LEGACY');
  let privateKey;
  try { privateKey = await vault.openPrivateKey(staffRow, String(legacyPin ?? '')); } catch { throw new VaultError('That old quiz master PIN is not correct', 'BAD_PIN'); }
  const grant = await store.getGrant(staffRow.id);
  if (!grant) throw new VaultError("This account doesn't hold the old key — use the old recovery code instead", 'NO_LEGACY');
  try { return vault.unwrapWithPrivateKey(grant.wrapped_dek, privateKey); } catch { throw new VaultError("This account's old key can't be opened — use the old recovery code", 'NO_LEGACY'); }
}

// Give a set without a PIN (the migrated one) its PIN. With questions already encrypted, the old
// key is needed; an empty set just gets a new key.
async function setupBank(bankId, pin, legacy) {
  const bank = await loadBank(bankId);
  if (bank.wrapped_dek) throw new VaultError('This set already has a PIN', 'ALREADY_SET_UP');
  checkPin(pin);
  const rows = await store.listQuestionRows(bankId);
  const sample = rows.find(r => r.payload);
  const dek = sample ? await legacyKey(legacy) : vault.newDek();
  // Check the key really opens the questions before sealing it with the new PIN.
  if (sample) {
    try { vault.decryptQuestion(dek, sample.payload); } catch { throw new VaultError("That key doesn't open these questions", 'BAD_PIN'); }
  }
  const { fields, recoveryCode } = await sealNew(dek, String(pin));
  await store.updateBank(bankId, fields);
  return { bank: { ...bank, ...fields }, dek, recoveryCode };
}

async function changeBankPin(bankId, currentPin, newPin) {
  checkPin(newPin);
  const { dek } = await openBank(bankId, currentPin);
  await store.updateBank(bankId, await vault.sealBankKey(dek, String(newPin)));
}

// Forgotten PIN: the recovery code sets a new one.
async function recoverBank(bankId, recoveryCode, newPin) {
  checkPin(newPin);
  const bank = await loadBank(bankId);
  if (!bank.recovery_wrapped) throw new VaultError('This set has no recovery code yet', 'NOT_SET_UP');
  let dek;
  try { dek = await vault.unwrapWithRecoveryCode(bank, recoveryCode); } catch { throw new VaultError('That recovery code is not correct', 'BAD_RECOVERY'); }
  await store.updateBank(bankId, await vault.sealBankKey(dek, String(newPin)));
  return { bank, dek };
}

// Replace a set's recovery code (the old one stops working). Needs the open set's key.
async function rotateRecoveryCode(bankId, dek) {
  const recoveryCode = vault.newRecoveryCode();
  await store.updateBank(bankId, await vault.wrapWithRecoveryCode(dek, recoveryCode));
  return recoveryCode;
}

// Full question objects for the bank / game. Rows that are still plaintext are read as-is.
function decryptRow(row, dek) {
  const content = row.payload
    ? vault.decryptQuestion(dek, row.payload)
    : { text: row.text, options: row.options || [], correctAnswer: row.correct_answer };
  return {
    id: row.id,
    level: row.level,
    position: row.position,
    type: row.type,
    timeLimit: row.time_limit,
    points: row.points,
    isActive: row.is_active,
    imageUrl: row.image_url,
    ...content,
  };
}

// After a set is opened: encrypt plaintext rows (e.g. from `npm run seed`) and remove pictures
// uploaded but never saved with a question (editor closed) after an hour.
async function afterOpen(bankId, dek) {
  const rows = await store.listQuestionRows(bankId);
  let sealed = 0;
  for (const row of rows) {
    if (row.payload) continue;
    await store.sealQuestionRow(row.id, vault.encryptQuestion(dek, { text: row.text, options: row.options || [], correctAnswer: row.correct_answer }));
    sealed++;
  }
  if (sealed) console.log(`Encrypted ${sealed} plaintext question(s)`);
  const used = new Set(rows.map(r => decryptRow(r, dek).imageId).filter(Boolean));
  const stale = (await store.listImageMeta(bankId)).filter(i => !used.has(i.id) && Date.now() - new Date(i.created_at).getTime() > 3600e3);
  if (stale.length) await store.deleteImages(stale.map(i => i.id));
}

// Decrypted, active questions of one set in play order (level number, then position), each
// carrying its level's name, multiplier, cut and theme, plus its picture — only ever held in the
// game server's memory.
async function loadGameQuestions(bankId, dek) {
  const [rows, levels] = await Promise.all([store.listQuestionRows(bankId), store.listLevels(bankId)]);
  const byNumber = new Map(levels.map(l => [l.number, l]));
  const questions = rows.filter(r => r.is_active).map(r => {
    const level = byNumber.get(r.level);
    return {
      ...decryptRow(r, dek),
      levelName: level?.name ?? `Level ${r.level}`,
      multiplier: level?.multiplier ?? 1,
      qualifyTop: level?.qualifyTop ?? null,
      theme: level?.theme ?? null,
    };
  });
  const images = new Map((await store.getImages(questions.map(q => q.imageId).filter(Boolean), bankId))
    .map(img => [img.id, { mime: img.mime, data: vault.decryptImage(dek, img.payload).toString('base64') }]));
  return questions.map(({ imageId, ...q }) => ({ ...q, image: imageId ? images.get(imageId) ?? null : null }));
}

module.exports = {
  VaultError,
  PIN_RE,
  createBank,
  openBank,
  setupBank,
  changeBankPin,
  recoverBank,
  rotateRecoveryCode,
  afterOpen,
  decryptRow,
  loadGameQuestions,
};
