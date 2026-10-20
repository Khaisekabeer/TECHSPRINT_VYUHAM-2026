// Question bank key management on top of vault.js: unlocking with a quiz master's PIN,
// first-time setup (with a one-time recovery code), recovery, granting the key to other quiz
// masters, and decrypting questions for the bank and the game.
const vault = require('./vault');
const store = require('./store');

const { VaultError } = vault;

// Make sure a quiz master has a key pair (accounts created before encryption get one on unlock).
async function ensureKeyPair(staffRow, pin) {
  if (staffRow.vault_public_key && staffRow.vault_private_key) return staffRow;
  const keys = await vault.createKeyPair(pin);
  await store.updateStaff(staffRow.id, keys);
  return { ...staffRow, ...keys };
}

/**
 * Unlock the question key for a quiz master whose PIN has already been verified.
 * Returns { dek, recoveryCode? } — recoveryCode only when the bank is set up for the first time.
 */
async function unlock(staffRow, pin) {
  let me = await ensureKeyPair(staffRow, pin);
  let privateKey;
  try {
    privateKey = await vault.openPrivateKey(me, pin);
  } catch {
    // Key pair from an older PIN: start over with a fresh pair; the old grant is useless.
    const keys = await vault.createKeyPair(pin);
    await store.updateStaff(me.id, keys);
    await store.deleteGrant(me.id);
    me = { ...me, ...keys };
    privateKey = await vault.openPrivateKey(me, pin);
  }
  const grant = await store.getGrant(me.id);
  if (grant) {
    try {
      return { dek: vault.unwrapWithPrivateKey(grant.wrapped_dek, privateKey) };
    } catch {
      await store.deleteGrant(me.id); // wrapped to a previous key pair
    }
  }

  if (await store.getVault()) {
    throw new VaultError(
      "Your account doesn't have the question key yet. It's shared automatically the next time another quiz master unlocks the bank — or use the recovery code.",
      'NEEDS_GRANT',
    );
  }

  // First unlock ever: create the key, a recovery copy, and this quiz master's grant.
  const dek = vault.newDek();
  const recoveryCode = vault.newRecoveryCode();
  try {
    await store.insertVault({ ...(await vault.wrapWithRecoveryCode(dek, recoveryCode)), created_by: me.id });
  } catch {
    throw new VaultError('Another quiz master is setting up the question bank right now — try again in a moment.', 'NEEDS_GRANT');
  }
  await store.upsertGrant({ staff_id: me.id, wrapped_dek: vault.wrapForPublicKey(dek, me.vault_public_key), granted_by: me.id });
  return { dek, recoveryCode };
}

// Regain access with the recovery code (e.g. the only quiz master's PIN was reset).
async function recover(staffRow, pin, recoveryCode) {
  const vaultRow = await store.getVault();
  if (!vaultRow) throw new VaultError('The question bank has not been set up yet — just unlock with your PIN.', 'NO_VAULT');
  let dek;
  try {
    dek = await vault.unwrapWithRecoveryCode(vaultRow, recoveryCode);
  } catch {
    throw new VaultError('That recovery code is not correct', 'BAD_RECOVERY');
  }
  const me = await ensureKeyPair(staffRow, pin);
  await store.upsertGrant({ staff_id: me.id, wrapped_dek: vault.wrapForPublicKey(dek, me.vault_public_key), granted_by: me.id });
  return dek;
}

// After any unlock: share the key with quiz masters who lack it, and encrypt plaintext questions
// (legacy rows or ones imported with `npm run seed`).
async function afterUnlock(dek, staffId) {
  for (const qm of await store.quizmastersWithoutGrant()) {
    await store.upsertGrant({ staff_id: qm.id, wrapped_dek: vault.wrapForPublicKey(dek, qm.vault_public_key), granted_by: staffId });
  }
  let sealed = 0;
  for (const row of await store.listQuestionRows()) {
    if (row.payload) continue;
    const payload = vault.encryptQuestion(dek, { text: row.text, options: row.options || [], correctAnswer: row.correct_answer });
    await store.sealQuestionRow(row.id, payload);
    sealed++;
  }
  if (sealed) console.log(`Encrypted ${sealed} plaintext question(s)`);
  // Images uploaded but never saved with a question (editor closed) are removed after an hour.
  const used = new Set((await store.listQuestionRows()).map(r => decryptRow(r, dek).imageId).filter(Boolean));
  const stale = (await store.listImageMeta()).filter(i => !used.has(i.id) && Date.now() - new Date(i.created_at).getTime() > 3600e3);
  if (stale.length) await store.deleteImages(stale.map(i => i.id));
}

// New PIN → new key pair; the old grant can't be opened any more, so it is removed and
// re-issued automatically by the next unlocking quiz master.
async function keysForNewPin(pin) {
  return vault.createKeyPair(pin);
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

// Replace the recovery code (the old one stops working). Needs the unlocked key.
async function rotateRecoveryCode(dek) {
  const recoveryCode = vault.newRecoveryCode();
  await store.updateVaultRecovery(await vault.wrapWithRecoveryCode(dek, recoveryCode));
  return recoveryCode;
}

// Decrypted, active questions in play order (level number, then position), each carrying its
// level's name, multiplier and cut (qualifyTop) — only ever held in the game server's memory.
async function loadGameQuestions(dek) {
  const [rows, levels] = await Promise.all([store.listQuestionRows(), store.listLevels()]);
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
  // Images travel with the questions (decrypted, base64) and stay in the game server's memory.
  const images = new Map((await store.getImages(questions.map(q => q.imageId).filter(Boolean)))
    .map(img => [img.id, { mime: img.mime, data: vault.decryptImage(dek, img.payload).toString('base64') }]));
  return questions.map(({ imageId, ...q }) => ({ ...q, image: imageId ? images.get(imageId) ?? null : null }));
}

module.exports = { VaultError, unlock, recover, afterUnlock, keysForNewPin, decryptRow, loadGameQuestions, rotateRecoveryCode };
