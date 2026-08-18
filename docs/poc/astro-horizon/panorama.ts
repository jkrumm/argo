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
const DATE = process.env.DATE ?? '2026-08-12'
const STEP_MIN = 5

/**
 * Any coordinate, not just a committed site — the whole point of the rebuild is that
 * scouting is not restricted to four rows in a table. `LAT`/`LON`/`NAME` override `SITE`.
 */
const site =
  process.env.LAT !== undefined && process.env.LON !== undefined
    ? {
        id: 'custom',
        name: process.env.NAME ?? 'Custom point',
        lat: Number(process.env.LAT),
        lon: Number(process.env.LON),
        timeZone: 'Europe/Berlin',
      }
    : SITES.find((s) => s.id === SITE_ID)
if (!site) throw new Error(`unknown site ${SITE_ID}`)

const dem = await demFor([site], 11)
const profile = horizonProfile({ sampler: dem.sampler, site })

/**
 * The advisory near band (ground within 500 m), marched here rather than read off
 * `horizonProfile` — the shipped march returns one max over the whole ray. §3 of the
 * research doc is why the two bands are drawn separately.
 */
const NEAR_FIELD_M = 500
const nearBand = new Map<number, number>()
{
  const mPerDegLat = 111_320
  const mPerDegLon = mPerDegLat * Math.cos((site.lat * Math.PI) / 180)
  const rEff = 6_371_000 / (1 - 0.13)
  for (const point of profile.points) {
    const az = (point.azimuthDeg * Math.PI) / 180
    let best = -90
    for (let r = 150; r <= NEAR_FIELD_M; r += 150) {
      const h = dem.sampler(
        site.lat + (r * Math.cos(az)) / mPerDegLat,
        site.lon + (r * Math.sin(az)) / mPerDegLon,
      )
      if (!Number.isFinite(h)) continue
      const a = (Math.atan2(h - profile.elevationM - (r * r) / (2 * rEff), r) * 180) / Math.PI
      if (a > best) best = a
    }
    nearBand.set(point.azimuthDeg, best)
  }
}
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
  body { background:#18181b; color:#e4e4e7; font:13px/1.55 system-ui, sans-serif; margin:0; padding:20px 24px; }
  canvas { display:block; width:100%; background:#09090b; border-radius:8px; }
  h1 { font-size:15px; font-weight:600; margin:0 0 4px }
  .meta { color:#a1a1aa; margin-bottom:12px }
  .ctl { margin:14px 0 8px; display:flex; gap:14px; align-items:center }
  input[type=range] { flex:1; accent-color:#38bdf8 }
  .num { font-family:ui-monospace, monospace }
  .key { display:flex; gap:18px; color:#a1a1aa; margin-top:10px; flex-wrap:wrap }
  .key i { display:inline-block; width:22px; height:3px; vertical-align:middle; margin-right:6px; border-radius:2px }
</style>
<h1 id="title"></h1><div class="meta" id="meta"></div>
<canvas id="c" width="2000" height="820"></canvas>
<div class="ctl"><span id="clock" class="num" style="width:150px"></span><input type="range" id="t" min="0" max="0" value="0"></div>
<div class="meta" id="readout"></div>
<div class="key">
  <span><i style="background:#38bdf8"></i>galactic core</span>
  <span><i style="background:#43bf4d"></i>core clears the gate</span>
  <span><i style="background:#d4d4d8"></i>moon</span>
  <span><i style="background:#f0b726"></i>sun</span>
  <span><i style="background:#52525b"></i>skyline (&gt;500 m)</span>
  <span><i style="background:#3f3f46"></i>local ground (&le;500 m, advisory)</span>
  <span><i style="background:#ec9a3c"></i>artificial skyglow</span>
</div>
<script>
const D = ${JSON.stringify(data)};
const C = document.getElementById('c'), X = C.getContext('2d');
const AZ0 = 0, AZ1 = 360, ALT0 = -4, ALT1 = 52;
const PAD = { l: 52, r: 18, t: 18, b: 32 };
const W = C.width - PAD.l - PAD.r, H = C.height - PAD.t - PAD.b;
const px = az => PAD.l + ((az - AZ0) / (AZ1 - AZ0)) * W;
const py = alt => PAD.t + (1 - (alt - ALT0) / (ALT1 - ALT0)) * H;
const ATMOSPHERIC_FLOOR = 8, FRAMING_MARGIN = 2;

const band = key => {
  const p = D.horizon, n = p.length;
  return az => {
    az = ((az % 360) + 360) % 360;
    for (let i = 0; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n];
      const span = ((b.az - a.az + 360) % 360) || 360;
      const off = (az - a.az + 360) % 360;
      if (off <= span) return a[key] + (b[key] - a[key]) * off / span;
    }
    return p[0][key];
  };
};
const skyline = band('alt');
const local = band('nearAlt');
const gate = az => Math.max(ATMOSPHERIC_FLOOR, skyline(az) + FRAMING_MARGIN);

function glowAt(az, alt) {
  const A = D.skyglow.altitudes, Z = D.skyglow.azimuths, M = D.skyglow.mpsas;
  if (alt <= A[0]) alt = A[0];
  let i = A.length - 2;
  for (let k = 0; k < A.length - 1; k++) if (alt >= A[k] && alt <= A[k + 1]) { i = k; break; }
  const j = Math.min(A.length - 1, i + 1);
  const fa = A[j] === A[i] ? 0 : (Math.min(alt, A[j]) - A[i]) / (A[j] - A[i]);
  const az0 = ((az % 360) + 360) % 360;
  const zi = Math.floor(az0 / 5) % Z.length, zj = (zi + 1) % Z.length;
  const fz = (az0 % 5) / 5;
  const lo = M[i][zi] * (1 - fz) + M[i][zj] * fz;
  const hi = M[j][zi] * (1 - fz) + M[j][zj] * fz;
  return lo * (1 - fa) + hi * fa;
}

/** How dark the sky is right now, 0 = daylight, 1 = astronomical night. */
const darkness = sunAlt => Math.max(0, Math.min(1, (-sunAlt - 6) / 12));

function draw(idx) {
  const s = D.samples[idx];
  const dark = darkness(s.sunAlt);
  X.clearRect(0, 0, C.width, C.height);

  // Twilight wash: the sky itself, not a track. Daylight drowns everything below.
  X.fillStyle = 'rgb(' + Math.round(9 + 46 * (1 - dark)) + ',' + Math.round(9 + 58 * (1 - dark)) + ',' + Math.round(11 + 78 * (1 - dark)) + ')';
  X.fillRect(PAD.l, PAD.t, W, H);

  // Skyglow field, 4 px cells; fades with daylight because it is only visible at night.
  const STEP = 4;
  for (let x = PAD.l; x < PAD.l + W; x += STEP) {
    for (let y = PAD.t; y < PAD.t + H; y += STEP) {
      const az = AZ0 + ((x - PAD.l) / W) * (AZ1 - AZ0);
      const alt = ALT0 + (1 - (y - PAD.t) / H) * (ALT1 - ALT0);
      if (alt < 0) continue;
      const k = Math.max(0, Math.min(1, (22.0 - glowAt(az, alt)) / 4.5));
      X.fillStyle = 'rgba(236,154,60,' + (k * k * 0.85 * dark).toFixed(3) + ')';
      X.fillRect(x, y, STEP, STEP);
    }
  }

  // Grid.
  X.font = '12px ui-monospace, monospace';
  for (let alt = 0; alt <= 50; alt += 10) {
    X.strokeStyle = alt === 0 ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.09)';
    X.beginPath(); X.moveTo(PAD.l, py(alt)); X.lineTo(PAD.l + W, py(alt)); X.stroke();
    X.fillStyle = '#71717a'; X.fillText(alt + '°', 10, py(alt) + 4);
  }
  const NAMES = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW', 360: 'N' };
  for (const a of Object.keys(NAMES).map(Number)) {
    X.strokeStyle = a === 180 ? 'rgba(255,255,255,.26)' : 'rgba(255,255,255,.09)';
    X.beginPath(); X.moveTo(px(a), PAD.t); X.lineTo(px(a), PAD.t + H); X.stroke();
    X.fillStyle = '#a1a1aa'; X.fillText(NAMES[a], px(a) - 8, C.height - 11);
  }

  // The gate the core has to clear: max(atmospheric floor, skyline + framing margin).
  X.save(); X.setLineDash([5, 5]); X.strokeStyle = 'rgba(240,183,38,.55)'; X.lineWidth = 1.5;
  X.beginPath();
  for (let az = AZ0; az <= AZ1; az += 1) az === AZ0 ? X.moveTo(px(az), py(gate(az))) : X.lineTo(px(az), py(gate(az)));
  X.stroke(); X.restore();

  // Local ground first (advisory, lighter), skyline over it.
  const fill = (fn, colour, stroke) => {
    X.beginPath(); X.moveTo(px(AZ0), py(fn(AZ0)));
    for (let az = AZ0; az <= AZ1; az += 1) X.lineTo(px(az), py(fn(az)));
    X.lineTo(px(AZ1), C.height - PAD.b); X.lineTo(px(AZ0), C.height - PAD.b); X.closePath();
    X.fillStyle = colour; X.fill();
    if (stroke) { X.strokeStyle = stroke; X.lineWidth = 1.5; X.stroke(); }
  };
  fill(local, 'rgba(63,63,70,.55)', null);
  fill(skyline, '#2f2f35', '#71717a');

  // Tracks. The core is split: the part that clears the gate in a night where it is
  // actually dark is the only segment that means anything.
  const trackPoints = key => D.samples.map(q => ({ az: q[key + 'Az'], alt: q[key + 'Alt'], q }));
  const stroke = (pts, colour, width, alpha, pass) => {
    X.strokeStyle = colour; X.lineWidth = width; X.globalAlpha = alpha;
    X.beginPath(); let on = false;
    for (const p of pts) {
      const ok = p.alt >= ALT0 && (!pass || pass(p));
      if (!ok) { on = false; continue; }
      const x = px(p.az), y = py(p.alt);
      on ? X.lineTo(x, y) : X.moveTo(x, y);
      on = true;
    }
    X.stroke(); X.globalAlpha = 1;
  };
  stroke(trackPoints('sun'), '#f0b726', 1.5, .35);
  stroke(trackPoints('moon'), '#d4d4d8', 1.5, .4);
  stroke(trackPoints('core'), '#38bdf8', 2, .4);
  stroke(trackPoints('core'), '#43bf4d', 3.5, .95, p => p.q.sunAlt < -18 && p.alt >= gate(p.az));

  const dot = (az, alt, colour, r, label) => {
    if (alt < ALT0) return;
    X.beginPath(); X.arc(px(az), py(alt), r, 0, 7); X.fillStyle = colour; X.fill();
    X.strokeStyle = 'rgba(0,0,0,.55)'; X.lineWidth = 1; X.stroke();
    X.fillStyle = '#e4e4e7'; X.font = '12px system-ui'; X.fillText(label, px(az) + r + 5, py(alt) + 4);
  };
  dot(s.sunAz, s.sunAlt, '#f0b726', 7, 'Sun');
  dot(s.moonAz, s.moonAlt, '#d4d4d8', 5 + 5 * s.moonIllum, 'Moon ' + Math.round(s.moonIllum * 100) + '%');
  const ridge = skyline(s.coreAz), clr = s.coreAlt - ridge;
  dot(s.coreAz, s.coreAlt, s.sunAlt < -18 && s.coreAlt >= gate(s.coreAz) ? '#43bf4d' : '#38bdf8', 8, 'Core');

  // Precedence matters: below 0° the earth already did the work, and calling that
  // "behind terrain" would credit the feature with something it did not do.
  const moonState = s.moonAlt < 0 ? 'down' : s.moonAlt < skyline(s.moonAz) ? 'behind terrain' : 'up';
  document.getElementById('clock').textContent = new Date(s.t).toISOString().slice(11, 16) + ' UTC';
  document.getElementById('readout').innerHTML =
    'core <b class="num">' + s.coreAlt.toFixed(1) + '°</b> at az ' + s.coreAz.toFixed(0) +
    '° &nbsp;·&nbsp; skyline there <b class="num">' + ridge.toFixed(1) +
    '°</b> &nbsp;·&nbsp; clearance <b class="num" style="color:' + (clr > FRAMING_MARGIN ? '#43bf4d' : '#e76a6e') + '">' +
    (clr >= 0 ? '+' : '') + clr.toFixed(1) + '°</b> &nbsp;·&nbsp; skyglow behind it <b class="num">' +
    glowAt(s.coreAz, Math.max(5, s.coreAlt)).toFixed(2) + ' mpsas</b> &nbsp;·&nbsp; sun <b class="num">' +
    s.sunAlt.toFixed(1) + '°</b> &nbsp;·&nbsp; moon <b class="num">' + s.moonAlt.toFixed(1) + '°</b> ' +
    '<span style="color:' + (moonState === 'up' ? '#e76a6e' : '#43bf4d') + '">' + moonState + '</span>';
}

const slider = document.getElementById('t');
slider.max = D.samples.length - 1;
// Open on the moment the core is highest while it is astronomically dark — the shot.
let best = 0, bestAlt = -90;
D.samples.forEach((q, i) => { if (q.sunAlt < -18 && q.coreAlt > bestAlt) { bestAlt = q.coreAlt; best = i } });
slider.value = bestAlt > -90 ? best : Math.floor(D.samples.length * 0.45);
slider.oninput = () => draw(+slider.value);

const usable = D.samples.filter(q => q.sunAlt < -18 && q.coreAlt >= Math.max(ATMOSPHERIC_FLOOR, skyline(q.coreAz) + FRAMING_MARGIN)).length * ${STEP_MIN};
document.getElementById('title').textContent = D.site.name + ' — ' + D.date;
document.getElementById('meta').textContent =
  D.site.lat.toFixed(4) + ', ' + D.site.lon.toFixed(4) + ' · ' + D.site.elevationM.toFixed(0) + ' m · zenith ' +
  D.zenith.mpsas.toFixed(2) + ' mpsas (zone ' + D.zenith.zone + ') · dominant glow ' + D.skyglow.dominant.compass +
  ' · ' + Math.floor(usable / 60) + ' h ' + (usable % 60) + ' min above the gate tonight';
draw(+slider.value);
</script>`
}
