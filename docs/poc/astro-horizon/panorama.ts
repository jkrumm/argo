/* eslint-disable no-console */
/**
 * P5 — the view. One azimuth × altitude panorama carrying all three fields at
 * once: the measured terrain silhouette, the modelled skyglow rose behind it,
 * and the tracks the core, moon and sun walk across it tonight.
 *
 * Each of those exists separately in some tool (PeakFinder / lightpollutionmap
 * / PhotoPills). The reason to put them on one pair of axes is that the answer
 * — "can I shoot the core, and what is behind it" — is a statement about all
 * three at the same coordinate.
 *
 * Emits a self-contained HTML file; no build step, no server.
 */

import { writeFileSync } from 'node:fs'
import { Body, Equator, Horizon, Illumination, Observer as AstroObserver } from 'astronomy-engine'
import { galacticCorePosition } from '../../../apps/api/src/lib/astro-ephemeris.js'
import { horizonProfile } from '../../../apps/api/src/lib/terrain-horizon.js'
import {
  computeCalibration,
  coreDirectionGlow,
  skyglowProfile,
  SKYGLOW_MODEL,
} from '../../../apps/api/src/lib/skyglow.js'
import { mpsasFromLpi, lorenzZone } from '../../../apps/api/src/lib/lorenz-decode.js'
import { lorenzSampler } from './lorenz-sampler.js'
import { demFor, SITES } from './sites.js'

const SITE_ID = process.env.SITE ?? 'walchensee'
const DATE = process.env.DATE ?? '2026-08-22'
const STEP_MIN = 5

const site = SITES.find((s) => s.id === SITE_ID)
if (!site) throw new Error(`unknown site ${SITE_ID}`)

const dem = await demFor([site], 11)
const profile = horizonProfile({ sampler: dem.sampler, site })
const observer = new AstroObserver(site.lat, site.lon, profile.elevationM)

// Transit azimuth/altitude first, so the skyglow rose is calibrated on the
// direction that actually matters rather than on an arbitrary bearing.
const noonUtc = new Date(`${DATE}T12:00:00Z`)
let transit = { az: 180, alt: 0, time: noonUtc }
for (let t = 0; t < 24 * 60; t += 5) {
  const time = new Date(noonUtc.getTime() + t * 60_000)
  const c = galacticCorePosition(site, time)
  if (c.altitude > transit.alt) transit = { az: c.azimuth, alt: c.altitude, time }
}

const sampler = await lorenzSampler(site)
const zenithLpi = sampler(site.lat, site.lon)
const calibration = computeCalibration({ sampler, site, zenithLpi, model: SKYGLOW_MODEL })
const rose = skyglowProfile({ sampler, site, zenithLpi, model: SKYGLOW_MODEL })
const skyglow = {
  zenith: { lpi: zenithLpi, mpsas: mpsasFromLpi(zenithLpi), zone: lorenzZone(zenithLpi) },
  profile: rose,
  core: coreDirectionGlow({
    sampler,
    site,
    zenithLpi,
    coreAzimuthDeg: transit.az,
    coreAltitudeDeg: transit.alt,
    model: SKYGLOW_MODEL,
  }),
  calibration,
}

const eq = (body: Body, time: Date): [number, number] => {
  const e = Equator(body, time, observer, true, true)
  return [e.ra, e.dec]
}

type Sample = {
  t: string
  sunAlt: number
  sunAz: number
  moonAlt: number
  moonAz: number
  moonIllum: number
  coreAlt: number
  coreAz: number
}

const samples: Sample[] = []
const start = new Date(`${DATE}T14:00:00Z`)
for (let m = 0; m <= 20 * 60; m += STEP_MIN) {
  const time = new Date(start.getTime() + m * 60_000)
  const sun = Horizon(time, observer, ...eq(Body.Sun, time))
  const moon = Horizon(time, observer, ...eq(Body.Moon, time))
  const core = galacticCorePosition(site, time)
  samples.push({
    t: time.toISOString(),
    sunAlt: sun.altitude,
    sunAz: sun.azimuth,
    moonAlt: moon.altitude,
    moonAz: moon.azimuth,
    moonIllum: Illumination(Body.Moon, time).phase_fraction,
    coreAlt: core.altitude,
    coreAz: core.azimuth,
  })
}

const payload = {
  site: { ...site, elevationM: profile.elevationM },
  date: DATE,
  horizon: profile.points.map((p) => ({
    az: p.azimuthDeg,
    alt: p.altitudeDeg,
    rangeM: p.rangeM,
    summitM: p.summitM,
  })),
  skyglow: {
    azimuths: skyglow.profile.azimuths,
    altitudes: skyglow.profile.altitudes,
    mpsas: skyglow.profile.mpsas,
    dominant: skyglow.profile.dominant,
  },
  zenith: skyglow.zenith,
  samples,
}

