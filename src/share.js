// Tarjetas para compartir (imagen PNG) una planta o el huerto entero.
// Se dibujan en un canvas con la paleta de la app y se abren con el menú de compartir del móvil;
// si el navegador no puede compartir archivos, la imagen se descarga.
const W = 1080, H = 1350;
const C = {bg: '#EFEBE2', card: '#FDFBF8', line: '#C9D0B0', carob: '#725C3A', green: '#5F7651', matcha: '#809671', ink: '#3D3121', muted: '#7A6A55', soft: '#E4E9D3'};
const URL_TXT = 'esthersmo.github.io/huerta-viva';

async function fonts() {
  try {
    await Promise.all(['700 64px "Bricolage Grotesque"', '400 34px "DM Sans"', '500 34px "DM Sans"', '600 48px Fraunces', 'italic 600 48px Fraunces'].map(f => document.fonts.load(f)));
  } catch (e) {}
}
const img = src => new Promise(ok => { if (!src) return ok(null); const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });

function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }
// Recorta la foto para que llene el hueco sin deformarse
function cover(c, im, x, y, w, h, r) {
  c.save(); rr(c, x, y, w, h, r); c.clip();
  const s = Math.max(w / im.width, h / im.height), iw = im.width * s, ih = im.height * s;
  c.drawImage(im, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih); c.restore();
}
// Texto en varias líneas; devuelve la y final
function wrap(c, txt, x, y, maxW, lh, maxLines = 2, align = 'left') {
  const words = String(txt).split(' '); let line = '', n = 0; c.textAlign = align;
  for (let i = 0; i < words.length; i++) {
    const t = line ? line + ' ' + words[i] : words[i];
    if (c.measureText(t).width > maxW && line) {
      if (++n === maxLines) { let l = line; while (c.measureText(l + '…').width > maxW && l) l = l.slice(0, -1); c.fillText(l + '…', x, y); return y + lh; }
      c.fillText(line, x, y); y += lh; line = words[i];
    } else line = t;
  }
  c.fillText(line, x, y); return y + lh;
}
function frame(c) {
  c.fillStyle = C.bg; c.fillRect(0, 0, W, H);
  c.fillStyle = C.card; c.strokeStyle = C.line; c.lineWidth = 3; rr(c, 50, 50, W - 100, H - 100, 44); c.fill(); c.stroke();
}
function footer(c) {
  const y = H - 110;
  c.strokeStyle = C.line; c.lineWidth = 2; c.beginPath(); c.moveTo(100, y - 50); c.lineTo(W - 100, y - 50); c.stroke();
  c.textAlign = 'left'; c.fillStyle = C.ink; c.font = '600 46px Fraunces'; c.fillText('Huerta', 100, y);
  const w = c.measureText('Huerta ').width; c.fillStyle = C.matcha; c.font = 'italic 600 46px Fraunces'; c.fillText('Viva', 100 + w, y);
  c.textAlign = 'right'; c.fillStyle = C.muted; c.font = '400 28px "DM Sans"'; c.fillText(URL_TXT, W - 100, y - 4);
}
function noPhoto(c, x, y, w, h, r, letter, deco) {
  c.fillStyle = C.soft; rr(c, x, y, w, h, r); c.fill();
  if (deco) { const s = Math.min(w, h) * .7 / Math.max(deco.width, deco.height); c.drawImage(deco, x + (w - deco.width * s) / 2, y + (h - deco.height * s) / 2, deco.width * s, deco.height * s); return; }
  c.fillStyle = C.matcha; c.textAlign = 'center'; c.font = `700 ${Math.round(h * .45)}px "Bricolage Grotesque"`; c.fillText(letter, x + w / 2, y + h * .65);
}
function toBlob(cv) { return new Promise(ok => cv.toBlob(ok, 'image/png')); }

async function send(cv, name, title, text) {
  const blob = await toBlob(cv); const file = new File([blob], name, {type: 'image/png'});
  try {
    if (navigator.canShare && navigator.canShare({files: [file]})) { await navigator.share({files: [file], title, text}); return 'shared'; }
  } catch (e) { if (e.name === 'AbortError') return 'cancel'; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000); return 'downloaded';
}
const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'planta';

