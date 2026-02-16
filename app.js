/* Sloth Dither Studio — client-only, offline-friendly. */

const $ = (sel) => document.querySelector(sel);

const els = {
  file: $('#file'),
  btnSample: $('#btnSample'),
  method: $('#method'),
  palette: $('#palette'),
  outW: $('#outW'),
  outWv: $('#outWv'),
  contrast: $('#contrast'),
  contrastV: $('#contrastV'),
  brightness: $('#brightness'),
  brightnessV: $('#brightnessV'),
  overlay: $('#overlay'),
  grain: $('#grain'),
  btnRender: $('#btnRender'),
  btnAuto: $('#btnAuto'),
  btnDownload: $('#btnDownload'),
  btnCopy: $('#btnCopy'),
  status: $('#status'),
  preview: $('#preview'),
  before: $('#before'),
  after: $('#after'),
  meta: $('#meta'),
  perf: $('#perf'),
  help: $('#help'),
  btnHelp: $('#btnHelp'),
  btnClose: $('#btnClose'),
  btnInstall: $('#btnInstall')
};

const ctxPrev = els.preview.getContext('2d', { willReadFrequently: true });
const ctxBefore = els.before.getContext('2d', { willReadFrequently: true });
const ctxAfter = els.after.getContext('2d', { willReadFrequently: true });

let sourceImage = null;
let lastRendered = null; // ImageData
let auto = false;
let deferredPrompt = null;

const PALETTES = {
  jungle: ['#061612', '#0e3a2a', '#2f6f44', '#84f0c8', '#ffd29a'],
  moss:   ['#071612', '#213a2c', '#4a5e3b', '#8a8f65', '#f2e7c9'],
  mono:   ['#061612', '#17352a', '#3e6f58', '#b7d2c6', '#ffffff'],
  sunset: ['#071612', '#2b1f2d', '#6a2d3d', '#ff7a7a', '#ffd29a']
};

const bayer4 = [
  [ 0,  8,  2, 10],
  [12,  4, 14,  6],
  [ 3, 11,  1,  9],
  [15,  7, 13,  5]
];

function hexToRgb(hex){
  const h = hex.replace('#','').trim();
  const v = parseInt(h, 16);
  return [ (v>>16)&255, (v>>8)&255, v&255 ];
}
function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function clamp255(x){ return Math.max(0, Math.min(255, x|0)); }

function srgbToLin(c){
  c /= 255;
  return c <= 0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4);
}
function linToSrgb(l){
  const c = l <= 0.0031308 ? 12.92*l : 1.055*Math.pow(l, 1/2.4) - 0.055;
  return clamp255(c*255);
}

function colorDist2(a,b){
  // Simple gamma-aware-ish distance: compare in linear space.
  const ar = srgbToLin(a[0]), ag = srgbToLin(a[1]), ab = srgbToLin(a[2]);
  const br = srgbToLin(b[0]), bg = srgbToLin(b[1]), bb = srgbToLin(b[2]);
  const dr = ar-br, dg = ag-bg, db = ab-bb;
  return dr*dr + dg*dg + db*db;
}

function nearestPalette(rgb, pal){
  let best = pal[0];
  let bestD = Infinity;
  for (const c of pal){
    const d = colorDist2(rgb, c);
    if (d < bestD){ bestD = d; best = c; }
  }
  return best;
}

function applyTone(rgb, contrast, brightness){
  // contrast around mid gray in linear-ish space (cheap).
  let [r,g,b] = rgb;
  const mid = 128;
  r = (r - mid) * contrast + mid;
  g = (g - mid) * contrast + mid;
  b = (b - mid) * contrast + mid;
  r = r + brightness*255;
  g = g + brightness*255;
  b = b + brightness*255;
  return [clamp255(r), clamp255(g), clamp255(b)];
}

function drawContained(img, canvas, ctx){
  const cw = canvas.width, ch = canvas.height;
  ctx.clearRect(0,0,cw,ch);
  const ir = img.width / img.height;
  const cr = cw / ch;
  let w = cw, h = ch;
  if (ir > cr){ h = w / ir; } else { w = h * ir; }
  const x = (cw - w)/2;
  const y = (ch - h)/2;
  ctx.drawImage(img, x, y, w, h);
  return { x, y, w, h };
}

