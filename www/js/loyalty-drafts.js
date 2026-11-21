// Drafts belong to the encrypted vault, never to browser plaintext storage.
// The application owns encryption, serial persistence, error banner and lock drain.
export function createLoyaltyDrafts(D) {
  let timer = null, pendingVault = null, disposed = false;
  const owns = vault => !disposed && !!vault && D.state.vault === vault && !D.state.demoMode;
  const valid = value => value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 200
    && value.data && typeof value.data === 'object' && !Array.isArray(value.data)
    && [value.entryId, value.baseUpdatedAt].every(v => v == null || typeof v === 'string')
    && ['description','number','note','barcodeType','barcodeValue','color'].every(k => value.data[k] == null || typeof value.data[k] === 'string')
    && (value.data.favorite == null || typeof value.data.favorite === 'boolean')
    && (value.data.images == null || (Array.isArray(value.data.images) && value.data.images.length <= 2
      && value.data.images.every(p => p && ['front','back'].includes(p.side)
        && ['image/jpeg','image/png','image/webp'].includes(p.mime) && typeof p.data === 'string')));
  const clone = value => JSON.parse(JSON.stringify(value));
  function read(vault = D.state.vault) {
    if (!owns(vault) || !valid(vault.loyaltyDraft)) return null;
    return clone(vault.loyaltyDraft);
  }
  function schedule(vault) {
    clearTimeout(timer); pendingVault = vault;
    timer = setTimeout(() => {
      timer = null;
      flush(vault).catch(() => {
        if (owns(vault)) D.toast?.('Черновик пока не записан на устройство. Повторите сохранение.');
      });
    }, 250);
  }
  function write(vault, draft) {
    if (!owns(vault) || !valid(draft)) return false;
    vault.loyaltyDraft = clone(draft); schedule(vault); return true;
  }
  function remove(vault, id) {
    if (!owns(vault) || vault.loyaltyDraft?.id !== id) return false;
    delete vault.loyaltyDraft; schedule(vault); return true;
  }
  function flush(vault = D.state.vault) {
    if (!owns(vault)) {
      if (pendingVault === vault) { clearTimeout(timer); timer = null; pendingVault = null; }
      return Promise.resolve();
    }
    clearTimeout(timer); timer = null; pendingVault = null;
    // Invoke immediately: lockNow dispatches seyf:locking and then drains this queue.
    try { return Promise.resolve(D.saveFile()); }
    catch (error) { return Promise.reject(error); }
  }
  function destroy() { clearTimeout(timer); timer = null; pendingVault = null; disposed = true; }
  return {read, write, remove, flush, destroy};
}
