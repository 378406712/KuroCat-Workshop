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
  // Keeps black/white/orange/grey sharply separated, while softening same-hue sunlight shadows!
  function coatLabDist(a, b) {
    const dL = a[0] - b[0];
    const da = a[1] - b[1];
    const db = a[2] - b[2];
    const chromaA = Math.hypot(a[1], a[2]), chromaB = Math.hypot(b[1], b[2]);
    // If both pixels are chromatic and share nearly the same hue direction, downweight pure shadow lightness delta
    let lWeight = 1.0;
    if (chromaA > 14 && chromaB > 14) {
      const cosHue = (a[1] * b[1] + a[2] * b[2]) / (chromaA * chromaB);
      if (cosHue > 0.86 && Math.min(a[0], b[0]) > 22) lWeight = 0.45;
    }
    return Math.hypot(dL * lWeight, da * 1.15, db * 1.15);
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

  // Deterministic K-Means++ in CIE Lab space with shadow-tolerant coat merging
  function kMeansLab(samples, k, mergeDeltaE, useCoatDist) {
    if (samples.length === 0) return [];
    const distFn = useCoatDist ? coatLabDist : labDist;
    const kk = Math.min(k, samples.length);
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

    const clusters = Array.from({ length: kk }, () => ({ r: 0, g: 0, b: 0, w: 0 }));
    let totalW = 0;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i], cl = clusters[assign[i]];
      cl.r += s.r * s.w; cl.g += s.g * s.w; cl.b += s.b * s.w; cl.w += s.w;
      totalW += s.w;
    }

    const valid = clusters
      .filter((c) => c.w > 0)
      .map((c) => {
        const rgb = [c.r / c.w, c.g / c.w, c.b / c.w];
        const lab = rgbToLab(rgb[0], rgb[1], rgb[2]);
        const hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
        return { rgb, lab, hsl, chroma: Math.hypot(lab[1], lab[2]), ratio: c.w / Math.max(1e-6, totalW), w: c.w };
      })
      .sort((a, b) => b.ratio - a.ratio);

    const merged = [];
    const thresh = mergeDeltaE === undefined ? 15 : mergeDeltaE;
    for (const c of valid) {
      const hit = merged.find((m) => distFn(m.lab, c.lab) < thresh);
      if (hit) {
        const tw = hit.w + c.w;
        hit.rgb = [
          (hit.rgb[0] * hit.w + c.rgb[0] * c.w) / tw,
          (hit.rgb[1] * hit.w + c.rgb[1] * c.w) / tw,
          (hit.rgb[2] * hit.w + c.rgb[2] * c.w) / tw
        ];
        hit.lab = rgbToLab(hit.rgb[0], hit.rgb[1], hit.rgb[2]);
        hit.hsl = rgbToHsl(hit.rgb[0], hit.rgb[1], hit.rgb[2]);
        hit.chroma = Math.hypot(hit.lab[1], hit.lab[2]);
        hit.w = tw;
        hit.ratio += c.ratio;
      } else {
        merged.push({ ...c });
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
    // Close small holes, then open thin spikes
    const closed = morphPass(morphPass(mask, w, h, true), w, h, false);
    return morphPass(morphPass(closed, w, h, false), w, h, true);
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

  function detectEyeIris(pixels, w, h, furLabs) {
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
          const [hue, sat, lig] = rgbToHsl(r, g, b);
          const lab = rgbToLab(r, g, b);
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
          candidates.push({ r, g, b, hue, score });
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
    const fy = (lab[0] + 16) / 116, fx = fy + lab[1] / 500, fz = fy - lab[2] / 200;
    const f = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
    const X = 0.95047 * f(fx), Y = f(fy), Z = 1.08883 * f(fz);
    const lin = [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.2040 * Y + 1.0570 * Z];
    const g = lin.map((c) => Math.round(clamp(c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055, 0, 1) * 255));
    return '#' + g.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  function avgBoxRgb(pixels, w, h, x0, y0, x1, y1, bgLabs) {
    const ix0 = clamp(Math.floor(x0 * w), 0, w - 1);
    const ix1 = clamp(Math.ceil(x1 * w), 1, w);
    const iy0 = clamp(Math.floor(y0 * h), 0, h - 1);
    const iy1 = clamp(Math.ceil(y1 * h), 1, h);
    let sr = 0, sg = 0, sb = 0, sw = 0, edgeSum = 0, edgeCnt = 0;
    for (let y = iy0; y < iy1; y++) {
      for (let x = ix0; x < ix1; x++) {
        const i = (y * w + x) * 4;
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        const lab = rgbToLab(r, g, b);
        let minBg = 999;
        for (const bg of bgLabs) {
          const d = labDist(lab, bg);
          if (d < minBg) minBg = d;
        }
        const wt = minBg < 10 ? 0.1 : minBg < 17 ? 0.5 : 1.0;
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
    const rgb = sw > 0 ? [sr / sw, sg / sw, sb / sw] : [128, 128, 128];
    const boxCount = Math.max(1, (ix1 - ix0) * (iy1 - iy0));
    return { rgb, lab: rgbToLab(rgb[0], rgb[1], rgb[2]), edgeEnergy: edgeCnt > 0 ? edgeSum / edgeCnt : 0,
             catShare: sw / boxCount };
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
  function analyzeCatPhoto(imgSource, cropBox, options) {
    const opts = Object.assign({
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
          bgSamples.push({ r: ftPix[i], g: ftPix[i + 1], b: ftPix[i + 2], lab: rgbToLab(ftPix[i], ftPix[i + 1], ftPix[i + 2]), w: 1 });
        }
      }
    }
    const bgClusters = kMeansLab(bgSamples, 3, 14);
    const bgLabs = bgClusters.map((c) => c.lab);

    // 2. Downsample & bilateral-smooth for clean spatial coat block extraction
    const gw = 72, gh = 84;
    const gCanvas = document.createElement('canvas');
    gCanvas.width = gw; gCanvas.height = gh;
    const gCtx = gCanvas.getContext('2d', { willReadFrequently: true });
    gCtx.drawImage(rawCanvas, 0, 0, gw, gh);
    const gRaw = gCtx.getImageData(0, 0, gw, gh).data;
    const smoothPix = bilateralSmooth(gRaw, gw, gh, 2, 34);

    // 3. Foreground cat mask on the 72x84 grid — a GrabCut-style colour-model segmentation (no OpenCV).
    //    Priors: the crop frames the cat (head top-centre, body below), so the crop border is background
    //    and the torso / face core is cat. Fit colour models for both, classify every cell inside the cat
    //    ovals, smooth, keep only what is connected to the core, fill interior holes (eyes, glare), refit
    //    once and classify again. Without this, background next to the cat (grass, sofa, wall) leaked
    //    into the coat colours and became head / ear patches.
    const insideHead = (nx, ny) => ((nx - 0.50) / 0.34) ** 2 + ((ny - 0.33) / 0.23) ** 2 <= 1.0;
    const insideBody = (nx, ny) => ((nx - 0.50) / 0.38) ** 2 + ((ny - 0.74) / 0.25) ** 2 <= 1.0;
    const insideEyeHole = (nx, ny) => {
      const l = ((nx - 0.36) / 0.085) ** 2 + ((ny - 0.32) / 0.065) ** 2 <= 1.0;
      const r = ((nx - 0.64) / 0.085) ** 2 + ((ny - 0.32) / 0.065) ** 2 <= 1.0;
      return l || r;
    };
    const N = gw * gh;
    const pixelLab = new Array(N);
    const inPrior = new Uint8Array(N), inCoreCell = new Uint8Array(N), inFaceCore = new Uint8Array(N), inEye = new Uint8Array(N), onBorder = new Uint8Array(N);
    for (let y = 0; y < gh; y++) {
      const ny = (y + 0.5) / gh;
      for (let x = 0; x < gw; x++) {
        const nx = (x + 0.5) / gw;
        const idx = y * gw + x, i = idx * 4;
        pixelLab[idx] = rgbToLab(smoothPix[i], smoothPix[i + 1], smoothPix[i + 2]);
        inPrior[idx] = insideHead(nx, ny) || insideBody(nx, ny) ? 1 : 0;
        inFaceCore[idx] = ((nx - 0.50) / 0.17) ** 2 + ((ny - 0.37) / 0.09) ** 2 <= 1.0 ? 1 : 0;
        inCoreCell[idx] = (inFaceCore[idx] || ((nx - 0.50) / 0.20) ** 2 + ((ny - 0.60) / 0.22) ** 2 <= 1.0) ? 1 : 0;
        inEye[idx] = insideEyeHole(nx, ny) ? 1 : 0;
        onBorder[idx] = (x < 3 || x >= gw - 3 || y < 2 || y >= gh - 2) ? 1 : 0;
      }
    }
    const cellSample = (idx, w) => {
      const i = idx * 4;
      return { r: smoothPix[i], g: smoothPix[i + 1], b: smoothPix[i + 2], lab: pixelLab[idx], w };
    };
    const minDistTo = (lab, models) => {
      let m = Infinity;
      for (const c of models) { const d = labDist(lab, c); if (d < m) m = d; }
      return m;
    };
    // Face model: the face core is trusted (the user lines the head up with the guide). A minor face
    // colour that matches the crop border is an occluder (grass blades, a hand) and is dropped.
    const faceS = [], borderS = [];
    for (let idx = 0; idx < N; idx++) {
      if (inFaceCore[idx] && !inEye[idx]) faceS.push(cellSample(idx, 1));
      else if (onBorder[idx]) borderS.push(cellSample(idx, 1));
    }
    const rawBorderModel = kMeansLab(borderS, 6, 7).map((c) => c.lab);
    let faceClusters = kMeansLab(faceS, 4, 7);
    const cleanedFace = faceClusters.filter((c) => !(c.ratio < 0.15 && minDistTo(c.lab, rawBorderModel) < 12));
    if (cleanedFace.length) faceClusters = cleanedFace;
    const faceModel = faceClusters.map((c) => c.lab);
    const faceLike = (idx) => minDistTo(pixelLab[idx], faceModel) <= 12;

    // Background = everything reachable from the top edge and the upper part of the side edges by
    // walking across small colour steps (GrabCut-style spatial coherence, without OpenCV). The bottom
    // edge is not a seed — a sitting cat usually runs off the bottom of the crop — and the walk never
    // enters face-coloured cells or the face / torso core, so it stops at the cat's outline.
    const flooded = new Uint8Array(N);
    const fq = new Int32Array(N);
    let fh = 0, ft = 0;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const idx = y * gw + x;
        const seed = y < 2 || ((x < 3 || x >= gw - 3) && y < gh * 0.55);
        if (seed && !inCoreCell[idx] && !faceLike(idx)) { flooded[idx] = 1; fq[ft++] = idx; }
      }
    }
    while (fh < ft) {
      const c = fq[fh++], cx = c % gw, cy = (c - cx) / gw;
      const nbs = [cx > 0 ? c - 1 : -1, cx + 1 < gw ? c + 1 : -1, cy > 0 ? c - gw : -1, cy + 1 < gh ? c + gw : -1];
      for (const nb of nbs) {
        // never into the face / torso core: a white chest or bib often touches the crop sides too
        if (nb < 0 || flooded[nb] || inCoreCell[nb]) continue;
        if (labDist(pixelLab[nb], pixelLab[c]) < 10 && !faceLike(nb)) { flooded[nb] = 1; fq[ft++] = nb; }
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

    // Collect foreground fur samples (excluding eyes)
    const furSamples = [];
    for (let idx = 0; idx < N; idx++) {
      if (!pixelFg[idx] || inEye[idx]) continue;
      furSamples.push({ ...cellSample(idx, inCoreCell[idx] ? 1.3 : 0.75) });
    }

    // 4. Quantize foreground fur into K distinct perceptual coat colors (shadow-tolerant)
    const targetK = clamp(Math.round(opts.colorCount || 3), 2, 5);
    const mergeTol = targetK <= 2 ? 24 : targetK === 3 ? 20 : 15;
    const rawClusters = kMeansLab(furSamples, targetK, mergeTol, true);
    let coatClusters = rawClusters.filter((c) => c.ratio >= 0.045);
    if (coatClusters.length > 1) {
      // A cluster that matches the background model and is (almost) absent from the cat's core is
      // background that slipped past the mask — drop it so it can't become a head / ear patch.
      const coreHits = new Float64Array(coatClusters.length), allHits = new Float64Array(coatClusters.length);
      for (let idx = 0; idx < N; idx++) {
        if (!pixelFg[idx] || inEye[idx]) continue;
        let best = 0, bestD = Infinity;
        for (let c = 0; c < coatClusters.length; c++) {
          const d = coatLabDist(pixelLab[idx], coatClusters[c].lab);
          if (d < bestD) { bestD = d; best = c; }
        }
        allHits[best]++;
        if (inCoreCell[idx]) coreHits[best]++;
      }
      const kept = coatClusters.filter((c, ci) => {
        const coreShare = coreHits[ci] / Math.max(1, allHits[ci]);
        return !(minDistTo(c.lab, bgModelLabs) < 10 && coreShare < 0.12 && c.ratio < 0.5);
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
          const d = coatLabDist(lab, coatClusters[c].lab);
          if (d < bestD) { bestD = d; best = c; }
        }
        labelGrid[y * gw + x] = best;
      }
    }

    // Representative colour of a chromatic coat cluster = its sunlit half (median-and-brighter cells), so
    // body shadows don't drag ginger / cream fur towards brown-grey.
    for (let c = 0; c < coatClusters.length; c++) {
      if (coatClusters[c].chroma <= 14) continue;
      const ls = [];
      for (let idx = 0; idx < N; idx++) if (labelGrid[idx] === c) ls.push(pixelLab[idx][0]);
      if (ls.length < 12) continue;
      ls.sort((a, b) => a - b);
      const medL = ls[Math.floor(ls.length / 2)];
      let r = 0, g = 0, b = 0, n = 0;
      for (let idx = 0; idx < N; idx++) {
        if (labelGrid[idx] !== c || pixelLab[idx][0] < medL) continue;
        const i = idx * 4;
        r += smoothPix[i]; g += smoothPix[i + 1]; b += smoothPix[i + 2]; n++;
      }
      if (n) {
        const rgb = [r / n, g / n, b / n];
        const lab = rgbToLab(rgb[0], rgb[1], rgb[2]);
        coatClusters[c] = { ...coatClusters[c], rgb, lab, hsl: rgbToHsl(rgb[0], rgb[1], rgb[2]), chroma: Math.hypot(lab[1], lab[2]) };
      }
    }

    // Fill eye holes + small interior background holes using nearest labeled neighbor (simple 3-pass dilation)
    for (let pass = 0; pass < 5; pass++) {
      const copy = labelGrid.slice();
      for (let y = 1; y < gh - 1; y++) {
        const ny = (y + 0.5) / gh;
        for (let x = 1; x < gw - 1; x++) {
          const nx = (x + 0.5) / gw;
          const idx = y * gw + x;
          if (copy[idx] >= 0 || (!insideHead(nx, ny) && !insideBody(nx, ny))) continue;
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

    // 6. Inspect Anatomical Zones (ears, muzzle, chest, paws, tabby texture, eyes, nose)
    const leftEarInfo = avgBoxRgb(rawPixels, rawW, rawH, 0.17, 0.03, 0.39, 0.20, bgLabsAll);
    const rightEarInfo = avgBoxRgb(rawPixels, rawW, rawH, 0.61, 0.03, 0.83, 0.20, bgLabsAll);
    const muzzleInfo = avgBoxRgb(rawPixels, rawW, rawH, 0.37, 0.37, 0.63, 0.55, bgLabsAll);
    const chestInfo = avgBoxRgb(rawPixels, rawW, rawH, 0.32, 0.62, 0.68, 0.88, bgLabsAll);
    const pawsInfo = avgBoxRgb(rawPixels, rawW, rawH, 0.30, 0.82, 0.70, 0.96, bgLabsAll);
    const foreheadInfo = avgBoxRgb(rawPixels, rawW, rawH, 0.34, 0.14, 0.66, 0.30, bgLabsAll);
    const noseInfo = avgBoxRgb(rawPixels, rawW, rawH, 0.45, 0.41, 0.55, 0.51, []);
    // Body flanks: light on a Siamese even when its dark mask fills most of a close-up crop,
    // dark on tuxedo / black cats with a white locket (which must never become colour-point).
    const flankL = avgBoxRgb(rawPixels, rawW, rawH, 0.08, 0.62, 0.26, 0.90, bgLabsAll);
    const flankR = avgBoxRgb(rawPixels, rawW, rawH, 0.74, 0.62, 0.92, 0.90, bgLabsAll);
    const flankLight = Math.max(flankL.catShare > 0.4 ? flankL.lab[0] : 0, flankR.catShare > 0.4 ? flankR.lab[0] : 0);

    const nearestCluster = (lab) => {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < adjustedClusters.length; c++) {
        const d = labDist(lab, adjustedClusters[c].lab);
        if (d < bestD) { bestD = d; best = c; }
      }
      return adjustedClusters[best];
    };

    const leftEarCl = nearestCluster(leftEarInfo.lab);
    const rightEarCl = nearestCluster(rightEarInfo.lab);
    const chestCl = nearestCluster(chestInfo.lab);
    const pawsCl = nearestCluster(pawsInfo.lab);
    const baseCl = adjustedClusters[baseIdx];

    // Check if this photo is a true colorpoint (Siamese): light creamy body & forehead + dark muzzle & ears
    // (Requires bright base & forehead so black tuxedo cats with a white chest NEVER trigger colorpoint!)
    const isColorpoint = opts.softColorpoint &&
      (baseCl.lab[0] > 54 || flankLight > 55) &&
      (foreheadInfo.lab[0] > 50 || flankLight > 55) &&
      (chestInfo.lab[0] - muzzleInfo.lab[0]) > 18 &&
      (chestInfo.lab[0] - Math.min(leftEarInfo.lab[0], rightEarInfo.lab[0])) > 14 &&
      chestInfo.lab[0] > 62 && muzzleInfo.lab[0] < 54 &&
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

        for (let ci = 0; ci < Math.min(comps.length, 3); ci++) {
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
      const lightRgb = chestInfo.lab[0] > 66 ? chestInfo.rgb : [244, 236, 224];
      const creamBase = adjustColor(lightRgb, opts.tone);
      const pointCol = adjustColor(muzzleInfo.rgb, opts.tone);
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
      palette.legs = baseCl.hex;
      palette.paws = pawsCl.hex;
      const earsVisible = leftEarInfo.catShare > 0.5 && rightEarInfo.catShare > 0.5;
      palette.earOuter = leftEarInfo.catShare > 0.45 ? leftEarCl.hex : baseCl.hex;
      palette.earInner = baseLum < 0.24
        ? rgbToHex(64, 54, 56)
        : rgbToHex(...mixRgb(leftEarCl.adjRgb, [242, 188, 186], 0.52));

      // Tail uses a prominent non-white coat color if white is the base (e.g. calico/tuxedo), else body color
      const nonWhiteCl = adjustedClusters.find((c) => !(c.lab[0] > 74 && c.chroma < 16));
      palette.tail = (baseLum > 0.78 && nonWhiteCl) ? nonWhiteCl.hex : baseCl.hex;
      if (adjustedClusters.length >= 3 && baseLum > 0.72) {
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
      // Map head grid x in [0.16*gw .. 0.84*gw] -> [-46 .. 46], y in [0..headH] -> [-38 .. 32]
      const headRegions = extractSpaceRegions(
        'head', headY0, headY1,
        (px, py) => ({
          x: ((px / gw) - 0.50) / 0.34 * 46,
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
        Math.max(26, Math.round(gw * headH * 0.022))
      );

      // 7b. Trace real BODY color blocks directly from photo pixels!
      // Map body grid x in [0.12*gw .. 0.88*gw] -> [-52 .. 52], y in [0..bodyH] -> [-104 .. 18]
      const bodyRegions = extractSpaceRegions(
        'body', bodyY0, bodyY1,
        (px, py) => ({
          x: ((px / gw) - 0.50) / 0.38 * 52,
          y: -104 + (py / bodyH) * 124
        }),
        (p) => {
          let x = p.x, y = p.y;
          if (Math.abs(x) > 39) x = Math.sign(x) * (Math.abs(x) + 14);
          if (y < -92) y -= 14;
          if (y > 6) y += 10;
          return { x, y };
        },
        Math.max(32, Math.round(gw * bodyH * 0.026))
      );

      regions.push(...bodyRegions, ...headRegions);

      if (baseLum > 0.78) {
        palette.outline = rgbToHex(182, 166, 148, 0.38);
      }
      shape.bodyWidth = 1.06;
      shape.cheekFullness = 1.06;
    }

    // 8. Optional Tabby Stripes (when fine forehead stripe energy is high)
    const tabbyEnergy = foreheadInfo.edgeEnergy;
    const baseColObj = global.KuroSpec.parseHexColor(palette.body);
    const baseLuminance = baseColObj ? global.KuroSpec.luminance(baseColObj) : 0.5;
    const autoTabby = !isColorpoint && tabbyEnergy > 9.0 && baseLuminance > 0.18 && baseLuminance < 0.78 && regions.length <= 4;
    const shouldAddTabby = opts.addTabby === 'on' || (opts.addTabby === 'auto' && autoTabby);

    if (shouldAddTabby) {
      const refRgb = baseCl.adjRgb;
      const stripeHex = rgbToHex(...shadeRgb(refRgb, baseLuminance > 0.45 ? 0.60 : 0.48));
      palette.stripes = stripeHex;
      marks.push(...makeTabbyForeheadMarks(stripeHex, 0.58));
      marks.push(...makeTailRingMarks(stripeHex, 0.62));
    }

    // 9. Eye Iris, Nose, Mouth, Paw Pads & Contrast-safe Whiskers/Crease
    const furLabs = adjustedClusters.slice(0, 3).map((c) => c.lab);
    const detectedIris = detectEyeIris(rawPixels, rawW, rawH, furLabs);

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

  global.KuroPhotoAnalyzer = {
    analyzeCatPhoto
  };
})(window);
