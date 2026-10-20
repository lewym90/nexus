// Drobne elementy interfejsu: skrót DOM, toast (z akcją „Cofnij”), okna dialogowe.

export const $ = (id) => document.getElementById(id);
export const isMobile = () => window.matchMedia('(max-width: 900px)').matches;

let toastTimer;
/** showToast('tekst') lub showToast('tekst', { label: 'Cofnij', onClick }) */
export function showToast(message, action) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.toggle('has-action', !!action);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-action';
    b.textContent = action.label;
    b.addEventListener('click', () => {
      toast.classList.remove('show');
      action.onClick();
    });
    toast.appendChild(b);
  }
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), action ? 6000 : 2800);
}

/* ---------- Modal ---------- */

let modalState = null;
export const isModalOpen = () => !!modalState;

export function openModal({ title, message, content, actions }) {
  return new Promise((resolve) => {
    closeModal(null);
    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';
    const box = document.createElement('div');
    box.className = 'modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    if (title) {
      const h = document.createElement('h2');
      h.textContent = title;
      box.appendChild(h);
    }
    if (message) {
      const p = document.createElement('p');
      p.className = 'modal-message';
      p.textContent = message;
      box.appendChild(p);
    }
    if (content) box.appendChild(content);
    const bar = document.createElement('div');
    bar.className = 'modal-actions';
    (actions || []).forEach((a) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'modal-btn ' + (a.kind || '');
      b.textContent = a.label;
      b.addEventListener('click', () => closeModal(a.value));
      bar.appendChild(b);
    });
    box.appendChild(bar);
    overlay.appendChild(box);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeModal(null); });
    document.body.appendChild(overlay);
    modalState = { overlay, resolve };
    const focusEl = box.querySelector('input,select') || bar.querySelector('.primary, .danger') || bar.lastElementChild;
    if (focusEl) setTimeout(() => focusEl.focus(), 30);
  });
}

export function closeModal(value) {
  if (!modalState) return;
  const { overlay, resolve } = modalState;
  modalState = null;
  overlay.remove();
  resolve(value);
}

export async function askText(title, placeholder = '', value = '') {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'modal-input';
  input.placeholder = placeholder;
  input.value = value;
  input.maxLength = 80;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); closeModal(input.value); }
  });
  const res = await openModal({
    title, content: input,
    actions: [{ label: 'Anuluj', value: null }, { label: 'OK', kind: 'primary', value: '__ok__' }]
  });
  if (res === null) return null;
  const v = (res === '__ok__' ? input.value : res).trim();
  return v || null;
}

export async function askConfirm(title, message, okLabel = 'OK', danger = false) {
  const res = await openModal({
    title, message,
    actions: [{ label: 'Anuluj', value: false }, { label: okLabel, kind: danger ? 'danger' : 'primary', value: true }]
  });
  return res === true;
}
