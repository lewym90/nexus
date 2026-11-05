// Okno synchronizacji: parowanie urządzenia, stan, przywracanie kopii z serwera.
import { $, openModal, closeModal, askConfirm, showToast } from './ui.js';
import { getSync, isPaired, pairDevice, unpair, syncNow, syncCode, listBackups, restoreBackup } from './sync.js';

const button = (label, kind, onClick) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'modal-btn ' + kind;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
};
const para = (text, cls) => { const p = document.createElement('p'); p.textContent = text; if (cls) p.className = cls; return p; };

function pairView(wrap, onPaired) {
  wrap.append(para('Wklej kod z instalacji serwera. Na każdym urządzeniu użyj tego samego kodu. Notatki są szyfrowane na urządzeniu, zanim trafią na serwer.'));
  const input = document.createElement('input');
  input.className = 'modal-input';
  input.id = 'syncCodeInput';
  input.placeholder = 'https://…/nexus-sync#…';
  input.autocomplete = 'off';
  input.setAttribute('autocapitalize', 'none');
  const connect = button('Połącz', 'primary', async () => {
    connect.disabled = true;
    try {
      await pairDevice(input.value);
      onPaired();
      closeModal(null);
      showToast('Połączono z serwerem');
    } catch (e) {
      connect.disabled = false;
      showToast(e.message || 'Nie udało się połączyć');
    }
  });
  connect.id = 'syncConnectBtn';
  wrap.append(input, connect);
}

function pairedView(wrap) {
  const c = getSync();
  wrap.append(para(c.error ? `Problem: ${c.error}` : c.last ? `Ostatnia synchronizacja: ${new Date(c.last).toLocaleString('pl-PL')}` : 'Trwa pierwsza synchronizacja…'));
  wrap.append(button('Synchronizuj teraz', 'primary', async () => {
    showToast((await syncNow()) ? 'Zsynchronizowano' : 'Nie udało się zsynchronizować');
    closeModal(null);
  }));
  const backups = button('Kopie na serwerze', '', async () => {
    backups.disabled = true;
    try {
      const days = await listBackups();
      backups.remove();
      if (!days.length) { wrap.append(para('Pierwsza kopia powstanie w ciągu godziny od zmian.')); return; }
      const sel = document.createElement('select');
      sel.id = 'syncBackupSelect';
      sel.setAttribute('aria-label', 'Kopia');
      days.forEach((d) => sel.add(new Option(d, d)));
      wrap.append(para('Serwer robi kopię raz na dobę i trzyma ją 30 dni.'), sel, button('Przywróć tę kopię', 'danger', async () => {
        const day = sel.value;
        closeModal(null);
        if (!(await askConfirm('Przywrócić kopię?', `Notatki z ${day} zastąpią obecne wersje na wszystkich urządzeniach. Notatki dodane później zostaną.`, 'Przywróć', true))) return;
        try { showToast(`Przywrócono notatki: ${await restoreBackup(day)}`); } catch { showToast('Nie udało się przywrócić kopii'); }
      }));
    } catch (e) { backups.disabled = false; showToast(e.message || 'Brak połączenia'); }
  });
  wrap.append(backups);
  const show = button('Pokaż kod', '', () => { show.replaceWith(para(syncCode(), 'sync-code')); });
  wrap.append(show);
  wrap.append(button('Rozłącz to urządzenie', 'danger', async () => {
    closeModal(null);
    if (!(await askConfirm('Rozłączyć?', 'Notatki zostaną na tym urządzeniu i na serwerze, ale przestaną się synchronizować.', 'Rozłącz', true))) return;
    unpair();
    location.reload();
  }));
}

export function openSyncPanel(onPaired) {
  const wrap = document.createElement('div');
  wrap.className = 'sync-panel';
  if (isPaired()) pairedView(wrap); else pairView(wrap, onPaired);
  openModal({ title: 'Synchronizacja', content: wrap, actions: [{ label: 'Zamknij', value: null }] }).then(() => { if ($('syncCodeInput')) $('syncCodeInput').blur(); });
}
