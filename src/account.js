// Ventana «Mi cuenta»: entrar con el correo y un código, ver el estado de la sincronización, salir o borrar la cuenta.
import {cloudOn, initCloud, onCloud, currentUser, setMergeAsker, sendCode, verifyCode, syncNow, signOut, deleteAccount} from './cloud.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
let step = 'email', email = '', busy = false, msg = '', st = {state: 'off'}, ask = null;

function errText(e) {
  const m = (e?.message || String(e)).toLowerCase();
  if (m.includes('rate limit') || m.includes('security purposes')) return 'Has pedido varios códigos seguidos. Espera un poco y vuelve a intentarlo.';
  if (m.includes('expired') || m.includes('invalid') || m.includes('token')) return 'El código no es correcto o ha caducado. Revísalo o pide otro.';
  if (m.includes('email')) return 'Revisa que el correo esté bien escrito.';
  if (navigator.onLine === false || m.includes('fetch')) return 'No hay conexión. Inténtalo cuando vuelvas a tener internet.';
  return 'Algo ha fallado. Vuelve a intentarlo en un momento.';
}
function when(d) {
  if (!d) return '';
  const s = Math.round((Date.now() - d) / 1000);
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  return `a las ${d.toLocaleTimeString('es-ES', {hour: '2-digit', minute: '2-digit'})}`;
}
function statusLine() {
  return {
    syncing: 'Sincronizando…',
    ok: `Todo guardado en la nube ${when(st.at)}.`,
    offline: 'Sin conexión. Tus cambios se guardan en el móvil y se subirán al volver internet.',
    error: 'No se ha podido sincronizar. Lo volveremos a intentar.',
    idle: 'Conectando…',
  }[st.state] || '';
}

export function initAccount({refresh, toast}) {
  if (!cloudOn) return;
  const btn = document.getElementById('acctBtn'), dlg = document.getElementById('acct'), body = document.getElementById('acctIn');
  btn.hidden = false;

  function draw() {
    const u = currentUser();
    let h = `<div class="hd"><h2 id="acctTitle">Mi cuenta</h2>${ask ? '' : '<button class="x" type="button" id="acctClose" aria-label="Cerrar">×</button>'}</div>`;
    if (ask) {
      const pl = n => `${n} ${n === 1 ? 'planta' : 'plantas'}`;
      h += `<p>En este dispositivo tienes <strong>${pl(ask.nl)}</strong> y en tu cuenta hay <strong>${pl(ask.nr)}</strong>. ¿Qué quieres hacer?</p>
        <div class="acform"><button class="btn primary" type="button" data-merge="cuenta">Quedarme solo con las de mi cuenta</button>
        <button class="btn" type="button" data-merge="juntar">Juntar las de aquí con las de mi cuenta</button></div>
        <p class="tip">Si eliges la cuenta, las plantas que hay ahora en este dispositivo se quitan y se cambian por las de tu cuenta.</p>`;
    } else if (u) {
      h += `<p>Has entrado como <strong>${esc(u.email)}</strong>.</p>
        <p class="sync ${st.state}" role="status">${statusLine()}</p>
        <p class="tip">Tus plantas, riegos, fotos y tu zona se guardan en tu cuenta y aparecen en cualquier móvil u ordenador donde entres con este correo.</p>
        <div class="acts"><button class="btn" type="button" id="acctSync"${st.state === 'syncing' ? ' disabled' : ''}>Sincronizar ahora</button>
        <button class="btn" type="button" id="acctOut">Cerrar sesión</button></div>
        <details class="danger"><summary>Borrar mi cuenta</summary>
          <p class="tip">Se borran de la nube tu huerto y tus fotos, y no se puede deshacer. Lo que hay en este dispositivo se queda.</p>
          <button class="btn warn" type="button" id="acctDel">Borrar mi cuenta para siempre</button></details>`;
    } else if (step === 'email') {
      h += `<p>Entra con tu correo para guardar tu huerto en la nube y tenerlo en todos tus dispositivos. Si es la primera vez, la cuenta se crea sola.</p>
        <form id="acctForm" class="acform"><label for="acctEmail">Correo electrónico</label>
        <input id="acctEmail" type="email" autocomplete="email" inputmode="email" required value="${esc(email)}" placeholder="tu@correo.com">
        <button class="btn primary" ${busy ? 'disabled' : ''}>${busy ? 'Enviando…' : 'Enviarme un código'}</button></form>
        <p class="tip">Sin contraseñas: cada vez que entres te mandaremos un código al correo.</p>`;
    } else {
      h += `<p>Te hemos enviado un código a <strong>${esc(email)}</strong>. Escríbelo aquí:</p>
        <form id="acctForm" class="acform"><label for="acctCode">Código</label>
        <input id="acctCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" maxlength="10" required placeholder="123456">
        <button class="btn primary" ${busy ? 'disabled' : ''}>${busy ? 'Entrando…' : 'Entrar'}</button></form>
        <p class="tip">Si no lo ves, mira en la carpeta de spam. <button class="lnk" type="button" id="acctBack">Cambiar de correo o pedir otro código</button></p>`;
    }
    if (msg) h += `<p class="acmsg" role="alert">${esc(msg)}</p>`;
    body.innerHTML = h;
  }
  function open() { msg = ''; draw(); try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); } }

  btn.addEventListener('click', open);
  setMergeAsker((nl, nr) => new Promise(res => { ask = {nl, nr, res}; busy = false; if (!dlg.open) open(); else draw(); }));
  dlg.addEventListener('click', async e => {
    const mg = e.target.closest('[data-merge]');
    if (mg && ask) { const r = ask.res; ask = null; draw(); r(mg.dataset.merge); return; }
    if (ask) return; // Hay que elegir antes de cerrar
    if (e.target === dlg || e.target.closest('#acctClose')) { dlg.close(); return; }
    if (e.target.closest('#acctBack')) { step = 'email'; msg = ''; draw(); return; }
    if (e.target.closest('#acctSync')) { syncNow(); return; }
    if (e.target.closest('#acctOut')) { await signOut(); toast('Has cerrado sesión. Tus plantas siguen en este dispositivo.'); draw(); return; }
    if (e.target.closest('#acctDel')) {
      if (!confirm('¿Seguro que quieres borrar tu cuenta y todo lo guardado en la nube?')) return;
      try { await deleteAccount(); toast('Cuenta borrada'); dlg.close(); } catch (err) { msg = errText(err); draw(); }
    }
  });
  dlg.addEventListener('cancel', e => { if (ask) e.preventDefault(); });
  dlg.addEventListener('submit', async e => {
    e.preventDefault(); if (busy) return;
    const code = document.getElementById('acctCode')?.value.trim();
    if (step === 'email') email = document.getElementById('acctEmail').value.trim();
    busy = true; msg = ''; draw();
    try {
      if (step === 'email') {
        await sendCode(email); step = 'code';
      } else {
        await verifyCode(email, code);
        step = 'email'; toast('¡Dentro! Tu huerto ya se guarda en tu cuenta');
      }
    } catch (err) { msg = errText(err); }
    busy = false; draw();
    (document.getElementById('acctCode') || document.getElementById('acctEmail'))?.focus();
  });

  onCloud((s, u) => { st = s; btn.classList.toggle('on', !!u); btn.title = u ? `Mi cuenta: ${u.email}` : 'Mi cuenta'; if (dlg.open) draw(); });
  initCloud(refresh).catch(e => console.warn('Cuenta', e));
}