const out = new URL('panorama.html', import.meta.url).pathname
writeFileSync(out, html(payload))
console.log(`wrote ${out}`)
console.log(
  `  ${site.name}, ${DATE} — transit ${transit.alt.toFixed(1)}° at az ${transit.az.toFixed(0)}°`,
)
console.log(
  `  zenith ${skyglow.zenith.mpsas.toFixed(2)} mpsas, dominant glow ${skyglow.profile.dominant.compass} ${skyglow.profile.dominant.mpsas.toFixed(2)}`,
)
console.log(
  `  south-arc terrain max ${Math.max(...profile.points.filter((p) => p.azimuthDeg >= 150 && p.azimuthDeg <= 215).map((p) => p.altitudeDeg)).toFixed(2)}°`,
)

function html(data: unknown): string {
  return `<!doctype html><meta charset="utf-8"><title>Astro panorama POC</title>
<style>
  body { background:#18181b; color:#e4e4e7; font:13px/1.5 system-ui, sans-serif; margin:0; padding:20px; }
  canvas { display:block; width:100%; background:#09090b; border-radius:8px; }
  h1 { font-size:15px; font-weight:600; margin:0 0 4px }
  .meta { color:#a1a1aa; margin-bottom:12px }
  .ctl { margin:12px 0; display:flex; gap:12px; align-items:center }
  input[type=range] { flex:1 }
</style>
<h1 id="title"></h1><div class="meta" id="meta"></div>
<canvas id="c" width="2000" height="760"></canvas>
<div class="ctl"><span id="clock" style="font-family:ui-monospace,monospace;width:120px"></span><input type="range" id="t" min="0" max="0" value="0"></div>
<div class="meta" id="readout"></div>
<script>
const D = ${JSON.stringify(data)};
const C = document.getElementById('c'), X = C.getContext('2d');
const AZ0 = 0, AZ1 = 360, ALT0 = -4, ALT1 = 52;
const PAD = { l: 48, r: 16, t: 16, b: 30 };
const W = C.width - PAD.l - PAD.r, H = C.height - PAD.t - PAD.b;
const px = az => PAD.l + ((az - AZ0) / (AZ1 - AZ0)) * W;
const py = alt => PAD.t + (1 - (alt - ALT0) / (ALT1 - ALT0)) * H;

function horizonAt(az) {
  const p = D.horizon, n = p.length;
  az = ((az % 360) + 360) % 360;
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    const span = ((b.az - a.az + 360) % 360) || 360;
    const off = (az - a.az + 360) % 360;
    if (off <= span) return a.alt + (b.alt - a.alt) * off / span;
  }
  return p[0].alt;
}
function glowAt(az, alt) {
  const A = D.skyglow.altitudes, Z = D.skyglow.azimuths, M = D.skyglow.mpsas;
  if (alt <= A[0]) alt = A[0];
  let i = A.length - 1;
  for (let k = 0; k < A.length - 1; k++) if (alt >= A[k] && alt <= A[k+1]) { i = k; break; }
  const j = Math.min(A.length - 1, i + 1);
  const fa = A[j] === A[i] ? 0 : (Math.min(alt, A[j]) - A[i]) / (A[j] - A[i]);
  const az0 = ((az % 360) + 360) % 360;
  const zi = Math.floor(az0 / 5) % Z.length, zj = (zi + 1) % Z.length;
  const fz = (az0 % 5) / 5;
  const at = (r, c) => M[r][c];
  const lo = at(i, zi) * (1 - fz) + at(i, zj) * fz;
  const hi = at(j, zi) * (1 - fz) + at(j, zj) * fz;
  return lo * (1 - fa) + hi * fa;
}

function draw(idx) {
  const s = D.samples[idx];
  X.clearRect(0, 0, C.width, C.height);

  // Skyglow field: mpsas 17 (bright) → 22 (pristine), painted at 4px resolution.
  const STEP = 4;
  for (let x = PAD.l; x < PAD.l + W; x += STEP) {
    for (let y = PAD.t; y < PAD.t + H; y += STEP) {
      const az = AZ0 + ((x - PAD.l) / W) * (AZ1 - AZ0);
      const alt = ALT0 + (1 - (y - PAD.t) / H) * (ALT1 - ALT0);
      if (alt < 0) continue;
      const g = glowAt(az, alt);
      const k = Math.max(0, Math.min(1, (22.0 - g) / 4.5));
      X.fillStyle = 'rgba(236,154,60,' + (k * k * 0.85).toFixed(3) + ')';
      X.fillRect(x, y, STEP, STEP);
    }
  }

  // Grid.
  X.strokeStyle = 'rgba(255,255,255,.10)'; X.fillStyle = '#71717a'; X.font = '12px ui-monospace, monospace';
  for (let alt = 0; alt <= 50; alt += 10) {
    X.beginPath(); X.moveTo(PAD.l, py(alt)); X.lineTo(PAD.l + W, py(alt)); X.stroke();
    X.fillText(alt + '°', 8, py(alt) + 4);
  }
  const NAMES = { 0:'N', 45:'NE', 90:'E', 135:'SE', 180:'S', 225:'SW', 270:'W', 315:'NW', 360:'N' };
  for (const a of Object.keys(NAMES).map(Number)) {
    X.strokeStyle = a === 180 ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.10)';
    X.beginPath(); X.moveTo(px(a), PAD.t); X.lineTo(px(a), PAD.t + H); X.stroke();
    X.fillText(NAMES[a], px(a) - 8, C.height - 10);
  }

  // Terrain silhouette, 1° resolution off the interpolated profile.
  X.beginPath(); X.moveTo(px(AZ0), py(horizonAt(AZ0)));
  for (let az = AZ0; az <= AZ1; az += 1) X.lineTo(px(az), py(horizonAt(az)));
  X.lineTo(px(AZ1), C.height - PAD.b); X.lineTo(px(AZ0), C.height - PAD.b); X.closePath();
  X.fillStyle = '#27272a'; X.fill();
  X.strokeStyle = '#52525b'; X.lineWidth = 1.5; X.stroke();

  // Tracks: full night faint, the current instant as a disc.
  const track = (key, colour, width) => {
    X.strokeStyle = colour; X.lineWidth = width; X.globalAlpha = .5; X.beginPath();
    let started = false;
    for (const q of D.samples) {
      const az = q[key + 'Az'], alt = q[key + 'Alt'];
      if (alt < ALT0) { started = false; continue; }
      const X0 = px(az), Y0 = py(alt);
      if (!started) { X.moveTo(X0, Y0); started = true; } else X.lineTo(X0, Y0);
    }
    X.stroke(); X.globalAlpha = 1;
  };
  track('sun', '#f0b726', 1.5);
  track('moon', '#a1a1aa', 1.5);
  track('core', '#38bdf8', 2.5);

  const dot = (az, alt, colour, r, label) => {
    if (alt < ALT0) return;
    X.beginPath(); X.arc(px(az), py(alt), r, 0, 7); X.fillStyle = colour; X.fill();
    X.fillStyle = '#e4e4e7'; X.font = '12px system-ui'; X.fillText(label, px(az) + r + 4, py(alt) + 4);
  };
  dot(s.sunAz, s.sunAlt, '#f0b726', 7, 'Sun');
  dot(s.moonAz, s.moonAlt, '#d4d4d8', 5 + 5 * s.moonIllum, 'Moon ' + Math.round(s.moonIllum * 100) + '%');
  dot(s.coreAz, s.coreAlt, '#38bdf8', 8, 'Core');

  const ridge = horizonAt(s.coreAz), clr = s.coreAlt - ridge;
  document.getElementById('clock').textContent = new Date(s.t).toISOString().slice(11, 16) + ' UTC';
  document.getElementById('readout').innerHTML =
    'core alt <b>' + s.coreAlt.toFixed(1) + '°</b> az ' + s.coreAz.toFixed(0) + '° &nbsp;·&nbsp; terrain there <b>' + ridge.toFixed(1) +
    '°</b> &nbsp;·&nbsp; clearance <b style="color:' + (clr > 2 ? '#43bf4d' : '#e76a6e') + '">' + clr.toFixed(1) +
    '°</b> &nbsp;·&nbsp; skyglow behind the core <b>' + glowAt(s.coreAz, Math.max(5, s.coreAlt)).toFixed(2) +
    ' mpsas</b> &nbsp;·&nbsp; sun ' + s.sunAlt.toFixed(1) + '°';
}
const slider = document.getElementById('t');
slider.max = D.samples.length - 1;
slider.value = Math.floor(D.samples.length * 0.45);
slider.oninput = () => draw(+slider.value);
document.getElementById('title').textContent = D.site.name + ' — ' + D.date;
document.getElementById('meta').textContent =
  D.site.lat.toFixed(4) + ', ' + D.site.lon.toFixed(4) + ' · ' + D.site.elevationM.toFixed(0) + ' m · zenith ' +
  D.zenith.mpsas.toFixed(2) + ' mpsas (zone ' + D.zenith.zone + ') · dominant glow ' + D.skyglow.dominant.compass;
draw(+slider.value);
</script>`
}