function makeSampleSloth(){
  // Generate a simple sloth illustration on a canvas (no external asset).
  const c = document.createElement('canvas');
  c.width = 900;
  c.height = 600;
  const g = c.getContext('2d');
  g.fillStyle = '#0b1f18';
  g.fillRect(0,0,c.width,c.height);

  // leafy gradient
  const grad = g.createLinearGradient(0,0,900,600);
  grad.addColorStop(0, 'rgba(132,240,200,0.16)');
  grad.addColorStop(1, 'rgba(255,210,154,0.10)');
  g.fillStyle = grad;
  g.fillRect(0,0,c.width,c.height);

  // branch
  g.strokeStyle = 'rgba(255,210,154,0.65)';
  g.lineWidth = 34;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(120, 360);
  g.quadraticCurveTo(420, 260, 780, 320);
  g.stroke();

  // sloth body
  const cx = 470, cy = 290;
  g.fillStyle = 'rgba(234,246,240,0.86)';
  roundedBlob(g, cx-120, cy-90, 240, 220, 90);
  g.fill();

  // face mask
  g.fillStyle = 'rgba(15,43,33,0.80)';
  roundedBlob(g, cx-70, cy-40, 140, 120, 60);
  g.fill();

  // eyes
  g.fillStyle = '#061612';
  g.beginPath(); g.arc(cx-26, cy+4, 9, 0, Math.PI*2); g.fill();
  g.beginPath(); g.arc(cx+26, cy+4, 9, 0, Math.PI*2); g.fill();

  // smile
  g.strokeStyle = 'rgba(6,22,18,0.92)';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(cx-18, cy+28);
  g.quadraticCurveTo(cx, cy+40, cx+18, cy+28);
  g.stroke();

  // claws
  g.strokeStyle = 'rgba(234,246,240,0.8)';
  g.lineWidth = 8;
  for (let i=0;i<3;i++){
    g.beginPath();
    g.moveTo(cx-120 + i*10, cy+70 + i*4);
    g.lineTo(cx-170, cy+110 + i*10);
    g.stroke();
  }

  // text
  g.fillStyle = 'rgba(234,246,240,0.82)';
  g.font = '600 34px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
  g.fillText('sample sloth (locally generated)', 28, 60);
  g.fillStyle = 'rgba(183,210,198,0.9)';
  g.font = '14px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
  g.fillText('sloth-dither-studio • offline • no uploads', 30, 86);

  const img = new Image();
  img.src = c.toDataURL('image/png');
  return img;
}

function roundedBlob(g, x, y, w, h, r){
  r = Math.min(r, w/2, h/2);
  g.beginPath();
  g.moveTo(x+r, y);
  g.arcTo(x+w, y, x+w, y+h, r);
  g.arcTo(x+w, y+h, x, y+h, r);
  g.arcTo(x, y+h, x, y, r);
  g.arcTo(x, y, x+w, y, r);
  g.closePath();
}

function getSettings(){
  return {
    method: els.method.value,
    palette: els.palette.value,
    outW: parseInt(els.outW.value, 10),
    contrast: parseFloat(els.contrast.value),
    brightness: parseFloat(els.brightness.value),
    overlay: els.overlay.checked,
    grain: els.grain.checked
  };
}

function setStatus(msg, isBad=false){
  els.status.textContent = msg;
  els.status.style.color = isBad ? 'var(--danger)' : 'var(--muted)';
}

function makeOverlayPattern(size=96){
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  g.clearRect(0,0,size,size);
  g.translate(size/2, size/2);
  g.rotate(-0.2);
  g.translate(-size/2, -size/2);

  // simple sloth head icon repeated
  g.fillStyle = 'rgba(255,255,255,0.06)';
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.lineWidth = 2;
  for (const p of [[22,26],[62,70]]){
    const [x,y] = p;
    g.beginPath();
    g.roundRect(x, y, 34, 34, 14);
    g.fill();
    g.stroke();
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.beginPath();
    g.ellipse(x+17,y+18, 10, 8, 0, 0, Math.PI*2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.06)';
  }
  return ctxPrev.createPattern(c, 'repeat');
}

function addGrain(imgData){
  const d = imgData.data;
  for (let i=0;i<d.length;i+=4){
    const n = (Math.random()*2-1) * 10; // +-10
    d[i] = clamp255(d[i] + n);
    d[i+1] = clamp255(d[i+1] + n);
    d[i+2] = clamp255(d[i+2] + n);
  }
}

