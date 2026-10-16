// Avisos de riego y cuidados.
// La app guarda en el dispositivo la lista de próximas tareas (hv.sched) para que el
// service worker pueda avisar también con la app cerrada donde el navegador lo permite.
import { registerSW } from 'virtual:pwa-register';
import { store } from './store.js';

const todayIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
let swReg = null, installEvt = null;

export function dueToday(sched) {
  const t = todayIso();
  return sched.filter(x => x.date <= t).map(x => x.text);
}

export function summary(items) {
  if (!items.length) return '';
  const shown = items.slice(0, 3).join(', ');
  return items.length > 3 ? `${shown} y ${items.length - 3} más` : shown;
}

export function updateSchedule(items) {
  store.setItem('hv.sched', JSON.stringify(items));
  maybeNotify();
}

async function maybeNotify() {
  if (!swReg || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (store.getItem('hv.notified') === todayIso()) return;
  const items = dueToday(JSON.parse(store.getItem('hv.sched') || '[]'));
  if (!items.length) return;
  store.setItem('hv.notified', todayIso());
  swReg.showNotification('Huerta Viva · tareas de hoy', {
    body: summary(items), tag: 'hv-daily', icon: 'icons/icon-192.png', badge: 'icons/badge-96.png',
  });
}

async function registerPeriodic() {
  try {
    if (!swReg || !('periodicSync' in swReg)) return;
    const st = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (st.state === 'granted') await swReg.periodicSync.register('hv-daily', { minInterval: 12 * 3600e3 });
  } catch (e) {}
}

const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function drawBox() {
  const box = document.getElementById('avisos');
  if (!box) return;
  const canNotify = 'Notification' in window && 'serviceWorker' in navigator;
  const perm = canNotify ? Notification.permission : 'unsupported';
  let txt, btns = '';
  if (perm === 'granted') txt = 'Avisos activados: te avisaremos de los riegos y cuidados que toquen cada día.';
  else if (perm === 'denied') txt = 'Los avisos están bloqueados. Puedes permitirlos en los ajustes del navegador para esta página.';
  else if (!canNotify && isIOS() && !standalone()) txt = 'Para recibir avisos en el iPhone, añade la app a tu pantalla de inicio desde el botón Compartir.';
  else if (!canNotify) txt = 'Este navegador no permite avisos.';
  else { txt = 'Recibe un aviso con los riegos y cuidados de cada día.'; btns += '<button class="btn act" data-notif>Activar avisos</button>'; }
  if (installEvt && !standalone()) btns += '<button class="btn primary" data-install>Instalar la app</button>';
  box.innerHTML = `<p>${txt}</p>${btns ? `<div class="avisos-btns">${btns}</div>` : ''}`;
}

export function setupNotify() {
  swReg = null;
  if ('serviceWorker' in navigator) {
    registerSW({
      immediate: true,
      onRegisteredSW(_url, reg) { swReg = reg || null; registerPeriodic(); maybeNotify(); },
    });
  }
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; drawBox(); });
  addEventListener('appinstalled', () => { installEvt = null; drawBox(); });
  document.addEventListener('click', async e => {
    if (e.target.closest('[data-notif]')) {
      await Notification.requestPermission();
      drawBox(); registerPeriodic(); maybeNotify();
    } else if (e.target.closest('[data-install]') && installEvt) {
      installEvt.prompt(); await installEvt.userChoice; installEvt = null; drawBox();
    }
  });
  drawBox();
}
