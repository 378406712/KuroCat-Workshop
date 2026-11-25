/* True Spatial Color-Block Vectorization Engine: Real Cat Photo -> Editable .kurocat v1 Bezier Regions */
(function (global) {
  'use strict';

  const { clamp, round2, rgbToHex, makeTabbyForeheadMarks, makeTailRingMarks } = global.KuroSpec;

  // --- Color Space Helpers (sRGB <-> CIE Lab <-> HSL) ---

  function srgbToLinear(c) {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  function rgbToLab(r, g, b) {
    const rl = srgbToLinear(r), gl = srgbToLinear(g), bl = srgbToLinear(b);
    const x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047;
    const y = (rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750) / 1.00000;
    const z = (rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function labDist(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }

  // Shadow-tolerant perceptual distance for coat clustering:
  // Keeps black/white/orange/grey sharply separated, while softening true same-hue shading.
  function coatLabDist(a, b) {
    const dL = a[0] - b[0];
    const da = a[1] - b[1];
    const db = a[2] - b[2];
    const chromaA = Math.hypot(a[1], a[2]), chromaB = Math.hypot(b[1], b[2]);
    let lWeight = 1.0;
    if (chromaA > 14 && chromaB > 14) {
      const cosHue = (a[1] * b[1] + a[2] * b[2]) / (chromaA * chromaB);
      const dC = chromaA - chromaB;
      const ratioA = chromaA / Math.max(a[0], 18);
      const ratioB = chromaB / Math.max(b[0], 18);
      // Only compress lightness/chroma scaling for true same-pigment shading (L and chroma move together at similar C/L ratio);
      // never merge white/cream with pigmented fur where L rises while chroma drops.
      if (cosHue > 0.92 && Math.min(a[0], b[0]) > 22 && dL * dC >= 0 && Math.abs(ratioA - ratioB) < 0.12) {
        lWeight = 0.62;
        const cDiff = dC * 0.62;
        const perp2 = Math.max(0, (da * da + db * db) - dC * dC);
        return Math.hypot(dL * lWeight, cDiff, Math.sqrt(perp2) * 1.35);
      }
      if (cosHue > 0.90 && Math.min(a[0], b[0]) > 22 && dL * dC >= 0 && Math.abs(ratioA - ratioB) < 0.22) {
        lWeight = 0.65;
      }
    } else if (Math.min(a[0], b[0]) > 68 && Math.max(chromaA, chromaB) < 14) {
      // Soften lit-white vs shaded-white delta without merging white into mid-grey
      lWeight = 0.58;
    } else if (Math.max(a[0], b[0]) < 34 && Math.max(chromaA, chromaB) < 12) {
      // Keep deep black fur with indoor sheen from splitting into fake grey patches
      lWeight = 0.65;
    }
    return Math.hypot(dL * lWeight, da * 1.15, db * 1.15);
  }

  function labToRgb(lab) {
    const fy = (lab[0] + 16) / 116, fx = fy + lab[1] / 500, fz = fy - lab[2] / 200;
    const f = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
    const X = 0.95047 * f(fx), Y = f(fy), Z = 1.08883 * f(fz);
    const lin = [
      3.2406 * X - 1.5372 * Y - 0.4986 * Z,
      -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
      0.0557 * X - 0.2040 * Y + 1.0570 * Z
    ];
    return lin.map((c) => Math.round(clamp(c <= 0.0031308 ? 12.92 * c : 1.055 * (c ** (1 / 2.4)) - 0.055, 0, 1) * 255));
  }

  // Bounded ambient color-cast estimation from bright low-to-moderate chroma pixels.
  // Safe for monochrome orange/ginger cats (only fires when near-neutral bright regions share a cast).
  function estimateAmbientCast(pixels, w, h) {
    const cands = [];
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const i = (y * w + x) * 4;
        if (pixels[i + 3] < 128) continue;
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        if (Math.max(r, g, b) > 252) continue;
        const lab = rgbToLab(r, g, b);
        const chroma = Math.hypot(lab[1], lab[2]);
        if (lab[0] > 64 && lab[0] < 96 && chroma < 26 && Math.abs(lab[1]) < 11) {
          cands.push({ a: lab[1], b: lab[2], c: chroma });
        }
      }
    }
    if (cands.length < 40) return [0, 0];
    cands.sort((x, y) => x.c - y.c);
    const take = Math.max(20, Math.floor(cands.length * 0.40));
    const sub = cands.slice(0, take);
    const as = sub.map((p) => p.a).sort((x, y) => x - y);
    const bs = sub.map((p) => p.b).sort((x, y) => x - y);
    const medA = as[Math.floor(as.length * 0.5)];
    const medB = bs[Math.floor(bs.length * 0.5)];
    if (Math.hypot(medA, medB) < 6) return [0, 0];
    return [clamp(medA * 0.50, -4.5, 4.5), clamp(medB * 0.50, -9.5, 9.5)];
  }

  function shiftLabCast(lab, cast) {
    if (!cast || (cast[0] === 0 && cast[1] === 0)) return lab;
    const scale = clamp((lab[0] - 12) / 48, 0, 1);
    return [lab[0], lab[1] - cast[0] * scale, lab[2] - cast[1] * scale];
  }

  function rgbToHsl(r, g, b) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
      else if (max === gn) h = ((bn - rn) / d + 2) / 6;
      else h = ((rn - gn) / d + 4) / 6;
    }
    return [h * 360, s, l];
  }

  function hslToRgb(h, s, l) {
    const hn = ((h % 360) + 360) % 360 / 360;
    if (s === 0) {
      const v = Math.round(clamp(l, 0, 1) * 255);
      return [v, v, v];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (t) => {
      let tt = t;
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1 / 6) return p + (q - p) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
      return p;
    };
    return [
      Math.round(clamp(hue2rgb(hn + 1 / 3), 0, 1) * 255),
      Math.round(clamp(hue2rgb(hn), 0, 1) * 255),
      Math.round(clamp(hue2rgb(hn - 1 / 3), 0, 1) * 255)
    ];
  }

  function adjustColor(rgb, toneMode) {
    const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    if (toneMode === 'faithful') return rgb.map((v) => clamp(Math.round(v), 0, 255));
    if (toneMode === 'vivid') {
      const ns = s < 0.08 ? s : clamp(s * 1.24 + 0.04, 0, 0.85);
      const nl = l < 0.16 ? clamp(l * 1.12, 0.08, 0.22) : clamp(l * 1.07 + 0.03, 0.14, 0.96);
      return hslToRgb(h, ns, nl);
    }
    const ns = s < 0.07 ? s * 0.85 : clamp(s * 1.08 + 0.015, 0, 0.78);
    const nl = l < 0.18 ? clamp(l * 1.06 + 0.01, 0.08, 0.24) : clamp(l * 1.03 + 0.015, 0.12, 0.96);
    return hslToRgb(h, ns, nl);
  }

  function shadeRgb(rgb, factor) {
    const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    return hslToRgb(h, clamp(s * 1.05, 0, 1), clamp(l * factor, 0.05, 0.97));
  }

  function mixRgb(a, b, t) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t)
    ];
  }

  // Edge-preserving bilateral filter on small grid so fur texture merges into clean color blocks
  function bilateralSmooth(src, w, h, radius, sigmaColor) {
    const dst = new Uint8ClampedArray(src.length);
    const inv2Sc = 1 / (2 * sigmaColor * sigmaColor);
    const inv2Ss = 1 / (2 * radius * radius);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ci = (y * w + x) * 4;
        const cr = src[ci], cg = src[ci + 1], cb = src[ci + 2];
        let sr = 0, sg = 0, sb = 0, sw = 0;
        const y0 = Math.max(0, y - radius), y1 = Math.min(h - 1, y + radius);
        const x0 = Math.max(0, x - radius), x1 = Math.min(w - 1, x + radius);
        for (let ny = y0; ny <= y1; ny++) {
          for (let nx = x0; nx <= x1; nx++) {
            const ni = (ny * w + nx) * 4;
            const nr = src[ni], ng = src[ni + 1], nb = src[ni + 2];
            const dr = nr - cr, dg = ng - cg, db = nb - cb;
            const cDist2 = dr * dr + dg * dg + db * db;
            const sDist2 = (nx - x) * (nx - x) + (ny - y) * (ny - y);
            const wt = Math.exp(-cDist2 * inv2Sc - sDist2 * inv2Ss);
            sr += nr * wt; sg += ng * wt; sb += nb * wt; sw += wt;
          }
        }
        dst[ci] = Math.round(sr / sw);
        dst[ci + 1] = Math.round(sg / sw);
        dst[ci + 2] = Math.round(sb / sw);
        dst[ci + 3] = 255;
      }
    }
    return dst;
  }

  // Deterministic K-Means++ in CIE Lab space with optional over-clustering & agglomerative merging
  function kMeansLab(samples, k, mergeDeltaE, useCoatDist, opts) {
    if (samples.length === 0) return [];
    const distFn = useCoatDist ? coatLabDist : labDist;
    const targetCount = opts && opts.targetCount ? opts.targetCount : null;
    const overK = targetCount ? Math.max(k, opts.overClusterK || k + 4) : k;
    const kk = Math.min(overK, samples.length);
    const centroids = [samples[Math.floor(samples.length * 0.5)].lab.slice()];

    while (centroids.length < kk) {
      let bestIdx = 0, bestScore = -1;
      for (let i = 0; i < samples.length; i++) {
        let minD = Infinity;
        for (const c of centroids) {
          const d = distFn(samples[i].lab, c);
          if (d < minD) minD = d;
        }
        const score = minD * samples[i].w;
        if (score > bestScore) { bestScore = score; bestIdx = i; }
      }
      centroids.push(samples[bestIdx].lab.slice());
    }

    const assign = new Int32Array(samples.length);
    for (let iter = 0; iter < 14; iter++) {
      const sums = Array.from({ length: kk }, () => ({ r: 0, g: 0, b: 0, L: 0, A: 0, B: 0, w: 0 }));
      for (let i = 0; i < samples.length; i++) {
        let best = 0, bestD = Infinity;
        for (let c = 0; c < kk; c++) {
          const d = distFn(samples[i].lab, centroids[c]);
          if (d < bestD) { bestD = d; best = c; }
        }
        assign[i] = best;
        const s = samples[i], acc = sums[best];
        acc.r += s.r * s.w; acc.g += s.g * s.w; acc.b += s.b * s.w;
        acc.L += s.lab[0] * s.w; acc.A += s.lab[1] * s.w; acc.B += s.lab[2] * s.w;
        acc.w += s.w;
      }
      for (let c = 0; c < kk; c++) {
        if (sums[c].w > 0) {
          centroids[c] = [sums[c].L / sums[c].w, sums[c].A / sums[c].w, sums[c].B / sums[c].w];
        }
      }
    }

    const clusters = Array.from({ length: kk }, () => ({ r: 0, g: 0, b: 0, L: 0, A: 0, B: 0, w: 0 }));
    let totalW = 0;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i], cl = clusters[assign[i]];
      cl.r += s.r * s.w; cl.g += s.g * s.w; cl.b += s.b * s.w;
      cl.L += s.lab[0] * s.w; cl.A += s.lab[1] * s.w; cl.B += s.lab[2] * s.w;
      cl.w += s.w;
      totalW += s.w;
    }

    const merged = clusters
      .filter((c) => c.w > 0)
      .map((c) => {
        const rgb = [c.r / c.w, c.g / c.w, c.b / c.w];
        const lab = [c.L / c.w, c.A / c.w, c.B / c.w];
        const hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
        return { rgb, lab, hsl, chroma: Math.hypot(lab[1], lab[2]), ratio: c.w / Math.max(1e-6, totalW), w: c.w };
      })
      .sort((a, b) => b.ratio - a.ratio);

    const mergePair = (i, j) => {
      const a = merged[i], b = merged[j], tw = a.w + b.w;
      const rgb = [
        (a.rgb[0] * a.w + b.rgb[0] * b.w) / tw,
        (a.rgb[1] * a.w + b.rgb[1] * b.w) / tw,
        (a.rgb[2] * a.w + b.rgb[2] * b.w) / tw
      ];
      const lab = [
        (a.lab[0] * a.w + b.lab[0] * b.w) / tw,
        (a.lab[1] * a.w + b.lab[1] * b.w) / tw,
        (a.lab[2] * a.w + b.lab[2] * b.w) / tw
      ];
      merged[i] = {
        rgb, lab, hsl: rgbToHsl(rgb[0], rgb[1], rgb[2]),
        chroma: Math.hypot(lab[1], lab[2]), ratio: a.ratio + b.ratio, w: tw
      };
      merged.splice(j, 1);
    };

    // Absorb tiny 1-pixel outlier seeds before perceptual merging
    if (targetCount) {
      while (merged.length > 1) {
        let minIdx = -1;
        for (let i = 0; i < merged.length; i++) {
          if (merged[i].ratio < 0.008 && (minIdx < 0 || merged[i].ratio < merged[minIdx].ratio)) minIdx = i;
        }
        if (minIdx < 0) break;
        let bestTarget = minIdx === 0 ? 1 : 0, bestD = Infinity;
        for (let j = 0; j < merged.length; j++) {
          if (j === minIdx) continue;
          const d = distFn(merged[minIdx].lab, merged[j].lab);
          if (d < bestD) { bestD = d; bestTarget = j; }
        }
        const lo = Math.min(minIdx, bestTarget), hi = Math.max(minIdx, bestTarget);
        mergePair(lo, hi);
      }
    }

    // Agglomerative nearest-pair merge (order-independent)
    const thresh = mergeDeltaE === undefined ? 15 : mergeDeltaE;
    while (merged.length > 1) {
      let bi = -1, bj = -1, bestCost = Infinity, bestDist = Infinity;
      for (let i = 0; i < merged.length; i++) {
        for (let j = i + 1; j < merged.length; j++) {
          const d = distFn(merged[i].lab, merged[j].lab);
          if (d < bestDist) bestDist = d;
          const cost = d < thresh
            ? d
            : d * (1 + Math.min(merged[i].ratio, merged[j].ratio) * 2.2);
          if (cost < bestCost) { bestCost = cost; bi = i; bj = j; }
        }
      }
      if (bestDist < thresh || (targetCount && merged.length > targetCount)) {
        mergePair(bi, bj);
      } else {
        break;
      }
    }
    return merged.sort((a, b) => b.ratio - a.ratio);
  }

  // --- Binary Mask Morphology + Marching Squares Contour Tracing + Smooth Bezier Fitting ---

  function morphPass(mask, w, h, dilate) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let hit = dilate ? 0 : 1;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) { if (!dilate) hit = 0; continue; }
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= w) { if (!dilate) hit = 0; continue; }
            const v = mask[ny * w + nx];
            if (dilate && v) hit = 1;
            if (!dilate && !v) hit = 0;
          }
        }
        out[y * w + x] = hit;
      }
    }
    return out;
  }

  function cleanBinaryMask(mask, w, h) {
    // Closing (3x3 dilate then erode) bridges 1px gaps without erasing thin 2px blazes or stripes
    const closed = morphPass(morphPass(mask, w, h, true), w, h, false);
    // Light majority pass removes isolated 1px speckles while preserving narrow strips
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        let nb = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if ((dx !== 0 || dy !== 0) && xx >= 0 && xx < w && closed[yy * w + xx]) nb++;
          }
        }
        out[idx] = closed[idx] ? (nb >= 2 ? 1 : 0) : (nb >= 7 ? 1 : 0);
      }
    }
    return out;
  }

  function findConnectedComponents(mask, w, h, minPixels) {
    const visited = new Uint8Array(w * h);
    const comps = [];
    const queue = new Int32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (!mask[i] || visited[i]) continue;
      let qh = 0, qt = 0;
      queue[qt++] = i;
      visited[i] = 1;
      const pixels = [];
      while (qh < qt) {
        const cur = queue[qh++];
        pixels.push(cur);
        const cx = cur % w, cy = (cur - cx) / w;
        const nbs = [
          cx > 0 ? cur - 1 : -1,
          cx + 1 < w ? cur + 1 : -1,
          cy > 0 ? cur - w : -1,
          cy + 1 < h ? cur + w : -1
        ];
        for (const nb of nbs) {
          if (nb >= 0 && mask[nb] && !visited[nb]) {
            visited[nb] = 1;
            queue[qt++] = nb;
          }
        }
      }
      if (pixels.length >= minPixels) {
        const compMask = new Uint8Array(w * h);
        for (const p of pixels) compMask[p] = 1;
        comps.push({ mask: compMask, area: pixels.length });
      }
    }
    return comps.sort((a, b) => b.area - a.area);
  }

  // Marching Squares contour tracer on a padded binary mask -> returns longest closed outer loop
  function traceContourMarchingSquares(compMask, w, h) {
    const pw = w + 2, ph = h + 2;
    const grid = new Uint8Array(pw * ph);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        grid[(y + 1) * pw + (x + 1)] = compMask[y * w + x];
      }
    }

    // Build directed half-edges along marching squares cell boundaries (counter-clockwise around filled pixels)
    // Edge midpoints keyed by integer coordinates (2*x, 2*y) to avoid float mismatch
    const nextEdge = new Map();
    const key = (ix, iy) => ix * 4096 + iy;

    // 16 cases for (tl, tr, br, bl)
    // Edges: top=(2x+1, 2y), right=(2x+2, 2y+1), bottom=(2x+1, 2y+2), left=(2x, 2y+1)
    const addSeg = (ax, ay, bx, by) => {
      const k = key(ax, ay);
      if (!nextEdge.has(k)) nextEdge.set(k, []);
      nextEdge.get(k).push([bx, by]);
    };

    for (let y = 0; y < ph - 1; y++) {
      for (let x = 0; x < pw - 1; x++) {
        const tl = grid[y * pw + x];
        const tr = grid[y * pw + x + 1];
        const br = grid[(y + 1) * pw + x + 1];
        const bl = grid[(y + 1) * pw + x];
        const code = (tl << 3) | (tr << 2) | (br << 1) | bl;
        if (code === 0 || code === 15) continue;

        const T = [2 * x + 1, 2 * y];
        const R = [2 * x + 2, 2 * y + 1];
        const B = [2 * x + 1, 2 * y + 2];
        const L = [2 * x, 2 * y + 1];

        switch (code) {
          case 1: addSeg(L[0], L[1], B[0], B[1]); break;
          case 2: addSeg(B[0], B[1], R[0], R[1]); break;
          case 3: addSeg(L[0], L[1], R[0], R[1]); break;
          case 4: addSeg(R[0], R[1], T[0], T[1]); break;
          case 5: addSeg(L[0], L[1], T[0], T[1]); addSeg(R[0], R[1], B[0], B[1]); break;
          case 6: addSeg(B[0], B[1], T[0], T[1]); break;
          case 7: addSeg(L[0], L[1], T[0], T[1]); break;
          case 8: addSeg(T[0], T[1], L[0], L[1]); break;
          case 9: addSeg(T[0], T[1], B[0], B[1]); break;
          case 10: addSeg(T[0], T[1], R[0], R[1]); addSeg(B[0], B[1], L[0], L[1]); break;
          case 11: addSeg(T[0], T[1], R[0], R[1]); break;
          case 12: addSeg(R[0], R[1], L[0], L[1]); break;
          case 13: addSeg(R[0], R[1], B[0], B[1]); break;
          case 14: addSeg(B[0], B[1], L[0], L[1]); break;
        }
      }
    }

    const used = new Set();
    let bestLoop = [];
    for (const [startKey, targets] of nextEdge.entries()) {
      for (const t of targets) {
        const eId = `${startKey}->${key(t[0], t[1])}`;
        if (used.has(eId)) continue;
        const loop = [];
        let curKey = startKey;
        let safety = 0;
        while (safety++ < 8000) {
          const outs = nextEdge.get(curKey);
          if (!outs || outs.length === 0) break;
          let picked = null;
          for (const cand of outs) {
            const id = `${curKey}->${key(cand[0], cand[1])}`;
            if (!used.has(id)) { picked = cand; used.add(id); break; }
          }
          if (!picked) break;
          // Convert from padded 2x grid coords back to original unpadded float pixel coords
          loop.push({ x: picked[0] * 0.5 - 1, y: picked[1] * 0.5 - 1 });
          curKey = key(picked[0], picked[1]);
          if (curKey === startKey) break;
        }
        if (loop.length > bestLoop.length) bestLoop = loop;
      }
    }
    return bestLoop;
  }

  // Chaikin corner-cutting smooth pass on closed polygon
  function smoothPolygon(pts, iterations) {
    let cur = pts;
    for (let it = 0; it < iterations; it++) {
      const next = [];
      const n = cur.length;
      for (let i = 0; i < n; i++) {
        const a = cur[i], b = cur[(i + 1) % n];
        next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
        next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
      }
      cur = next;
    }
    return cur;
  }

  // Ramer-Douglas-Peucker simplification on closed loop
  function simplifyClosedLoop(pts, eps) {
    if (pts.length <= 5) return pts;
    // Split loop at the two most distant points so RDP treats closure symmetrically
    let aIdx = 0, bIdx = Math.floor(pts.length / 2), maxD = -1;
    const p0 = pts[0];
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - p0.x, pts[i].y - p0.y);
      if (d > maxD) { maxD = d; bIdx = i; }
    }

    const rdp = (arr, tol) => {
      if (arr.length <= 2) return arr;
      const first = arr[0], last = arr[arr.length - 1];
      const dx = last.x - first.x, dy = last.y - first.y;
      const len = Math.hypot(dx, dy) || 1;
      let idx = 0, best = -1;
      for (let i = 1; i < arr.length - 1; i++) {
        const dist = Math.abs(dy * arr[i].x - dx * arr[i].y + last.x * first.y - last.y * first.x) / len;
        if (dist > best) { best = dist; idx = i; }
      }
      if (best > tol) {
        const left = rdp(arr.slice(0, idx + 1), tol);
        const right = rdp(arr.slice(idx), tol);
        return left.slice(0, -1).concat(right);
      }
      return [first, last];
    };

    const half1 = pts.slice(aIdx, bIdx + 1);
    const half2 = pts.slice(bIdx).concat([pts[0]]);
    const s1 = rdp(half1, eps);
    const s2 = rdp(half2, eps);
    const combined = s1.slice(0, -1).concat(s2.slice(0, -1));
    return combined.length >= 3 ? combined : pts.filter((_, idx) => idx % Math.max(1, Math.floor(pts.length / 6)) === 0);
  }

  // Convert closed polyline into smooth cubic Bezier anchors for .kurocat regions
  function polyToBezierAnchors(pts, tension) {
    const n = pts.length;
    const k = (tension === undefined ? 0.24 : tension);
    const anchors = [];
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n];
      const curr = pts[i];
      const next = pts[(i + 1) % n];
      const tx = (next.x - prev.x) * k;
      const ty = (next.y - prev.y) * k;
      anchors.push({
        x: round2(clamp(curr.x, -400, 400)),
        y: round2(clamp(curr.y, -400, 400)),
        inX: round2(clamp(curr.x - tx, -400, 400)),
        inY: round2(clamp(curr.y - ty, -400, 400)),
        outX: round2(clamp(curr.x + tx, -400, 400)),
        outY: round2(clamp(curr.y + ty, -400, 400))
      });
    }
    return anchors;
  }

  // --- Feature Detection Helpers ---

  function detectEyeIris(pixels, w, h, furLabs, cast) {
    const bands = [
      [0.24, 0.24, 0.44, 0.43],
      [0.56, 0.24, 0.76, 0.43]
    ];
    const candidates = [];
    for (const [x0, y0, x1, y1] of bands) {
      const ix0 = Math.floor(x0 * w), ix1 = Math.ceil(x1 * w);
      const iy0 = Math.floor(y0 * h), iy1 = Math.ceil(y1 * h);
      for (let y = iy0; y < iy1; y++) {
        for (let x = ix0; x < ix1; x++) {
          const idx = (y * w + x) * 4;
          const r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2];
          const rawLab = rgbToLab(r, g, b);
          const lab = shiftLabCast(rawLab, cast);
          const rgb = cast && (cast[0] !== 0 || cast[1] !== 0) ? labToRgb(lab) : [r, g, b];
          const [hue, sat, lig] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
          if (hue < 24 || hue > 238) continue;
          if (lig < 0.22 || lig > 0.88 || sat < 0.16) continue;
          let minFur = 999;
          for (const fl of furLabs) {
            const d = labDist(lab, fl);
            if (d < minFur) minFur = d;
          }
          const isBlueOrGreen = hue >= 70 && hue <= 230;
          if (minFur < 14 && !isBlueOrGreen) continue;
          const score = (sat * 1.4 + (isBlueOrGreen ? 0.55 : 0.15)) * (1 - Math.abs(lig - 0.54));
          candidates.push({ r: rgb[0], g: rgb[1], b: rgb[2], hue, score });
        }
      }
    }
    if (candidates.length < 10) return null;
    const bins = Array.from({ length: 18 }, () => ({ r: 0, g: 0, b: 0, w: 0, count: 0 }));
    for (const c of candidates) {
      const bi = clamp(Math.floor(c.hue / 20), 0, 17);
      bins[bi].r += c.r * c.score;
      bins[bi].g += c.g * c.score;
      bins[bi].b += c.b * c.score;
      bins[bi].w += c.score;
      bins[bi].count++;
    }
    bins.sort((a, b) => b.w - a.w);
    const best = bins[0];
    if (!best || best.count < 8) return null;
    const rawRgb = [best.r / best.w, best.g / best.w, best.b / best.w];
    const [ih, is, il] = rgbToHsl(rawRgb[0], rawRgb[1], rawRgb[2]);
    if (ih >= 180 && ih <= 238) {
      return hslToRgb(clamp(ih, 196, 212), clamp(is * 0.95 + 0.15, 0.42, 0.72), clamp(il * 0.95 + 0.18, 0.68, 0.84));
    }
    if (ih >= 75 && ih < 180) {
      return hslToRgb(clamp(ih, 74, 145), clamp(is * 1.15 + 0.12, 0.42, 0.76), clamp(il * 1.05 + 0.08, 0.52, 0.70));
    }
    return hslToRgb(clamp(ih, 34, 58), clamp(is * 1.15 + 0.14, 0.52, 0.80), clamp(il * 1.08 + 0.08, 0.52, 0.68));
  }

  // Lab -> hex (D65), only for diagnostics
  function labToHexApprox(lab) {
    const g = labToRgb(lab);
    return '#' + g.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  function avgBoxRgb(pixels, w, h, x0, y0, x1, y1, bgLabs, fgMask, fgW, fgH, cast) {
    const ix0 = clamp(Math.floor(x0 * w), 0, w - 1);
    const ix1 = clamp(Math.ceil(x1 * w), 1, w);
    const iy0 = clamp(Math.floor(y0 * h), 0, h - 1);
    const iy1 = clamp(Math.ceil(y1 * h), 1, h);
    let sr = 0, sg = 0, sb = 0, sw = 0, edgeSum = 0, edgeCnt = 0;
    for (let y = iy0; y < iy1; y++) {
      const fy = fgMask ? clamp(Math.floor((y + 0.5) / h * fgH), 0, fgH - 1) : 0;
      for (let x = ix0; x < ix1; x++) {
        const i = (y * w + x) * 4;
        if (pixels[i + 3] < 128) continue;
        if (fgMask) {
          const fx = clamp(Math.floor((x + 0.5) / w * fgW), 0, fgW - 1);
          if (!fgMask[fy * fgW + fx]) continue;
        }
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        const lab = shiftLabCast(rgbToLab(r, g, b), cast);
        let wt = 1.0;
        if (!fgMask && bgLabs && bgLabs.length) {
          let minBg = 999;
          for (const bg of bgLabs) {
            const d = labDist(lab, bg);
            if (d < minBg) minBg = d;
          }
          wt = minBg < 10 ? 0.1 : minBg < 17 ? 0.5 : 1.0;
        }
        sr += r * wt; sg += g * wt; sb += b * wt; sw += wt;
        if (x + 2 < ix1) {
          const i2 = (y * w + x + 2) * 4;
          const l1 = 0.299 * r + 0.587 * g + 0.114 * b;
          const l2 = 0.299 * pixels[i2] + 0.587 * pixels[i2 + 1] + 0.114 * pixels[i2 + 2];
          edgeSum += Math.abs(l1 - l2) * wt;
          edgeCnt += wt;
        }
      }
    }
    const rawRgb = sw > 0 ? [sr / sw, sg / sw, sb / sw] : [128, 128, 128];
    const lab = shiftLabCast(rgbToLab(rawRgb[0], rawRgb[1], rawRgb[2]), cast);
    const rgb = cast && (cast[0] !== 0 || cast[1] !== 0) ? labToRgb(lab) : rawRgb;
    const boxCount = Math.max(1, (ix1 - ix0) * (iy1 - iy0));
    return { rgb, rawRgb, lab, edgeEnergy: edgeCnt > 0 ? edgeSum / edgeCnt : 0,
             catShare: sw / boxCount };
  }

  // Ear sampler: filters out background and separates pink inner-ear skin from outer ear fur
  function sampleEarZone(pixels, w, h, x0, y0, x1, y1, bgLabs, cast) {
    const ix0 = clamp(Math.floor(x0 * w), 0, w - 1);
    const ix1 = clamp(Math.ceil(x1 * w), 1, w);
    const iy0 = clamp(Math.floor(y0 * h), 0, h - 1);
    const iy1 = clamp(Math.ceil(y1 * h), 1, h);
    const boxCount = Math.max(1, (ix1 - ix0) * (iy1 - iy0));
    const furSamples = [];
    const allFgSamples = [];
    for (let y = iy0; y < iy1; y++) {
      for (let x = ix0; x < ix1; x++) {
        const i = (y * w + x) * 4;
        if (pixels[i + 3] < 128) continue;
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        const lab = shiftLabCast(rgbToLab(r, g, b), cast);
        let minBg = 999;
        for (const bg of bgLabs) {
          const d = labDist(lab, bg);
          if (d < minBg) minBg = d;
        }
        if (minBg < 12) continue;
        const wt = minBg < 17 ? 0.45 : 1.0;
        const corrRgb = cast && (cast[0] !== 0 || cast[1] !== 0) ? labToRgb(lab) : [r, g, b];
        const sample = { r: corrRgb[0], g: corrRgb[1], b: corrRgb[2], rawR: r, rawG: g, rawB: b, lab, w: wt };
        allFgSamples.push(sample);
        const [eh, es, el] = rgbToHsl(corrRgb[0], corrRgb[1], corrRgb[2]);
        const isPinkSkin = (eh <= 26 || eh >= 330) && es > 0.16 && el > 0.46;
        if (!isPinkSkin) furSamples.push(sample);
      }
    }
    const chosen = furSamples.length >= 16 ? furSamples : allFgSamples;
    const catShare = allFgSamples.reduce((a, s) => a + s.w, 0) / boxCount;
    if (!chosen.length) {
      return { rgb: [128, 128, 128], rawRgb: [128, 128, 128], lab: [54, 0, 0], catShare: 0 };
    }
    const cls = kMeansLab(chosen, 2, 13, false);
    const dom = cls[0];
    const rgb = dom.rgb;
    const rawRgb = cast && (cast[0] !== 0 || cast[1] !== 0)
      ? labToRgb([dom.lab[0], dom.lab[1] + cast[0] * clamp((dom.lab[0] - 12) / 48, 0, 1), dom.lab[2] + cast[1] * clamp((dom.lab[0] - 12) / 48, 0, 1)])
      : rgb;
    return { rgb, rawRgb, lab: dom.lab, catShare };
  }

  // Band-pass forehead stripe detector: distinguishes periodic tabby M-stripes from JPG grain or a single bicolor split
  function detectForeheadTabby(pixels, w, h, bgLabs, fgMask, fgW, fgH, cast) {
    const ix0 = clamp(Math.floor(0.33 * w), 0, w - 1);
    const ix1 = clamp(Math.ceil(0.67 * w), 1, w);
    const iy0 = clamp(Math.floor(0.13 * h), 0, h - 1);
    const iy1 = clamp(Math.ceil(0.30 * h), 1, h);
    const bw = ix1 - ix0, bh = iy1 - iy0;
    if (bw < 12 || bh < 8) return { isTabby: false, stripeRgb: null, meanLum: 50, oscRatio: 0 };

    const L = new Float32Array(bw * bh);
    const valid = new Uint8Array(bw * bh);
    let lSum = 0, lCnt = 0;
    for (let dy = 0; dy < bh; dy++) {
      const y = iy0 + dy;
      const fy = fgMask ? clamp(Math.floor((y + 0.5) / h * fgH), 0, fgH - 1) : 0;
      for (let dx = 0; dx < bw; dx++) {
        const x = ix0 + dx;
        const i = (y * w + x) * 4;
        if (pixels[i + 3] < 128) continue;
        const fx = fgMask ? clamp(Math.floor((x + 0.5) / w * fgW), 0, fgW - 1) : 0;
        const inFg = fgMask ? !!fgMask[fy * fgW + fx] : true;
        const lab = shiftLabCast(rgbToLab(pixels[i], pixels[i + 1], pixels[i + 2]), cast);
        let ok = inFg;
        if (!fgMask && bgLabs && bgLabs.length) {
          let minBg = 999;
          for (const bg of bgLabs) { const d = labDist(lab, bg); if (d < minBg) minBg = d; }
          ok = minBg >= 12;
        }
        if (ok) {
          valid[dy * bw + dx] = 1;
          L[dy * bw + dx] = lab[0];
          lSum += lab[0];
          lCnt++;
        }
      }
    }
    const meanLum = lCnt > 0 ? lSum / lCnt : 50;
    if (lCnt < bw * bh * 0.40 || meanLum < 18 || meanLum > 84) {
      return { isTabby: false, stripeRgb: null, meanLum, oscRatio: 0 };
    }

    // 3x3 smoothed luminance then horizontal 3px vs 9px band-pass
    const sm = new Float32Array(bw * bh);
    for (let dy = 0; dy < bh; dy++) {
      for (let dx = 0; dx < bw; dx++) {
        if (!valid[dy * bw + dx]) continue;
        let s = 0, c = 0;
        for (let oy = -1; oy <= 1; oy++) {
          const yy = dy + oy;
          if (yy < 0 || yy >= bh) continue;
          for (let ox = -1; ox <= 1; ox++) {
            const xx = dx + ox;
            if (xx >= 0 && xx < bw && valid[yy * bw + xx]) { s += L[yy * bw + xx]; c++; }
          }
        }
        sm[dy * bw + dx] = c > 0 ? s / c : meanLum;
      }
    }

    let oscRows = 0, testedRows = 0;
    let sr = 0, sg = 0, sb = 0, sc = 0;
    for (let dy = 2; dy < bh - 2; dy++) {
      let prevSign = 0, flips = 0, minDiff = 999, maxDiff = -999, rowValid = 0;
      for (let dx = 4; dx < bw - 4; dx++) {
        if (!valid[dy * bw + dx]) continue;
        let s3 = 0, c3 = 0, s9 = 0, c9 = 0;
        for (let ox = -4; ox <= 4; ox++) {
          const idx = dy * bw + dx + ox;
          if (!valid[idx]) continue;
          const v = sm[idx];
          s9 += v; c9++;
          if (Math.abs(ox) <= 1) { s3 += v; c3++; }
        }
        if (c3 < 2 || c9 < 5) continue;
        rowValid++;
        const diff = s3 / c3 - s9 / c9;
        if (diff < minDiff) minDiff = diff;
        if (diff > maxDiff) maxDiff = diff;
        const sign = diff > 1.8 ? 1 : (diff < -1.8 ? -1 : 0);
        if (sign !== 0) {
          if (prevSign !== 0 && sign !== prevSign) flips++;
          prevSign = sign;
        }
        if (diff < -2.2) {
          const pxIdx = ((iy0 + dy) * w + (ix0 + dx)) * 4;
          sr += pixels[pxIdx]; sg += pixels[pxIdx + 1]; sb += pixels[pxIdx + 2]; sc++;
        }
      }
      if (rowValid >= 10) {
        testedRows++;
        if (flips >= 3 && (maxDiff - minDiff) >= 4.5) oscRows++;
      }
    }
    const oscRatio = testedRows > 0 ? oscRows / testedRows : 0;
    const isTabby = testedRows >= 4 && oscRows >= 4 && oscRatio >= 0.28;
    const stripeRgb = sc >= 8 ? [sr / sc, sg / sc, sb / sc] : null;
    return { isTabby, stripeRgb, meanLum, oscRatio };
  }

  /**
   * Direct Spatial Color-Block Vectorization:
   * Extracts actual spatial color blocks from the photo and fits smooth .kurocat Bezier regions!
   *
   * Options:
   * - colorCount: 2..5 (number of coat colors to quantize, default 3)
   * - smoothness: 0.4..1.6 (contour simplification & curve smoothness, default 1.0)
   * - tone: 'balanced' | 'vivid' | 'faithful'
   * - addTabby: 'auto' | 'on' | 'off'
   * - softColorpoint: boolean (use soft gradient mask when colorpoint face detected)
   * - includeNose, includePads, includeIris: boolean
   */
  function detectDrawingCrop(imgSource) {
    const w = 96, h = 96;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imgSource, 0, 0, w, h);
    const pix = ctx.getImageData(0, 0, w, h).data;

    let transCount = 0;
    for (let i = 3; i < pix.length; i += 4) if (pix[i] < 128) transCount++;
    const hasAlpha = transCount > w * h * 0.04;

    let bgLab = null;
    if (!hasAlpha) {
      const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
      let sr = 0, sg = 0, sb = 0;
      for (const [cx, cy] of corners) {
        const idx = (cy * w + cx) * 4;
        sr += pix[idx]; sg += pix[idx + 1]; sb += pix[idx + 2];
      }
      bgLab = rgbToLab(sr / 4, sg / 4, sb / 4);
    }

    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const isFg = hasAlpha
          ? pix[i + 3] >= 128
          : labDist(rgbToLab(pix[i], pix[i + 1], pix[i + 2]), bgLab) > 12;
        if (isFg) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX - minX < 10 || maxY - minY < 10) {
      return { x: 0.08, y: 0.06, w: 0.84, h: 0.88 };
    }
    const padX = (maxX - minX) * 0.10;
    const padY = (maxY - minY) * 0.08;
    const x0 = clamp((minX - padX) / w, 0, 0.8);
    const y0 = clamp((minY - padY) / h, 0, 0.8);
    const x1 = clamp((maxX + 1 + padX) / w, x0 + 0.18, 1);
    const y1 = clamp((maxY + 1 + padY) / h, y0 + 0.18, 1);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function analyzeCatPhoto(imgSource, cropBox, options) {
    const opts = Object.assign({
      sourceType: 'photo', // 'photo' | 'drawing'
      colorCount: 3,
      smoothness: 1.0,
      tone: 'balanced',
      addTabby: 'auto',
      softColorpoint: true,
      includeNose: true,
      includePads: true,
      includeIris: true,
      name: '照片生成小猫'
    }, options || {});
    const isDrawing = opts.sourceType === 'drawing';

    // 1. Sample raw photo crop into 128x144 (raw) for eye/tabby detection & 72x84 (smoothed) for spatial color blocks
    const rawW = 128, rawH = 144;
    const rawCanvas = document.createElement('canvas');
    rawCanvas.width = rawW; rawCanvas.height = rawH;
    const rawCtx = rawCanvas.getContext('2d', { willReadFrequently: true });

    const iw = imgSource.naturalWidth || imgSource.width;
    const ih = imgSource.naturalHeight || imgSource.height;
    const sx = clamp((cropBox ? cropBox.x : 0.08) * iw, 0, iw - 1);
    const sy = clamp((cropBox ? cropBox.y : 0.06) * ih, 0, ih - 1);
    const sw = clamp((cropBox ? cropBox.w : 0.84) * iw, 16, iw - sx);
    const sh = clamp((cropBox ? cropBox.h : 0.88) * ih, 16, ih - sy);

    rawCtx.drawImage(imgSource, sx, sy, sw, sh, 0, 0, rawW, rawH);
    const rawPixels = rawCtx.getImageData(0, 0, rawW, rawH).data;
    const ambientCast = isDrawing ? [0, 0] : estimateAmbientCast(rawPixels, rawW, rawH);

    // Also sample outer margin of the FULL image to know background colors reliably
    const fullThumb = document.createElement('canvas');
    fullThumb.width = 64; fullThumb.height = 64;
    const ftCtx = fullThumb.getContext('2d', { willReadFrequently: true });
    ftCtx.drawImage(imgSource, 0, 0, 64, 64);
    const ftPix = ftCtx.getImageData(0, 0, 64, 64).data;
    const bgSamples = [];
    for (let y = 0; y < 64; y += 2) {
      for (let x = 0; x < 64; x += 2) {
        if (x < 5 || x > 58 || y < 5) {
          const i = (y * 64 + x) * 4;
          if (ftPix[i + 3] < 128) continue;
          const lab = shiftLabCast(rgbToLab(ftPix[i], ftPix[i + 1], ftPix[i + 2]), ambientCast);
          bgSamples.push({ r: ftPix[i], g: ftPix[i + 1], b: ftPix[i + 2], lab, w: 1 });
        }
      }
    }
    const bgClusters = bgSamples.length ? kMeansLab(bgSamples, 3, 14) : [];
    const bgLabs = bgClusters.map((c) => c.lab);

    // 2. Downsample & light edge-preserving bilateral smooth (skip blur on hand-drawn art; radius=1 preserves thin stripes/blazes)
    const gw = 72, gh = 84;
    const gCanvas = document.createElement('canvas');
    gCanvas.width = gw; gCanvas.height = gh;
    const gCtx = gCanvas.getContext('2d', { willReadFrequently: true });
    gCtx.drawImage(rawCanvas, 0, 0, gw, gh);
    const gRaw = gCtx.getImageData(0, 0, gw, gh).data;
    const smoothPix = isDrawing ? gRaw : bilateralSmooth(gRaw, gw, gh, 1, 22);

    // Track transparent pixels (e.g. transparent PNG hand-drawn cats)
    const N = gw * gh;
    const isTrans = new Uint8Array(N);
    let transTotal = 0;
    for (let idx = 0; idx < N; idx++) {
      if (gRaw[idx * 4 + 3] < 128) {
        isTrans[idx] = 1;
        transTotal++;
      }
    }
    const hasAlpha = transTotal > N * 0.03;

    // 3. Foreground cat mask on the 72x84 grid — a GrabCut-style colour-model segmentation (no OpenCV).
    const insideHead = (nx, ny) => ((nx - 0.50) / 0.34) ** 2 + ((ny - 0.33) / 0.23) ** 2 <= 1.0;
    const insideBody = (nx, ny) => ((nx - 0.50) / 0.38) ** 2 + ((ny - 0.74) / 0.25) ** 2 <= 1.0;
    const insideEyeHole = (nx, ny) => {
      const l = ((nx - 0.36) / 0.085) ** 2 + ((ny - 0.32) / 0.065) ** 2 <= 1.0;
      const r = ((nx - 0.64) / 0.085) ** 2 + ((ny - 0.32) / 0.065) ** 2 <= 1.0;
      return l || r;
    };
    const pixelLab = new Array(N);
    const inPrior = new Uint8Array(N), inCoreCell = new Uint8Array(N), inFaceCore = new Uint8Array(N), inForeheadCore = new Uint8Array(N), inEye = new Uint8Array(N), onBorder = new Uint8Array(N);
    for (let y = 0; y < gh; y++) {
      const ny = (y + 0.5) / gh;
      for (let x = 0; x < gw; x++) {
        const nx = (x + 0.5) / gw;
        const idx = y * gw + x, i = idx * 4;
        const rawLab = rgbToLab(smoothPix[i], smoothPix[i + 1], smoothPix[i + 2]);
        pixelLab[idx] = isDrawing ? rawLab : shiftLabCast(rawLab, ambientCast);
        inPrior[idx] = !isTrans[idx] && (insideHead(nx, ny) || insideBody(nx, ny)) ? 1 : 0;
        inFaceCore[idx] = !isTrans[idx] && (((nx - 0.50) / 0.17) ** 2 + ((ny - 0.37) / 0.09) ** 2 <= 1.0) ? 1 : 0;
        inForeheadCore[idx] = !isTrans[idx] && (((nx - 0.50) / 0.16) ** 2 + ((ny - 0.21) / 0.07) ** 2 <= 1.0) ? 1 : 0;
        inCoreCell[idx] = !isTrans[idx] && (inFaceCore[idx] || ((nx - 0.50) / 0.18) ** 2 + ((ny - 0.58) / 0.18) ** 2 <= 1.0) ? 1 : 0;
        inEye[idx] = insideEyeHole(nx, ny) ? 1 : 0;
        onBorder[idx] = (x < 3 || x >= gw - 3 || y < 2 || y >= gh - 2) ? 1 : 0;
      }
    }
    const useCastRgb = !isDrawing && opts.tone !== 'faithful' && (ambientCast[0] !== 0 || ambientCast[1] !== 0);
    const corrRgb = (idx) => {
      if (useCastRgb) return labToRgb(pixelLab[idx]);
      const i = idx * 4;
      return [smoothPix[i], smoothPix[i + 1], smoothPix[i + 2]];
    };
    const cellSample = (idx, w) => {
      const rgb = corrRgb(idx);
      return { r: rgb[0], g: rgb[1], b: rgb[2], lab: pixelLab[idx], w };
    };
    const minDistTo = (lab, models) => {
      let m = Infinity;
      for (const c of models) { const d = labDist(lab, c); if (d < m) m = d; }
      return m;
    };
    // Face model includes face core + forehead crown so bicolor/cap-and-saddle cats protect both face & cap colors.
    const faceS = [], borderS = [];
    for (let idx = 0; idx < N; idx++) {
      if (isTrans[idx]) continue;
      if (inFaceCore[idx] && !inEye[idx]) faceS.push(cellSample(idx, 1.0));
      else if (inForeheadCore[idx] && !inEye[idx]) faceS.push(cellSample(idx, 0.7));
      else if (onBorder[idx]) borderS.push(cellSample(idx, 1.0));
    }
    const rawBorderModel = borderS.length ? kMeansLab(borderS, 6, 7).map((c) => c.lab) : [];
    let faceClusters = faceS.length ? kMeansLab(faceS, 5, 7) : [];
    const cleanedFace = faceClusters.filter((c) => !(c.ratio < 0.14 && minDistTo(c.lab, rawBorderModel) < 12));
    if (cleanedFace.length) faceClusters = cleanedFace;
    const faceModel = faceClusters.map((c) => c.lab);
    const faceLike = (idx) => !isTrans[idx] && minDistTo(pixelLab[idx], faceModel) <= 12;

    // Background = transparent pixels OR everything reachable from top/side crop edges without crossing strong edges into faceModel.
    const flooded = new Uint8Array(N);
    const fq = new Int32Array(N);
    let fh = 0, ft = 0;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const idx = y * gw + x;
        if (isTrans[idx]) { flooded[idx] = 1; continue; }
        if (hasAlpha) continue;
        const outerTop = y < 2;
        const sideSeed = !inPrior[idx] && (x < 3 || x >= gw - 3) && y < (isDrawing ? gh * 0.92 : gh * 0.60);
        if ((outerTop || sideSeed) && !inCoreCell[idx]) { flooded[idx] = 1; fq[ft++] = idx; }
      }
    }
    const floodStepTol = isDrawing ? 14 : 10;
    while (fh < ft) {
      const c = fq[fh++], cx = c % gw, cy = (c - cx) / gw;
      const nbs = [cx > 0 ? c - 1 : -1, cx + 1 < gw ? c + 1 : -1, cy > 0 ? c - gw : -1, cy + 1 < gh ? c + gw : -1];
      for (const nb of nbs) {
        if (nb < 0 || flooded[nb] || inCoreCell[nb]) continue;
        const protectFace = inPrior[nb] && faceLike(nb);
        if (labDist(pixelLab[nb], pixelLab[c]) < floodStepTol && !protectFace) { flooded[nb] = 1; fq[ft++] = nb; }
      }
    }

    // Cat mask = inside the guide ovals and not background; smooth, keep what touches the face, fill holes.
    let pixelFg = new Uint8Array(N);
    {
      let cur = new Uint8Array(N);
      for (let idx = 0; idx < N; idx++) cur[idx] = inPrior[idx] && !flooded[idx] ? 1 : 0;
      for (let pass = 0; pass < 2; pass++) {
        const nxt = new Uint8Array(N);
        for (let y = 0; y < gh; y++) {
          for (let x = 0; x < gw; x++) {
            const idx = y * gw + x;
            if (!inPrior[idx]) continue;
            if (inFaceCore[idx]) { nxt[idx] = 1; continue; }
            let cnt = 0;
            for (let dy = -1; dy <= 1; dy++) {
              const yy = y + dy;
              if (yy < 0 || yy >= gh) continue;
              for (let dx = -1; dx <= 1; dx++) {
                const xx = x + dx;
                if (xx >= 0 && xx < gw && cur[yy * gw + xx]) cnt++;
              }
            }
            nxt[idx] = cnt >= 5 ? 1 : 0;
          }
        }
        cur = nxt;
      }
      const keep = new Uint8Array(N), queue = new Int32Array(N);
      let qh = 0, qt = 0;
      for (let idx = 0; idx < N; idx++) if (inFaceCore[idx] && cur[idx]) { keep[idx] = 1; queue[qt++] = idx; }
      while (qh < qt) {
        const c = queue[qh++], cx = c % gw, cy = (c - cx) / gw;
        const nbs = [cx > 0 ? c - 1 : -1, cx + 1 < gw ? c + 1 : -1, cy > 0 ? c - gw : -1, cy + 1 < gh ? c + gw : -1];
        for (const nb of nbs) if (nb >= 0 && cur[nb] && !keep[nb]) { keep[nb] = 1; queue[qt++] = nb; }
      }
      // holes = non-cat cells inside the ovals that the outside can't reach (eyes, glare, collars)
      const outside = new Uint8Array(N);
      qh = 0; qt = 0;
      for (let idx = 0; idx < N; idx++) if (!keep[idx] && (onBorder[idx] || !inPrior[idx])) { outside[idx] = 1; queue[qt++] = idx; }
      while (qh < qt) {
        const c = queue[qh++], cx = c % gw, cy = (c - cx) / gw;
        const nbs = [cx > 0 ? c - 1 : -1, cx + 1 < gw ? c + 1 : -1, cy > 0 ? c - gw : -1, cy + 1 < gh ? c + gw : -1];
        for (const nb of nbs) if (nb >= 0 && !keep[nb] && !outside[nb]) { outside[nb] = 1; queue[qt++] = nb; }
      }
      for (let idx = 0; idx < N; idx++) pixelFg[idx] = inPrior[idx] && !outside[idx] ? 1 : 0;
    }
    const bgCellSamples = [];
    for (let idx = 0; idx < N; idx++) if (flooded[idx] || (!pixelFg[idx] && onBorder[idx])) bgCellSamples.push(cellSample(idx, 1));
    const models = { bg: kMeansLab(bgCellSamples.length ? bgCellSamples : borderS, 6, 7).map((c) => c.lab) };
    const borderModel = rawBorderModel;
    const seedFg = inFaceCore;
    const bgModelLabs = models.bg;
    const bgLabsAll = bgLabs.concat(bgModelLabs);

    // Collect foreground fur samples (excluding eyes); downweight 1px outer silhouette rim to avoid AA background halos
    const furSamples = [];
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const idx = y * gw + x;
        if (!pixelFg[idx] || inEye[idx]) continue;
        const isRim = !hasAlpha && !(
          x > 0 && x + 1 < gw && y > 0 && y + 1 < gh &&
          pixelFg[idx - 1] && pixelFg[idx + 1] && pixelFg[idx - gw] && pixelFg[idx + gw]
        );
        const w = isRim ? 0.12 : ((inCoreCell[idx] || inForeheadCore[idx]) ? 1.3 : 0.85);
        furSamples.push(cellSample(idx, w));
      }
    }

    // 4. Quantize foreground fur into K distinct perceptual coat colors using over-clustering + agglomerative merge
    const targetK = clamp(Math.round(opts.colorCount || 3), 2, 5);
    const mergeTol = isDrawing
      ? (targetK <= 2 ? 15 : 10)
      : (targetK <= 2 ? 18 : targetK === 3 ? 14 : 11);
    const distFn = isDrawing ? labDist : coatLabDist;
    const rawClusters = kMeansLab(furSamples, targetK, mergeTol, !isDrawing, {
      targetCount: targetK,
      overClusterK: Math.min(9, targetK + 4)
    });
    let coatClusters = rawClusters.filter((c) => c.ratio >= (isDrawing ? 0.025 : 0.022));
    if (coatClusters.length > 1 && !hasAlpha) {
      // Drop peripheral background leak or 1px AA silhouette-rim clusters absent from core & forehead
      const coreHits = new Float64Array(coatClusters.length), faceHits = new Float64Array(coatClusters.length), rimHits = new Float64Array(coatClusters.length), allHits = new Float64Array(coatClusters.length);
      for (let y = 0; y < gh; y++) {
        for (let x = 0; x < gw; x++) {
          const idx = y * gw + x;
          if (!pixelFg[idx] || inEye[idx]) continue;
          let best = 0, bestD = Infinity;
          for (let c = 0; c < coatClusters.length; c++) {
            const d = distFn(pixelLab[idx], coatClusters[c].lab);
            if (d < bestD) { bestD = d; best = c; }
          }
          allHits[best]++;
          if (inCoreCell[idx] || inForeheadCore[idx]) coreHits[best]++;
          if (inFaceCore[idx]) faceHits[best]++;
          const isRim = !(x > 0 && x + 1 < gw && y > 0 && y + 1 < gh &&
            pixelFg[idx - 1] && pixelFg[idx + 1] && pixelFg[idx - gw] && pixelFg[idx + gw]);
          if (isRim) rimHits[best]++;
        }
      }
      const kept = coatClusters.filter((c, ci) => {
        const coreShare = coreHits[ci] / Math.max(1, allHits[ci]);
        const faceShare = faceHits[ci] / Math.max(1, allHits[ci]);
        const rimShare = rimHits[ci] / Math.max(1, allHits[ci]);
        const bgD = minDistTo(c.lab, bgModelLabs);
        const bgLeak = bgD < 14 && c.ratio < 0.45 && (coreShare < 0.12 || (c.ratio < 0.08 && faceShare < 0.06 && rimShare > 0.40));
        const rimOnly = c.ratio < 0.08 && rimShare > 0.68 && coreShare < 0.06;
        return !bgLeak && !rimOnly;
      });
      if (kept.length) coatClusters = kept;
    }
    if (coatClusters.length === 0) {
      coatClusters.push({ rgb: [60, 60, 64], lab: [25, 0, 0], hsl: [0, 0, 0.24], chroma: 0, ratio: 1 });
    }

    // Assign every foreground pixel its nearest coat color index (filling eye holes from surrounding fur)
    const labelGrid = new Int16Array(gw * gh).fill(-1);
    for (let y = 0; y < gh; y++) {
      const ny = (y + 0.5) / gh;
      for (let x = 0; x < gw; x++) {
        const nx = (x + 0.5) / gw;
        if (!pixelFg[y * gw + x] || insideEyeHole(nx, ny)) continue;
        const lab = pixelLab[y * gw + x];
        let best = 0, bestD = Infinity;
        for (let c = 0; c < coatClusters.length; c++) {
          const d = distFn(lab, coatClusters[c].lab);
          if (d < bestD) { bestD = d; best = c; }
        }
        labelGrid[y * gw + x] = best;
      }
    }

    // Representative colour of a coat cluster = upper-middle [45%..88%] luminance band for real photos
    // (removes shadow darkening without picking blown-out specular highlights; skip dark achromatic coats & drawings)
    if (!isDrawing) {
      for (let c = 0; c < coatClusters.length; c++) {
        if (coatClusters[c].chroma <= 14 && coatClusters[c].lab[0] < 48) continue;
        const ls = [];
        for (let idx = 0; idx < N; idx++) if (labelGrid[idx] === c) ls.push(pixelLab[idx][0]);
        if (ls.length < 12) continue;
        ls.sort((a, b) => a - b);
        const loL = ls[Math.floor(ls.length * 0.45)];
        const hiL = ls[Math.min(ls.length - 1, Math.floor(ls.length * 0.88))];
        let r = 0, g = 0, b = 0, n = 0;
        for (let idx = 0; idx < N; idx++) {
          if (labelGrid[idx] !== c) continue;
          const lVal = pixelLab[idx][0];
          if (lVal < loL || lVal > hiL) continue;
          const pxRgb = corrRgb(idx);
          r += pxRgb[0]; g += pxRgb[1]; b += pxRgb[2]; n++;
        }
        if (n) {
          const rgb = [r / n, g / n, b / n];
          const rawLab = rgbToLab(rgb[0], rgb[1], rgb[2]);
          const lab = useCastRgb ? rawLab : shiftLabCast(rawLab, ambientCast);
          coatClusters[c] = { ...coatClusters[c], rgb, lab, hsl: rgbToHsl(rgb[0], rgb[1], rgb[2]), chroma: Math.hypot(lab[1], lab[2]) };
        }
      }
    }

    // Fill eye holes + small interior holes ONLY inside foreground mask (never dilating into outside background)
    for (let pass = 0; pass < 5; pass++) {
      const copy = labelGrid.slice();
      for (let y = 1; y < gh - 1; y++) {
        for (let x = 1; x < gw - 1; x++) {
          const idx = y * gw + x;
          if (copy[idx] >= 0 || (!pixelFg[idx] && !inEye[idx])) continue;
          const counts = new Int32Array(coatClusters.length);
          let best = -1, bestC = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const l = copy[(y + dy) * gw + (x + dx)];
              if (l >= 0) {
                counts[l]++;
                if (counts[l] > bestC) { bestC = counts[l]; best = l; }
              }
            }
          }
          if (best >= 0) labelGrid[idx] = best;
        }
      }
    }

    // 5. Determine Dominant Base Color (largest area) & Adjusted Palette Colors
    const adjustedClusters = coatClusters.map((c) => {
      const adj = adjustColor(c.rgb, opts.tone);
      return { ...c, adjRgb: adj, hex: rgbToHex(adj[0], adj[1], adj[2]) };
    });

    // Recount actual labeled pixels to pick dominant base color
    const countsAll = new Int32Array(adjustedClusters.length);
    for (let i = 0; i < labelGrid.length; i++) if (labelGrid[i] >= 0) countsAll[labelGrid[i]]++;
    let baseIdx = 0;
    for (let c = 1; c < countsAll.length; c++) if (countsAll[c] > countsAll[baseIdx]) baseIdx = c;

    // 6. Inspect Anatomical Zones (ears, muzzle, chest, arms, paws, tabby texture, eyes, nose)
    const activeCast = isDrawing ? [0, 0] : ambientCast;
    const leftEarInfo = sampleEarZone(rawPixels, rawW, rawH, 0.19, 0.05, 0.39, 0.21, bgLabsAll, activeCast);
    const rightEarInfo = sampleEarZone(rawPixels, rawW, rawH, 0.61, 0.05, 0.81, 0.21, bgLabsAll, activeCast);
    const muzzleInfo = avgBoxRgb(rawPixels, rawW, rawH, 0.39, 0.36, 0.61, 0.49, bgLabsAll, pixelFg, gw, gh, activeCast);
    const chestInfo = avgBoxRgb(rawPixels, rawW, rawH, 0.32, 0.62, 0.68, 0.88, bgLabsAll, pixelFg, gw, gh, activeCast);
    const pawsInfo = avgBoxRgb(rawPixels, rawW, rawH, 0.30, 0.80, 0.70, 0.95, bgLabsAll, pixelFg, gw, gh, activeCast);
    const leftArmInfo = avgBoxRgb(rawPixels, rawW, rawH, 0.26, 0.72, 0.44, 0.88, bgLabsAll, pixelFg, gw, gh, activeCast);
    const rightArmInfo = avgBoxRgb(rawPixels, rawW, rawH, 0.56, 0.72, 0.74, 0.88, bgLabsAll, pixelFg, gw, gh, activeCast);
    const foreheadInfo = avgBoxRgb(rawPixels, rawW, rawH, 0.34, 0.14, 0.66, 0.30, bgLabsAll, pixelFg, gw, gh, activeCast);
    const noseInfo = avgBoxRgb(rawPixels, rawW, rawH, 0.45, 0.41, 0.55, 0.51, [], null, 0, 0, activeCast);
    // Body flanks: light on a Siamese even when its dark mask fills most of a close-up crop,
    // dark on tuxedo / black cats with a white locket (which must never become colour-point).
    const flankL = avgBoxRgb(rawPixels, rawW, rawH, 0.12, 0.62, 0.28, 0.88, bgLabsAll, pixelFg, gw, gh, activeCast);
    const flankR = avgBoxRgb(rawPixels, rawW, rawH, 0.72, 0.62, 0.88, 0.88, bgLabsAll, pixelFg, gw, gh, activeCast);
    const flankLight = Math.max(flankL.catShare > 0.35 ? flankL.lab[0] : 0, flankR.catShare > 0.35 ? flankR.lab[0] : 0);

    const nearestCluster = (lab) => {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < adjustedClusters.length; c++) {
        const d = labDist(lab, adjustedClusters[c].lab);
        if (d < bestD) { bestD = d; best = c; }
      }
      return adjustedClusters[best];
    };

    const resolveEarColor = (info, fallbackCl) => {
      const cl = nearestCluster(info.lab);
      if (info.catShare > 0.28 && labDist(info.lab, cl.lab) > 18) {
        const srcRgb = opts.tone === 'faithful' ? info.rawRgb : info.rgb;
        const adj = adjustColor(srcRgb, opts.tone);
        return { hex: rgbToHex(adj[0], adj[1], adj[2]), lab: info.lab, adjRgb: adj };
      }
      return info.catShare > 0.28 ? cl : fallbackCl;
    };

    const baseCl = adjustedClusters[baseIdx];
    const leftEarCl = resolveEarColor(leftEarInfo, baseCl);
    const rightEarFallback = (rightEarInfo.catShare <= 0.28 && minDistTo(baseCl.lab, bgLabsAll) < 12) ? baseCl : leftEarCl;
    const rightEarCl = resolveEarColor(rightEarInfo, rightEarFallback);
    const chestCl = chestInfo.catShare > 0.30 ? nearestCluster(chestInfo.lab) : baseCl;
    const pawsCl = pawsInfo.catShare > 0.22 ? nearestCluster(pawsInfo.lab) : chestCl;
    const armBestInfo = leftArmInfo.catShare >= rightArmInfo.catShare ? leftArmInfo : rightArmInfo;
    const armsCl = armBestInfo.catShare > 0.35 ? nearestCluster(armBestInfo.lab) : baseCl;

    // Check if this photo is a true colorpoint (Siamese): light creamy body & forehead + dark muzzle & ears
    // (Requires bright base & forehead so black tuxedo cats with a white chest NEVER trigger colorpoint!)
    const isColorpoint = !isDrawing && opts.softColorpoint &&
      (baseCl.lab[0] > 54 || flankLight > 55) &&
      (foreheadInfo.lab[0] > 50 || flankLight > 55) &&
      (chestInfo.lab[0] - muzzleInfo.lab[0]) > 18 &&
      (chestInfo.lab[0] - Math.min(leftEarInfo.lab[0], rightEarInfo.lab[0])) > 14 &&
      chestInfo.lab[0] > 60 && muzzleInfo.lab[0] < 55 &&
      labDist(leftEarInfo.lab, rightEarInfo.lab) < 18;

    const palette = {};
    const regions = [];
    const marks = [];
    const shape = { build: 'standard', pawStagger: 0 };

    // 7. Build Base Palette + Extract REAL Spatial Color-Block Bezier Regions!
    const headY0 = Math.floor(gh * 0.08), headY1 = Math.ceil(gh * 0.56);
    const bodyY0 = Math.floor(gh * 0.50), bodyY1 = Math.ceil(gh * 0.96);
    const headH = headY1 - headY0;
    const bodyH = bodyY1 - bodyY0;

    // Self-calibrate foreground head/body half-widths so cheek & flank markings reach KuroCat's silhouette edges cleanly
    const measureFgHalfWidth = (yFrac0, yFrac1, fallback, minW, maxW) => {
      const hws = [];
      const ry0 = Math.floor(gh * yFrac0), ry1 = Math.ceil(gh * yFrac1);
      for (let y = ry0; y < ry1; y++) {
        let minX = gw, maxX = -1;
        for (let x = 0; x < gw; x++) {
          if (pixelFg[y * gw + x]) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
          }
        }
        if (maxX > minX + 6) hws.push(((maxX - minX + 1) * 0.5) / gw);
      }
      if (hws.length < 3) return fallback;
      hws.sort((a, b) => a - b);
      return clamp(hws[Math.floor(hws.length * 0.5)], minW, maxW);
    };
    const headHalfWFrac = measureFgHalfWidth(0.24, 0.44, 0.265, 0.24, 0.33);
    const bodyHalfWFrac = measureFgHalfWidth(0.58, 0.86, 0.34, 0.28, 0.38);

    // Extract regions directly from the quantized label grid for a given part space
    function extractSpaceRegions(space, yStart, yEnd, coordMapper, overshootFn, minAreaPx) {
      const shLocal = yEnd - yStart;
      const outRegions = [];
      const smoothIter = opts.smoothness >= 1.2 ? 2 : 1;
      const rdpEps = 1.8 + opts.smoothness * 2.1; // in KuroCat coordinate units

      for (let c = 0; c < adjustedClusters.length; c++) {
        if (c === baseIdx) continue;
        // Build binary mask for cluster c in this slice
        const bin = new Uint8Array(gw * shLocal);
        let count = 0;
        for (let y = 0; y < shLocal; y++) {
          for (let x = 0; x < gw; x++) {
            if (labelGrid[(yStart + y) * gw + x] === c) {
              bin[y * gw + x] = 1;
              count++;
            }
          }
        }
        if (count < minAreaPx) continue;

        const cleaned = cleanBinaryMask(bin, gw, shLocal);
        const comps = findConnectedComponents(cleaned, gw, shLocal, minAreaPx);

        for (let ci = 0; ci < Math.min(comps.length, 4); ci++) {
          const loopPx = traceContourMarchingSquares(comps[ci].mask, gw, shLocal);
          if (loopPx.length < 8) continue;

          // Map pixel contour -> KuroCat part coordinate space + gentle edge overshoot
          const mapped = loopPx.map((pt) => {
            const p = coordMapper(pt.x, pt.y);
            return overshootFn(p);
          });

          const smoothed = smoothPolygon(mapped, smoothIter);
          const simplified = simplifyClosedLoop(smoothed, rdpEps);
          if (simplified.length < 3 || simplified.length > 48) continue;

          const anchors = polyToBezierAnchors(simplified, 0.22);
          outRegions.push({
            _label: `${space === 'head' ? '脸部' : '身体'}色块 (${adjustedClusters[c].hex})`,
            space,
            fill: adjustedClusters[c].hex,
            anchors
          });
        }
      }
      return outRegions;
    }

    if (isColorpoint) {
      // Soft gradient Siamese/colorpoint option (preserves soft airbrush mask feel!)
      const srcLightRgb = chestInfo.lab[0] > 64 ? (opts.tone === 'faithful' ? chestInfo.rawRgb : chestInfo.rgb) : [244, 236, 224];
      const creamBase = adjustColor(srcLightRgb, opts.tone);
      const pointCol = adjustColor(opts.tone === 'faithful' ? muzzleInfo.rawRgb : muzzleInfo.rgb, opts.tone);
      const midCol = mixRgb(pointCol, creamBase, 0.36);

      palette.body = rgbToHex(creamBase[0], creamBase[1], creamBase[2]);
      palette.bodyShade = rgbToHex(...shadeRgb(creamBase, 0.93));
      palette.points = rgbToHex(pointCol[0], pointCol[1], pointCol[2]);
      palette.pointsMid = rgbToHex(midCol[0], midCol[1], midCol[2]);
      palette.legs = palette.points;
      palette.paws = palette.points;
      palette.earOuter = palette.points;
      palette.earInner = rgbToHex(...mixRgb(pointCol, [145, 112, 98], 0.38));
      palette.tail = palette.points;
      palette.outline = rgbToHex(173, 150, 128, 0.42);
      palette.crease = rgbToHex(141, 120, 103, 0.54);
      palette.whiskers = rgbToHex(122, 99, 83, 0.62);
      shape.build = 'sleek';
      shape.pawStagger = 1;
    } else {
      // DIRECT PHOTO COLOR-BLOCK EXTRACTION!
      palette.body = baseCl.hex;
      const baseLum = (0.2126 * baseCl.adjRgb[0] + 0.7152 * baseCl.adjRgb[1] + 0.0722 * baseCl.adjRgb[2]) / 255;
      palette.bodyShade = rgbToHex(...shadeRgb(baseCl.adjRgb, baseLum < 0.2 ? 0.82 : 0.94));
      palette.belly = chestCl.hex;
      palette.legs = armsCl.hex;
      palette.paws = pawsCl.hex;
      const earsVisible = leftEarInfo.catShare > 0.28 || rightEarInfo.catShare > 0.28;
      palette.earOuter = leftEarCl.hex;
      palette.earInner = baseLum < 0.24
        ? rgbToHex(64, 54, 56)
        : rgbToHex(...mixRgb(leftEarCl.adjRgb, [242, 188, 186], 0.52));

      // Tail uses a prominent non-white coat color if white is the base (e.g. calico/tuxedo), else body color
      const nonWhiteCl = adjustedClusters.find((c) => !(c.lab[0] > 72 && c.chroma < 18));
      palette.tail = (baseLum > 0.76 && nonWhiteCl) ? nonWhiteCl.hex : baseCl.hex;
      if (adjustedClusters.length >= 3 && baseLum > 0.70) {
        const secondAccent = adjustedClusters.find((c) => c !== baseCl && c !== nonWhiteCl);
        if (secondAccent) palette.tailTip = secondAccent.hex;
      }

      // If right ear has a visibly different color from left ear (like calico/cow cats!), add a rightEar region!
      if (earsVisible && labDist(leftEarCl.lab, rightEarCl.lab) > 16) {
        regions.push({
          _label: `右耳色块 (${rightEarCl.hex})`,
          space: 'rightEar',
          fill: rightEarCl.hex,
          anchors: [{ x: -60, y: 10 }, { x: 60, y: 10 }, { x: 60, y: -120 }, { x: -60, y: -120 }]
        });
      }

      // 7a. Trace real HEAD color blocks directly from photo pixels!
      const headRegions = extractSpaceRegions(
        'head', headY0, headY1,
        (px, py) => ({
          x: ((px / gw) - 0.50) / headHalfWFrac * 45,
          y: -38 + (py / headH) * 72
        }),
        (p) => {
          // Gently push outer silhouette edge points outward so jaw/head clips cleanly with zero gap
          const r = Math.hypot(p.x / 42, (p.y + 4) / 34);
          if (r > 0.84) {
            const push = 1 + (r - 0.84) * 0.85;
            return { x: p.x * push, y: -4 + (p.y + 4) * push };
          }
          return p;
        },
        Math.max(18, Math.round(gw * headH * 0.015))
      );

      // 7b. Trace real BODY color blocks directly from photo pixels!
      const bodyRegions = extractSpaceRegions(
        'body', bodyY0, bodyY1,
        (px, py) => ({
          x: ((px / gw) - 0.50) / bodyHalfWFrac * 51,
          y: -104 + (py / bodyH) * 124
        }),
        (p) => {
          let x = p.x, y = p.y;
          if (Math.abs(x) > 39) x = Math.sign(x) * (Math.abs(x) + 14);
          if (y < -92) y -= 14;
          if (y > 6) y += 10;
          return { x, y };
        },
        Math.max(24, Math.round(gw * bodyH * 0.018))
      );

      regions.push(...bodyRegions, ...headRegions);

      if (baseLum > 0.78) {
        palette.outline = rgbToHex(182, 166, 148, 0.38);
      }
      shape.bodyWidth = 1.06;
      shape.cheekFullness = 1.06;
    }

    // 8. Optional Tabby Stripes (band-pass forehead oscillation check; works on tabby-and-white too)
    const tabbyCheck = (isDrawing || isColorpoint)
      ? { isTabby: false, stripeRgb: null, meanLum: 50, oscRatio: 0 }
      : detectForeheadTabby(rawPixels, rawW, rawH, bgLabsAll, pixelFg, gw, gh, activeCast);
    const baseColObj = global.KuroSpec.parseHexColor(palette.body);
    const baseLuminance = baseColObj ? global.KuroSpec.luminance(baseColObj) : 0.5;
    const autoTabby = !isDrawing && !isColorpoint && tabbyCheck.isTabby;
    const shouldAddTabby = opts.addTabby === 'on' || (opts.addTabby === 'auto' && autoTabby);

    if (shouldAddTabby) {
      let stripeHex;
      if (tabbyCheck.stripeRgb) {
        const rawStripeLab = rgbToLab(...tabbyCheck.stripeRgb);
        const corrStripeLab = shiftLabCast(rawStripeLab, activeCast);
        if (corrStripeLab[0] < tabbyCheck.meanLum - 2) {
          const srcStripeRgb = useCastRgb ? labToRgb(corrStripeLab) : tabbyCheck.stripeRgb;
          const adjStripe = adjustColor(srcStripeRgb, opts.tone);
          stripeHex = rgbToHex(...shadeRgb(adjStripe, 0.86));
        }
      }
      if (!stripeHex) {
        const foreheadCl = nearestCluster(foreheadInfo.lab);
        const nonWhiteRef = (foreheadCl.lab[0] <= 74 || foreheadCl.chroma >= 16)
          ? foreheadCl
          : (adjustedClusters.find((c) => !(c.lab[0] > 72 && c.chroma < 18)) || baseCl);
        const refLum = (0.2126 * nonWhiteRef.adjRgb[0] + 0.7152 * nonWhiteRef.adjRgb[1] + 0.0722 * nonWhiteRef.adjRgb[2]) / 255;
        stripeHex = rgbToHex(...shadeRgb(nonWhiteRef.adjRgb, refLum > 0.45 ? 0.60 : 0.48));
      }
      palette.stripes = stripeHex;
      marks.push(...makeTabbyForeheadMarks(stripeHex, 0.58));
      marks.push(...makeTailRingMarks(stripeHex, 0.62));
    }

    // 9. Eye Iris, Nose, Mouth, Paw Pads & Contrast-safe Whiskers/Crease
    const furLabs = adjustedClusters.map((c) => c.lab);
    const detectedIris = detectEyeIris(rawPixels, rawW, rawH, furLabs, activeCast);

    if (opts.includeIris) {
      if (detectedIris) {
        palette.iris = rgbToHex(detectedIris[0], detectedIris[1], detectedIris[2]);
      } else if (isColorpoint) {
        palette.iris = '#A8D6F0';
      } else if (baseLuminance < 0.22) {
        palette.iris = '#C9F240';
      } else {
        palette.iris = '#D9B252';
      }
    }

    if (opts.includeNose) {
      const [nh, ns, nl] = rgbToHsl(noseInfo.rgb[0], noseInfo.rgb[1], noseInfo.rgb[2]);
      const noseRgb = ((nh <= 28 || nh >= 325) && ns > 0.14 && nl > 0.40)
        ? [230, 145, 152]
        : (nl < 0.34 ? [46, 35, 32] : [182, 128, 120]);
      palette.nose = rgbToHex(noseRgb[0], noseRgb[1], noseRgb[2]);
      const mouthRgb = isColorpoint ? [199, 168, 143] : (baseLuminance < 0.25 ? [126, 120, 124] : [152, 126, 116]);
      palette.mouth = rgbToHex(mouthRgb[0], mouthRgb[1], mouthRgb[2], 0.72);
    }

    if (opts.includePads) {
      const pawsLum = (0.2126 * pawsCl.adjRgb[0] + 0.7152 * pawsCl.adjRgb[1] + 0.0722 * pawsCl.adjRgb[2]) / 255;
      palette.pawPads = pawsLum < 0.22 ? '#5A4E52' : '#ECA2AA';
    }

    if (!palette.whiskers) {
      palette.whiskers = baseLuminance < 0.42 ? '#E0E6EBAD' : '#8D8170AD';
    }
    if (!palette.crease) {
      palette.crease = baseLuminance < 0.42 ? '#BFC9C599' : '#8B817194';
    }

    // 10. Render a tiny debug preview of the extracted color-block segmentation map!
    const segCanvas = document.createElement('canvas');
    segCanvas.width = gw; segCanvas.height = gh;
    const segCtx = segCanvas.getContext('2d');
    const segImg = segCtx.createImageData(gw, gh);
    for (let i = 0; i < gw * gh; i++) {
      const lbl = labelGrid[i];
      if (lbl >= 0) {
        const col = adjustedClusters[lbl].adjRgb;
        segImg.data[i * 4] = col[0];
        segImg.data[i * 4 + 1] = col[1];
        segImg.data[i * 4 + 2] = col[2];
        segImg.data[i * 4 + 3] = 255;
      } else {
        segImg.data[i * 4] = 240;
        segImg.data[i * 4 + 1] = 230;
        segImg.data[i * 4 + 2] = 216;
        segImg.data[i * 4 + 3] = 255;
      }
    }
    segCtx.putImageData(segImg, 0, 0);

    const rawSpec = {
      formatVersion: 1,
      name: opts.name || '照片生成小猫',
      author: 'KuroCat 皮肤工坊',
      palette,
      shape,
      headSurface: 'dome',
      regions: regions.slice(0, 64),
      marks
    };

    const modeLabel = isColorpoint
      ? '柔焦重点色提取'
      : isDrawing
        ? `手绘色块提取 (${adjustedClusters.length} 色 · ${regions.length} 分区)`
        : `真实色块拟合 (${adjustedClusters.length} 色 · ${regions.length} 分区)`;

    const swatches = adjustedClusters.map((c, idx) => ({
      label: idx === baseIdx ? `底色 ${Math.round(c.ratio * 100)}%` : `色块${idx + 1} ${Math.round(c.ratio * 100)}%`,
      hex: c.hex
    }));
    if (palette.iris) swatches.push({ label: '提取瞳色', hex: palette.iris });

    return {
      spec: rawSpec,
      modeLabel,
      reason: isColorpoint
        ? '检测到奶白身躯与深色重点面罩，已采用柔焦渐变面罩（取消勾选「重点色柔焦」可切换纯色块拟合）'
        : isDrawing
          ? `已按手绘/板绘模式保留原图清晰色块，提取 ${adjustedClusters.length} 种颜色并生成 ${regions.length} 个可编辑贝塞尔分区`
          : `从照片中直接提取了 ${adjustedClusters.length} 种毛色，并按实际像素位置拟合出 ${regions.length} 个可二次拖动编辑的贝塞尔色块分区${shouldAddTabby ? ' + 虎斑条纹' : ''}`,
      swatches,
      segDataUrl: segCanvas.toDataURL('image/png'),
      diagnostics: {
        colorCount: adjustedClusters.length,
        regionCount: regions.length,
        markCount: marks.length,
        tabbyAdded: shouldAddTabby,
        irisDetected: Boolean(detectedIris),
        segmentation: {
          faceColors: faceModel.map((l) => labToHexApprox(l)),
          borderColors: borderModel.map((l) => labToHexApprox(l)),
          seedCells: seedFg.reduce((a, v) => a + v, 0),
          catCells: pixelFg.reduce((a, v) => a + v, 0),
          coatColors: adjustedClusters.map((c) => c.hex)
        },
        zonesL: {
          chest: Math.round(chestInfo.lab[0]), muzzle: Math.round(muzzleInfo.lab[0]), forehead: Math.round(foreheadInfo.lab[0]),
          leftEar: Math.round(leftEarInfo.lab[0]), rightEar: Math.round(rightEarInfo.lab[0]), flank: Math.round(flankLight),
          base: Math.round(baseCl.lab[0]), earDiff: Math.round(labDist(leftEarInfo.lab, rightEarInfo.lab))
        }
      }
    };
  }

  // Edge flood-fill solid/paper background remover for opaque hand-drawn illustrations
  function stripDrawingPaperBackground(imgData, tol) {
    const { data, width, height } = imgData;
    const totalBorder = (width + height) * 2;
    let opaqueBorder = 0;
    const borderSamples = [];
    const samplePx = (x, y) => {
      const idx = (y * width + x) * 4;
      if (data[idx + 3] > 240) {
        opaqueBorder++;
        borderSamples.push([data[idx], data[idx + 1], data[idx + 2]]);
      }
    };
    for (let x = 0; x < width; x++) { samplePx(x, 0); samplePx(x, height - 1); }
    for (let y = 1; y < height - 1; y++) { samplePx(0, y); samplePx(width - 1, y); }
    // Already transparent PNG -> preserve artist's original alpha!
    if (opaqueBorder < totalBorder * 0.80 || borderSamples.length === 0) return false;

    borderSamples.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
    const bg = borderSamples[Math.floor(borderSamples.length * 0.5)];
    const t = tol || 38;
    const t2 = t * t * 3;
    const soft2 = (t + 18) * (t + 18) * 3;
    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let head = 0, tail = 0;

    const tryPush = (x, y) => {
      const p = y * width + x;
      if (visited[p]) return;
      const i = p * 4;
      const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
      if (data[i + 3] < 20 || (dr * dr + dg * dg + db * db) <= t2) {
        visited[p] = 1;
        queue[tail++] = p;
      }
    };
    for (let x = 0; x < width; x++) { tryPush(x, 0); tryPush(x, height - 1); }
    for (let y = 1; y < height - 1; y++) { tryPush(0, y); tryPush(width - 1, y); }

    while (head < tail) {
      const p = queue[head++];
      data[p * 4 + 3] = 0;
      const x = p % width;
      const y = (p - x) / width;
      if (x > 0) tryPush(x - 1, y);
      if (x + 1 < width) tryPush(x + 1, y);
      if (y > 0) tryPush(x, y - 1);
      if (y + 1 < height) tryPush(x, y + 1);
    }

    // Soft 1px anti-alias feather on pixels directly touching removed background
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const p = y * width + x;
        if (visited[p]) continue;
        if (visited[p - 1] || visited[p + 1] || visited[p - width] || visited[p + width]) {
          const i = p * 4;
          const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
          const d2 = dr * dr + dg * dg + db * db;
          if (d2 < soft2) {
            const k = clamp((Math.sqrt(d2 / 3) - t * 0.65) / 26, 0, 1);
            data[i + 3] = Math.round(data[i + 3] * k);
          }
        }
      }
    }
    return true;
  }

  function trimCanvasRegion(srcCanvas, yStart, yEnd, featherTop, featherBottom) {
    const w = srcCanvas.width;
    const h = Math.max(1, yEnd - yStart);
    const slice = document.createElement('canvas');
    slice.width = w;
    slice.height = h;
    const sctx = slice.getContext('2d');
    sctx.drawImage(srcCanvas, 0, yStart, w, h, 0, 0, w, h);
    const id = sctx.getImageData(0, 0, w, h);
    const d = id.data;

    if (featherTop > 0) {
      for (let y = 0; y < Math.min(featherTop, h); y++) {
        const k = (y + 0.5) / featherTop;
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4 + 3;
          d[idx] = Math.round(d[idx] * k);
        }
      }
    }
    if (featherBottom > 0) {
      for (let y = Math.max(0, h - featherBottom); y < h; y++) {
        const k = (h - y - 0.5) / featherBottom;
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4 + 3;
          d[idx] = Math.round(d[idx] * k);
        }
      }
    }
    sctx.putImageData(id, 0, 0);

    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 10) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) return null;

    const pad = 2;
    const x0 = Math.max(0, minX - pad);
    const y0 = Math.max(0, minY - pad);
    const cw = Math.min(w - x0, maxX - minX + 1 + pad * 2);
    const ch = Math.min(h - y0, maxY - minY + 1 + pad * 2);
    const out = document.createElement('canvas');
    out.width = cw;
    out.height = ch;
    out.getContext('2d').drawImage(slice, x0, y0, cw, ch, 0, 0, cw, ch);
    const png = out.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
    return {
      png,
      width: cw,
      height: ch,
      canvasCenterX: (x0 + cw * 0.5) * 0.5,
      canvasCenterY: (yStart + y0 + ch * 0.5) * 0.5
    };
  }

  /**
   * Build a 100% .kurocat v1 skin directly preserving the artist's ORIGINAL hand-drawn PNG artwork
   * sliced cleanly into 2x anchored `face` (2.5D head) and `neck` (body) PNG layers, with matched
   * animated paws and optional live wagging tail & dynamic blinking eye cutouts.
   */
  function buildOriginalDrawingSkin(imgSource, cropBox, options) {
    const opts = Object.assign({
      removeBg: true,
      eyeMode: 'keep',      // 'keep' | 'live'
      hideBase: true,
      name: '手绘原画小猫'
    }, options || {});

    const natW = imgSource.naturalWidth || imgSource.width || 720;
    const natH = imgSource.naturalHeight || imgSource.height || 640;

    // 1. Render source image & optionally strip solid/paper background
    const maxSrc = 1024;
    const srcScale = Math.min(1, maxSrc / Math.max(natW, natH));
    const sw = Math.max(16, Math.round(natW * srcScale));
    const sh = Math.max(16, Math.round(natH * srcScale));
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = sw;
    srcCanvas.height = sh;
    const srcCtx = srcCanvas.getContext('2d');
    srcCtx.drawImage(imgSource, 0, 0, sw, sh);

    let bgStripped = false;
    if (opts.removeBg) {
      const id = srcCtx.getImageData(0, 0, sw, sh);
      bgStripped = stripDrawingPaperBackground(id, 38);
      if (bgStripped) srcCtx.putImageData(id, 0, 0);
    }

    // 2. Detect whether the artwork was painted on our 720x640 (9:8) template
    const isTemplateRatio = Math.abs((natW / natH) - (360 / 320)) < 0.03;
    const work = document.createElement('canvas');
    work.width = 720;
    work.height = 640;
    const wctx = work.getContext('2d');
    wctx.imageSmoothingEnabled = true;
    wctx.imageSmoothingQuality = 'high';

    let alignedToTemplate = false;
    const srcData = srcCtx.getImageData(0, 0, sw, sh).data;
    let minX = sw, minY = sh, maxX = -1, maxY = -1;
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        if (srcData[(y * sw + x) * 4 + 3] > 20) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (isTemplateRatio && !opts.useCustomCrop && maxX > minX && maxY > minY) {
      // Check if content sits inside template's cat area (not tightly cropped to 0..1 edges)
      const relMinY = minY / sh;
      const relMaxY = maxY / sh;
      const relMinX = minX / sw;
      const relMaxX = maxX / sw;
      if (relMinY > 0.08 && relMaxY < 0.94 && relMinX > 0.08 && relMaxX < 0.94) {
        alignedToTemplate = true;
        wctx.drawImage(srcCanvas, 0, 0, sw, sh, 0, 0, 720, 640);
      }
    }

    if (!alignedToTemplate) {
      // Fit cropped cat cleanly onto KuroCat's 2x sitting silhouette box (centered x=368, y=144..468)
      let cx0 = minX, cy0 = minY, cw = Math.max(1, maxX - minX + 1), ch = Math.max(1, maxY - minY + 1);
      if (cropBox && opts.useCustomCrop) {
        const isNorm = cropBox.w <= 1.01 && cropBox.h <= 1.01;
        cx0 = Math.max(0, Math.round(isNorm ? cropBox.x * sw : cropBox.x * srcScale));
        cy0 = Math.max(0, Math.round(isNorm ? cropBox.y * sh : cropBox.y * srcScale));
        cw = Math.max(16, Math.round(isNorm ? cropBox.w * sw : cropBox.w * srcScale));
        ch = Math.max(16, Math.round(isNorm ? cropBox.h * sh : cropBox.h * srcScale));
      } else if (maxX < minX) {
        cx0 = 0; cy0 = 0; cw = sw; ch = sh;
      }
      const targetMaxW = 308;
      const targetMaxH = 330;
      const fitScale = Math.min(targetMaxW / cw, targetMaxH / ch);
      const dw = cw * fitScale;
      const dh = ch * fitScale;
      const dx = 368 - dw * 0.5;
      const dy = 468 - dh; // bottom rests cleanly right above keyboard edge (y=234)
      wctx.drawImage(srcCanvas, cx0, cy0, cw, ch, dx, dy, dw, dh);
    }

    // 3. Sample dominant artwork fur colors (for matching animated paws & wagging tail) + detect hand-drawn tail
    const wData = wctx.getImageData(0, 0, 720, 640).data;
    const furBuckets = new Map();
    let lowerR = 0, lowerG = 0, lowerB = 0, lowerN = 0;
    let tailDrawnPx = 0;
    for (let y = 130; y < 500; y += 3) {
      for (let x = 140; x < 630; x += 3) {
        const idx = (y * 720 + x) * 4;
        const a = wData[idx + 3];
        if (a < 180) continue;
        const r = wData[idx], g = wData[idx + 1], b = wData[idx + 2];
        if (x > 468 && y > 330 && y < 485) tailDrawnPx++;
        // Skip very dark ink outlines when sampling base coat color
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (lum > 38) {
          const qr = (r >> 4) << 4, qg = (g >> 4) << 4, qb = (b >> 4) << 4;
          const k = (qr << 16) | (qg << 8) | qb;
          const bkt = furBuckets.get(k) || { r: 0, g: 0, b: 0, n: 0 };
          bkt.r += r; bkt.g += g; bkt.b += b; bkt.n++;
          furBuckets.set(k, bkt);
        }
        if (y > 380 && y < 475 && x > 280 && x < 456) {
          lowerR += r; lowerG += g; lowerB += b; lowerN++;
        }
      }
    }
    let bestBkt = null;
    for (const bkt of furBuckets.values()) {
      if (!bestBkt || bkt.n > bestBkt.n) bestBkt = bkt;
    }
    const baseHex = bestBkt
      ? rgbToHex(bestBkt.r / bestBkt.n, bestBkt.g / bestBkt.n, bestBkt.b / bestBkt.n)
      : '#F5EFE6';
    const pawHex = lowerN > 10
      ? rgbToHex(lowerR / lowerN, lowerG / lowerN, lowerB / lowerN)
      : baseHex;
    const hasDrawnTail = tailDrawnPx > 45;

    // 4. Optional feathered eye-window cutout so KuroCat's live blinking & gaze-tracking eyes shine through
    if (opts.eyeMode === 'live') {
      wctx.save();
      wctx.globalCompositeOperation = 'destination-out';
      for (const sign of [-1, 1]) {
        const ex = 368 + sign * 34.4;
        const ey = 248;
        const rx = 17.5, ry = 18.5;
        wctx.save();
        wctx.translate(ex, ey);
        wctx.scale(rx, ry);
        const grad = wctx.createRadialGradient(0, 0, 0.65, 0, 0, 1.0);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        wctx.fillStyle = grad;
        wctx.beginPath();
        wctx.arc(0, 0, 1.05, 0, Math.PI * 2);
        wctx.fill();
        wctx.restore();
      }
      wctx.restore();
    }

    // 5. Slice into crisp 2x `face` (head + ears) and `neck` (body) decorations
    const splitY = 316; // y = 158 in 360x320 canvas
    const headSlice = trimCanvasRegion(work, 0, splitY + 8, 0, 8);
    const bodySlice = trimCanvasRegion(work, splitY - 4, 515, 4, 0);

    const decorations = [];
    if (bodySlice) {
      decorations.push({
        _label: '手绘躯干原图',
        png: bodySlice.png,
        anchor: 'neck',
        offsetX: round2(clamp(bodySlice.canvasCenterX - 184, -120, 120)),
        offsetY: round2(clamp(bodySlice.canvasCenterY - 162, -120, 120)),
        scale: 1.0,
        rotation: 0
      });
    }
    if (headSlice) {
      decorations.push({
        _label: '手绘头部原图',
        png: headSlice.png,
        anchor: 'face',
        offsetX: round2(clamp(headSlice.canvasCenterX - 184, -120, 120)),
        offsetY: round2(clamp(headSlice.canvasCenterY - 130, -120, 120)),
        scale: 1.0,
        rotation: 0
      });
    }

    const palette = {
      body: opts.hideBase ? `${baseHex}00` : baseHex,
      earOuter: opts.hideBase ? `${baseHex}00` : baseHex,
      legs: baseHex,
      paws: pawHex,
      tail: hasDrawnTail ? `${baseHex}00` : baseHex,
      whiskers: '#00000000',
      crease: '#5A4A3E44'
    };

    const rawSpec = {
      formatVersion: 1,
      name: opts.name || '手绘原画小猫',
      author: 'KuroCat 皮肤工坊',
      palette,
      shape: {
        build: 'standard',
        bodyWidth: 1.0,
        headScale: 1.0,
        cheekFullness: 1.0,
        earSize: 1.0,
        earPointiness: 1.0,
        tailLength: 1.0,
        tailThickness: 1.0,
        pawStagger: 0
      },
      headSurface: 'dome',
      regions: [],
      marks: [],
      decorations
    };

    // Thumbnail preview for summary bar
    const thumb = document.createElement('canvas');
    thumb.width = 96;
    thumb.height = 86;
    thumb.getContext('2d').drawImage(work, 80, 70, 560, 480, 0, 0, 96, 86);

    const swatches = [
      { label: '打字爪色', hex: pawHex },
      { label: hasDrawnTail ? '原画尾巴' : '动态尾巴', hex: baseHex }
    ];

    return {
      spec: rawSpec,
      modeLabel: alignedToTemplate ? '原图直用 · 模板精准对齐' : '原图直用 · 保留原画笔触',
      reason: `已直接保留你的手绘原图（分为「头部 2.5D 跟随」与「躯干呼吸」两层高清 2× PNG），${opts.eyeMode === 'live' ? '已自动挖空眼部启用动态眨眼，' : '完整保留你画的五官与画风，'}${hasDrawnTail ? '检测到原画已自带尾巴（已隐藏默认尾巴）。' : '已自动匹配毛色生成动态摇摆尾巴与打字手。'}导出 .kurocat 即可直接拖进桌面端使用！`,
      swatches,
      segDataUrl: thumb.toDataURL('image/png'),
      alignedToTemplate,
      bgStripped
    };
  }

  global.KuroPhotoAnalyzer = {
    analyzeCatPhoto,
    detectDrawingCrop,
    buildOriginalDrawingSkin
  };
})(window);