function ditherBayer(src, w, h, pal, tone){
  const out = new ImageData(w,h);
  const d0 = src.data;
  const d1 = out.data;

  for (let y=0;y<h;y++){
    for (let x=0;x<w;x++){
      const i = (y*w + x)*4;
      let rgb = [d0[i], d0[i+1], d0[i+2]];
      rgb = applyTone(rgb, tone.contrast, tone.brightness);

      const t = (bayer4[y&3][x&3] / 16) - 0.5; // [-0.5..0.4375]
      const bump = 22 * t;
      rgb = [clamp255(rgb[0]+bump), clamp255(rgb[1]+bump), clamp255(rgb[2]+bump)];

      const n = nearestPalette(rgb, pal);
      d1[i] = n[0]; d1[i+1] = n[1]; d1[i+2] = n[2]; d1[i+3] = 255;
    }
  }
  return out;
}

function ditherErrorDiffusion(src, w, h, pal, tone, mode){
  // work in float RGB for diffusion
  const buf = new Float32Array(w*h*3);
  const d0 = src.data;
  for (let y=0;y<h;y++){
    for (let x=0;x<w;x++){
      const i = (y*w + x);
      const j = i*4;
      let rgb = applyTone([d0[j], d0[j+1], d0[j+2]], tone.contrast, tone.brightness);
      buf[i*3] = rgb[0];
      buf[i*3+1] = rgb[1];
      buf[i*3+2] = rgb[2];
    }
  }

  const out = new ImageData(w,h);
  const d1 = out.data;

  const addErr = (x,y, er,eg,eb, k) => {
    if (x<0||x>=w||y<0||y>=h) return;
    const i = (y*w + x)*3;
    buf[i] += er*k;
    buf[i+1] += eg*k;
    buf[i+2] += eb*k;
  };

  for (let y=0;y<h;y++){
    for (let x=0;x<w;x++){
      const i = (y*w + x);
      const bi = i*3;
      const rgb = [clamp255(buf[bi]), clamp255(buf[bi+1]), clamp255(buf[bi+2])];
      const n = nearestPalette(rgb, pal);
      const oi = i*4;
      d1[oi] = n[0]; d1[oi+1] = n[1]; d1[oi+2] = n[2]; d1[oi+3] = 255;

      const er = rgb[0]-n[0], eg = rgb[1]-n[1], eb = rgb[2]-n[2];

      if (mode === 'floyd'){
        // Floyd–Steinberg
        addErr(x+1,y, er,eg,eb, 7/16);
        addErr(x-1,y+1, er,eg,eb, 3/16);
        addErr(x,y+1, er,eg,eb, 5/16);
        addErr(x+1,y+1, er,eg,eb, 1/16);
      } else {
        // Atkinson (lighter diffusion)
        addErr(x+1,y, er,eg,eb, 1/8);
        addErr(x+2,y, er,eg,eb, 1/8);
        addErr(x-1,y+1, er,eg,eb, 1/8);
        addErr(x,y+1, er,eg,eb, 1/8);
        addErr(x+1,y+1, er,eg,eb, 1/8);
        addErr(x,y+2, er,eg,eb, 1/8);
      }
    }
  }
  return out;
}

async function render(){
  if (!sourceImage){
    setStatus('Pick an image first (or use the sample).', true);
    return;
  }
  const t0 = performance.now();
  els.btnRender.disabled = true;
  setStatus('Rendering…');

  const s = getSettings();
  const pal = PALETTES[s.palette].map(hexToRgb);

  const outW = s.outW;
  const outH = Math.round(outW * (sourceImage.height/sourceImage.width));

  // draw source at output size
  const tmp = document.createElement('canvas');
  tmp.width = outW;
  tmp.height = outH;
  const g = tmp.getContext('2d', { willReadFrequently:true });
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(sourceImage, 0,0,outW,outH);

  const src = g.getImageData(0,0,outW,outH);
  const tone = { contrast: s.contrast, brightness: s.brightness };

  let out;
  if (s.method === 'bayer') out = ditherBayer(src, outW, outH, pal, tone);
  else out = ditherErrorDiffusion(src, outW, outH, pal, tone, s.method);

  if (s.grain) addGrain(out);

  // paint to preview
  els.preview.width = outW;
  els.preview.height = outH;
  ctxPrev.putImageData(out, 0, 0);

  if (s.overlay){
    ctxPrev.save();
    ctxPrev.globalCompositeOperation = 'overlay';
    ctxPrev.fillStyle = makeOverlayPattern(110);
    ctxPrev.fillRect(0,0,outW,outH);
    ctxPrev.restore();
  }

  lastRendered = ctxPrev.getImageData(0,0,outW,outH);

  // before/after small previews
  els.before.width = 520; els.before.height = 360;
  els.after.width = 520; els.after.height = 360;
  drawContained(sourceImage, els.before, ctxBefore);
  ctxAfter.clearRect(0,0,els.after.width, els.after.height);
  drawContained(els.preview, els.after, ctxAfter);

  els.btnDownload.disabled = false;
  els.btnCopy.disabled = !('clipboard' in navigator);

  // meta
  const t1 = performance.now();
  const ms = Math.round(t1 - t0);
  els.meta.textContent = `Output: ${outW}×${outH} • Method: ${labelMethod(s.method)} • Palette: ${labelPal(s.palette)}`;
  els.perf.textContent = `${ms}ms`;
  setStatus('Done.');
  els.btnRender.disabled = false;

  persistSettings();
}