// d: {name, species, loc, sownTxt, ageTxt, photo:{src, caption}|null, care:[texto], deco}
export async function sharePlant(d) {
  await fonts();
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
  frame(c);
  const [ph, deco] = await Promise.all([img(d.photo?.src), img(d.deco)]);
  const px = 100, py = 100, pw = W - 200, ph_ = 700;
  if (ph) cover(c, ph, px, py, pw, ph_, 30); else noPhoto(c, px, py, pw, ph_, 30, d.species[0], deco);
  if (ph && d.photo.caption) {
    c.font = '500 30px "DM Sans"'; const t = d.photo.caption, tw = c.measureText(t).width + 44;
    c.fillStyle = 'rgba(253,251,248,.92)'; rr(c, px + 24, py + ph_ - 78, tw, 54, 27); c.fill();
    c.fillStyle = C.ink; c.textAlign = 'left'; c.fillText(t, px + 46, py + ph_ - 41);
  }
  let y = py + ph_ + 90;
  c.fillStyle = C.green; c.font = '700 66px "Bricolage Grotesque"'; y = wrap(c, d.name, px, y, pw, 72, 2);
  c.fillStyle = C.muted; c.font = '400 34px "DM Sans"'; c.textAlign = 'left'; c.fillText(`${d.species} · ${d.loc}`, px, y - 8); y += 50;
  c.fillStyle = C.ink; c.font = '500 32px "DM Sans"'; c.fillText(`${d.sownTxt} · ${d.ageTxt}`, px, y); y += 48;
  c.fillStyle = C.muted; c.font = '400 30px "DM Sans"';
  for (const t of d.care.slice(0, 1)) y = wrap(c, t, px, y, pw, 40, 2);
  footer(c);
  return send(cv, `huerta-viva-${slug(d.name)}.png`, d.name, `${d.name} (${d.species.toLowerCase()}) en mi huerto · Huerta Viva`);
}

// d: {zone, plants:[{name, species, photo, deco}]}
export async function shareGarden(d) {
  await fonts();
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
  frame(c);
  c.textAlign = 'left'; c.fillStyle = C.carob; c.font = '700 72px "Bricolage Grotesque"'; c.fillText('Mi huerto', 100, 180);
  const n = d.plants.length;
  c.fillStyle = C.muted; c.font = '400 34px "DM Sans"'; c.fillText(`${n} ${n === 1 ? 'planta' : 'plantas'}${d.zone ? ' · ' + d.zone : ''}`, 100, 235);
  const cols = 3, gap = 30, cw = (W - 200 - gap * (cols - 1)) / cols, ch = 215, rowH = ch + 66, max = 9;
  const shown = n > max ? d.plants.slice(0, max - 1) : d.plants.slice(0, max);
  const ims = await Promise.all(shown.map(p => img(p.photo))), decos = await Promise.all(shown.map(p => p.photo ? null : img(p.deco)));
  shown.forEach((p, i) => {
    const x = 100 + (i % cols) * (cw + gap), y = 285 + Math.floor(i / cols) * rowH;
    if (ims[i]) cover(c, ims[i], x, y, cw, ch, 22); else noPhoto(c, x, y, cw, ch, 22, p.species[0], decos[i]);
    c.fillStyle = C.ink; c.font = '500 28px "DM Sans"'; wrap(c, p.name, x + cw / 2, y + ch + 40, cw, 32, 1, 'center');
  });
  if (n > max) {
    const i = max - 1, x = 100 + (i % cols) * (cw + gap), y = 290 + Math.floor(i / cols) * rowH;
    c.fillStyle = C.soft; rr(c, x, y, cw, ch, 22); c.fill();
    c.fillStyle = C.green; c.textAlign = 'center'; c.font = '700 64px "Bricolage Grotesque"'; c.fillText(`+${n - max + 1}`, x + cw / 2, y + ch / 2 + 10);
    c.font = '400 28px "DM Sans"'; c.fillText('plantas más', x + cw / 2, y + ch / 2 + 54);
  }
  if (!n) { c.fillStyle = C.muted; c.textAlign = 'center'; c.font = '400 34px "DM Sans"'; c.fillText('Aún no hay plantas', W / 2, 600); }
  footer(c);
  return send(cv, 'huerta-viva-mi-huerto.png', 'Mi huerto', `Mi huerto en Huerta Viva: ${n} ${n === 1 ? 'planta' : 'plantas'}`);
}