function labelMethod(m){
  if (m==='bayer') return 'Ordered (Bayer)';
  if (m==='floyd') return 'Floyd–Steinberg';
  return 'Atkinson';
}
function labelPal(p){
  return ({jungle:'Jungle print', moss:'Moss & bark', mono:'Ink', sunset:'Sunset hammock'})[p] || p;
}

function downloadPng(){
  if (!lastRendered) return;
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  a.download = `sloth-dither-${stamp}.png`;
  a.href = els.preview.toDataURL('image/png');
  a.click();
}

async function copyToClipboard(){
  try{
    const blob = await new Promise(res => els.preview.toBlob(res, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    setStatus('Copied PNG to clipboard.');
  } catch (e){
    setStatus('Copy failed (browser permissions). Download instead.', true);
  }
}

function onFile(file){
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    sourceImage = img;
    setStatus('Loaded.');
    if (auto) render();
  };
  img.onerror = () => setStatus('Could not read that file.', true);
  img.src = url;
}

function persistSettings(){
  const s = getSettings();
  localStorage.setItem('sds_settings', JSON.stringify(s));
}
function loadSettings(){
  try{
    const raw = localStorage.getItem('sds_settings');
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.method) els.method.value = s.method;
    if (s.palette) els.palette.value = s.palette;
    if (s.outW) els.outW.value = String(s.outW);
    if (s.contrast) els.contrast.value = String(s.contrast);
    if (s.brightness) els.brightness.value = String(s.brightness);
    if (typeof s.overlay === 'boolean') els.overlay.checked = s.overlay;
    if (typeof s.grain === 'boolean') els.grain.checked = s.grain;
  } catch {}
}

function syncLabels(){
  els.outWv.textContent = `${els.outW.value}px`;
  els.contrastV.textContent = `${parseFloat(els.contrast.value).toFixed(2)}×`;
  const b = parseFloat(els.brightness.value);
  els.brightnessV.textContent = `${b>=0?'+':''}${b.toFixed(2)}`;
}

function initPwa(){
  if ('serviceWorker' in navigator){
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    els.btnInstall.hidden = false;
  });
  els.btnInstall.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    els.btnInstall.hidden = true;
  });
}

function wire(){
  loadSettings();
  syncLabels();

  els.file.addEventListener('change', (e) => onFile(e.target.files?.[0]));
  els.btnSample.addEventListener('click', () => {
    const img = makeSampleSloth();
    img.onload = () => {
      sourceImage = img;
      setStatus('Loaded sample sloth.');
      if (auto) render();
    };
  });

  els.btnRender.addEventListener('click', render);
  els.btnAuto.addEventListener('click', () => {
    auto = !auto;
    els.btnAuto.textContent = auto ? 'Auto-render: on' : 'Auto-render';
    setStatus(auto ? 'Auto-render enabled.' : 'Auto-render disabled.');
    if (auto && sourceImage) render();
  });

  for (const el of [els.method, els.palette, els.outW, els.contrast, els.brightness, els.overlay, els.grain]){
    el.addEventListener('input', () => {
      syncLabels();
      if (auto && sourceImage) render();
    });
  }

  els.btnDownload.addEventListener('click', downloadPng);
  els.btnCopy.addEventListener('click', copyToClipboard);

  els.btnHelp.addEventListener('click', () => els.help.showModal());
  els.btnClose.addEventListener('click', () => els.help.close());
  els.help.addEventListener('click', (e) => {
    if (e.target === els.help) els.help.close();
  });

  initPwa();
}

wire();
