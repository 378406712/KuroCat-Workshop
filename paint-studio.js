/* KuroCat Component Drawing Board (MS-Paint Style + Tablet Pressure + Live 2.5D Preview) */
(function (global) {
  'use strict';

  const Spec = global.KuroSpec;
  const Renderer = global.KuroRenderer;

  const SWATCH_COLORS = [
    '#1C1917', '#4B433F', '#8C847E', '#E5DDD3', '#FAF6EE', '#FFFFFF', '#F3B469', '#D97B34',
    '#8C5222', '#5A3825', '#3B2E28', '#F2A6A6', '#E56B6F', '#7BC47F', '#6CB4EE', '#9B87F5'
  ];

  const PART_CONFIG = {
    head: {
      title: '脸部 (head)',
      hint: '浅灰虚线为眼鼻嘴参考位置，画眼罩、八字脸、腮红或虎斑纹都能精准对齐',
      canMirror: true,
      // part (x, y) -> canvas (cx, cy)
      toCanvas: (p, W, H) => ({ x: W * 0.5 + p.x * 3.6, y: H * 0.52 + p.y * 3.6 }),
      fromCanvas: (c, W, H) => ({ x: (c.x - W * 0.5) / 3.6, y: (c.y - H * 0.52) / 3.6 }),
      scale: 3.6,
      baseFill: (skin) => skin.palette.body
    },
    skull: {
      title: '头顶 (skull)',
      hint: '画刘海、额头 M 纹、头顶帽状花斑，会随 3D 转头自然贴合球面',
      canMirror: true,
      toCanvas: (p, W, H) => ({ x: W * 0.5 + p.x * 3.8, y: H * 0.62 + p.y * 3.8 }),
      fromCanvas: (c, W, H) => ({ x: (c.x - W * 0.5) / 3.8, y: (c.y - H * 0.62) / 3.8 }),
      scale: 3.8,
      baseFill: (skin) => skin.palette.body
    },
    body: {
      title: '身体 (body)',
      hint: '绘制肚皮、围脖、背毛或奶牛斑块，下方虚线对应坐姿底部',
      canMirror: true,
      toCanvas: (p, W, H) => ({ x: W * 0.5 + p.x * 3.1, y: H * 0.78 + p.y * 3.1 }),
      fromCanvas: (c, W, H) => ({ x: (c.x - W * 0.5) / 3.1, y: (c.y - H * 0.78) / 3.1 }),
      scale: 3.1,
      baseFill: (skin) => skin.palette.body
    },
    leftEar: {
      title: '左耳 (leftEar)',
      hint: '三角形内为左耳区域，开启「左右对称」会自动同步到右耳',
      canMirror: true,
      toCanvas: (p, W, H) => ({ x: W * 0.5 + p.x * 3.4, y: H * 0.84 + p.y * 3.4 }),
      fromCanvas: (c, W, H) => ({ x: (c.x - W * 0.5) / 3.4, y: (c.y - H * 0.84) / 3.4 }),
      scale: 3.4,
      baseFill: (skin) => skin.palette.earOuter
    },
    rightEar: {
      title: '右耳 (rightEar)',
      hint: '三角形内为右耳区域，开启「左右对称」会自动同步到左耳',
      canMirror: true,
      toCanvas: (p, W, H) => ({ x: W * 0.5 + p.x * 3.4, y: H * 0.84 + p.y * 3.4 }),
      fromCanvas: (c, W, H) => ({ x: (c.x - W * 0.5) / 3.4, y: (c.y - H * 0.84) / 3.4 }),
      scale: 3.4,
      baseFill: (skin) => skin.palette.earOuter
    },
    leftArm: {
      title: '左胳膊 (leftArm)',
      hint: '上方为肩部、下方为爪子；横着画即可画出胳膊条纹，切到「抬手打字」看动态弯曲',
      canMirror: true,
      // Vertical arm layout: part.x (0..100 shoulder->wrist) maps to canvas Y; part.y (-10..10) maps to canvas X
      toCanvas: (p, W, H) => ({ x: W * 0.5 - p.y * 8.5, y: 50 + (p.x / 100) * (H - 100) }),
      fromCanvas: (c, W, H) => ({ x: ((c.y - 50) / (H - 100)) * 100, y: (W * 0.5 - c.x) / 8.5 }),
      scale: 4.0,
      baseFill: (skin) => skin.palette.legs
    },
    rightArm: {
      title: '右胳膊 (rightArm)',
      hint: '上方为肩部、下方为爪子；开启「左右对称」会自动镜像到左胳膊',
      canMirror: true,
      toCanvas: (p, W, H) => ({ x: W * 0.5 + p.y * 8.5, y: 50 + (p.x / 100) * (H - 100) }),
      fromCanvas: (c, W, H) => ({ x: ((c.y - 50) / (H - 100)) * 100, y: (c.x - W * 0.5) / 8.5 }),
      scale: 4.0,
      baseFill: (skin) => skin.palette.legs
    },
    tail: {
      title: '尾巴 (tail)',
      hint: '左侧为尾根、右侧为尾尖；竖着画即可轻松画出尾巴环纹',
      canMirror: false,
      toCanvas: (p, W, H) => ({ x: 56 + (p.x / 100) * (W - 112), y: H * 0.5 + p.y * 7.8 }),
      fromCanvas: (c, W, H) => ({ x: ((c.x - 56) / (W - 112)) * 100, y: (c.y - H * 0.5) / 7.8 }),
      scale: 4.2,
      baseFill: (skin) => skin.palette.tail
    }
  };

  const paintCanvas = document.getElementById('paint-canvas');
  const previewCanvas = document.getElementById('paint-preview-canvas');
  if (!paintCanvas || !previewCanvas) return;

  const pctx = paintCanvas.getContext('2d');
  const rctx = previewCanvas.getContext('2d');

  let active = false;
  let rafId = 0;
  let currentPart = 'head';
  let currentTool = 'brush'; // brush | fillBrush | line | ellipse | rect | bucket | eraser | eyedropper
  let brushColor = '#3B2E28';
  let brushSize = 3.5;
  let brushAlpha = 1.0;
  let mirrorEnabled = true;
  let pressureEnabled = true;
  let gridEnabled = true;
  let previewPose = 'idle';

  let drawing = false;
  let draftPoints = [];
  let draftPressures = [];
  let shapeStart = null;
  let shapeCur = null;
  let erasedAny = false;

  const previewState = Renderer.createDefaultState();
  let lastTick = performance.now();

  const API = () => global.KuroWorkshopAPI;
  const clamp = Spec.clamp;
  const round2 = Spec.round2;

  function tracePartClipPath(ctx, part, W, H) {
    const cfg = PART_CONFIG[part];
    const T = (x, y) => cfg.toCanvas({ x, y }, W, H);
    ctx.beginPath();
    if (part === 'head' || part === 'skull') {
      const c = T(0, 0);
      const rx = 44 * cfg.scale;
      const ry = 38 * cfg.scale;
      ctx.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI * 2);
    } else if (part === 'body') {
      const topL = T(-42, -74), topR = T(42, -74);
      const hipR = T(52, -14), botR = T(36, 12), botL = T(-36, 12), hipL = T(-52, -14);
      ctx.moveTo(topL.x, topL.y);
      ctx.lineTo(topR.x, topR.y);
      ctx.quadraticCurveTo(T(54, -46).x, T(54, -46).y, hipR.x, hipR.y);
      ctx.quadraticCurveTo(T(48, 8).x, T(48, 8).y, botR.x, botR.y);
      ctx.lineTo(botL.x, botL.y);
      ctx.quadraticCurveTo(T(-48, 8).x, T(-48, 8).y, hipL.x, hipL.y);
      ctx.quadraticCurveTo(T(-54, -46).x, T(-54, -46).y, topL.x, topL.y);
      ctx.closePath();
    } else if (part === 'leftEar' || part === 'rightEar') {
      const inB = T(-50, 0), outB = T(50, 0), tip = T(0, -100);
      ctx.moveTo(inB.x, inB.y);
      ctx.quadraticCurveTo(T(-34, -55).x, T(-34, -55).y, tip.x, tip.y);
      ctx.quadraticCurveTo(T(34, -55).x, T(34, -55).y, outB.x, outB.y);
      ctx.closePath();
    } else if (part === 'leftArm' || part === 'rightArm') {
      const tl = T(0, -10), tr = T(0, 10), br = T(100, 9), bl = T(100, -9);
      const xMin = Math.min(tl.x, tr.x), xMax = Math.max(tl.x, tr.x);
      const yTop = tl.y, yBot = bl.y;
      const r = (xMax - xMin) * 0.45;
      ctx.moveTo(xMin, yTop + r * 0.4);
      ctx.quadraticCurveTo(xMin, yTop, (xMin + xMax) * 0.5, yTop);
      ctx.quadraticCurveTo(xMax, yTop, xMax, yTop + r * 0.4);
      ctx.lineTo(xMax, yBot - r * 0.4);
      ctx.quadraticCurveTo(xMax, yBot, (xMin + xMax) * 0.5, yBot);
      ctx.quadraticCurveTo(xMin, yBot, xMin, yBot - r * 0.4);
      ctx.closePath();
    } else if (part === 'tail') {
      const l = T(0, 0), r = T(100, 0);
      const halfH = 78;
      ctx.moveTo(l.x, l.y - halfH);
      ctx.lineTo(r.x - halfH, r.y - halfH);
      ctx.arc(r.x - halfH, r.y, halfH, -Math.PI * 0.5, Math.PI * 0.5);
      ctx.lineTo(l.x, l.y + halfH);
      ctx.closePath();
    }
  }

  function drawReferenceGuides(ctx, part, W, H) {
    const cfg = PART_CONFIG[part];
    const T = (x, y) => cfg.toCanvas({ x, y }, W, H);
    ctx.save();
    ctx.strokeStyle = 'rgba(28, 25, 23, 0.28)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 4]);

    if (part === 'head') {
      // Eye + nose + mouth guides so user knows exact facial landmarks
      const le = T(-17, -2), re = T(17, -2), nose = T(0, 11);
      ctx.beginPath();
      ctx.ellipse(le.x, le.y, 11 * cfg.scale, 10 * cfg.scale, 0, 0, Math.PI * 2);
      ctx.ellipse(re.x, re.y, 11 * cfg.scale, 10 * cfg.scale, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(230, 130, 130, 0.45)';
      ctx.beginPath();
      ctx.arc(nose.x, nose.y, 5, 0, Math.PI * 2);
      ctx.fill();
      // Center symmetry line
      ctx.strokeStyle = 'rgba(224, 122, 61, 0.25)';
      ctx.beginPath();
      ctx.moveTo(W * 0.5, 24);
      ctx.lineTo(W * 0.5, H - 24);
      ctx.stroke();
    } else if (part === 'skull' || part === 'body') {
      ctx.strokeStyle = 'rgba(224, 122, 61, 0.25)';
      ctx.beginPath();
      ctx.moveTo(W * 0.5, 24);
      ctx.lineTo(W * 0.5, H - 24);
      ctx.stroke();
    } else if (part === 'leftArm' || part === 'rightArm') {
      const yFade = T(20, 0).y;
      const yCuff = T(72, 0).y;
      ctx.beginPath();
      ctx.moveTo(W * 0.5 - 100, yFade);
      ctx.lineTo(W * 0.5 + 100, yFade);
      ctx.moveTo(W * 0.5 - 100, yCuff);
      ctx.lineTo(W * 0.5 + 100, yCuff);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(120, 113, 108, 0.85)';
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText('▲ 肩部渐变区', W * 0.5 + 106, yFade - 4);
      ctx.fillText('▼ 白手套 / 爪子区', W * 0.5 + 106, yCuff + 14);
    } else if (part === 'tail') {
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(120, 113, 108, 0.85)';
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText('尾根', 20, H * 0.5 + 4);
      ctx.fillText('尾尖', W - 44, H * 0.5 + 4);
    }
    ctx.restore();
  }

  function renderBoard() {
    const api = API();
    if (!api) return;
    const skin = api.getResolvedSkin();
    if (!skin) return;

    const W = paintCanvas.width, H = paintCanvas.height;
    const cfg = PART_CONFIG[currentPart];
    const map = (pt) => cfg.toCanvas(pt, W, H);

    pctx.clearRect(0, 0, W, H);

    // Subtle paper background + optional grid
    pctx.fillStyle = '#FFFFFF';
    pctx.fillRect(0, 0, W, H);
    if (gridEnabled) {
      pctx.save();
      pctx.strokeStyle = 'rgba(28, 25, 23, 0.05)';
      pctx.lineWidth = 1;
      for (let x = 20; x < W; x += 20) {
        pctx.beginPath(); pctx.moveTo(x, 0); pctx.lineTo(x, H); pctx.stroke();
      }
      for (let y = 20; y < H; y += 20) {
        pctx.beginPath(); pctx.moveTo(0, y); pctx.lineTo(W, y); pctx.stroke();
      }
      pctx.restore();
    }

    // Clipped part interior: base color + existing regions + marks
    pctx.save();
    tracePartClipPath(pctx, currentPart, W, H);
    pctx.fillStyle = Spec.rgbaToCss(cfg.baseFill(skin));
    pctx.fill();
    pctx.clip();

    for (const r of (skin.regions || [])) {
      if (r.space !== currentPart) continue;
      const flat = r.flat || Spec.flattenRegion(r.anchors);
      if (flat.length < 3) continue;
      pctx.beginPath();
      const p0 = map(flat[0]);
      pctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < flat.length; i++) {
        const pi = map(flat[i]);
        pctx.lineTo(pi.x, pi.y);
      }
      pctx.closePath();
      pctx.fillStyle = Spec.rgbaToCss(r.fill);
      pctx.fill();
    }

    for (const mk of (skin.marks || [])) {
      if (mk.space !== currentPart || !mk.points || mk.points.length < 2) continue;
      pctx.beginPath();
      const p0 = map(mk.points[0]);
      pctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < mk.points.length; i++) {
        const pi = map(mk.points[i]);
        pctx.lineTo(pi.x, pi.y);
      }
      if (mk.kind === 'fill') {
        pctx.closePath();
        pctx.fillStyle = Spec.rgbaToCss(mk.color);
        pctx.fill();
      } else {
        pctx.strokeStyle = Spec.rgbaToCss(mk.color);
        pctx.lineWidth = Math.max(2, mk.width * cfg.scale * 0.9);
        pctx.lineCap = 'round';
        pctx.lineJoin = 'round';
        pctx.stroke();
      }
    }

    // Live in-progress stroke / shape preview
    if (drawing) {
      pctx.save();
      pctx.globalAlpha = brushAlpha;
      pctx.strokeStyle = brushColor;
      pctx.fillStyle = brushColor;
      pctx.lineCap = 'round';
      pctx.lineJoin = 'round';
      if (currentTool === 'brush' && draftPoints.length >= 2) {
        pctx.lineWidth = Math.max(2, effectiveBrushSize() * cfg.scale * 0.9);
        pctx.beginPath();
        const s0 = map(draftPoints[0]);
        pctx.moveTo(s0.x, s0.y);
        for (let i = 1; i < draftPoints.length; i++) {
          const si = map(draftPoints[i]);
          pctx.lineTo(si.x, si.y);
        }
        pctx.stroke();
      } else if (currentTool === 'fillBrush' && draftPoints.length >= 3) {
        pctx.beginPath();
        const s0 = map(draftPoints[0]);
        pctx.moveTo(s0.x, s0.y);
        for (let i = 1; i < draftPoints.length; i++) {
          const si = map(draftPoints[i]);
          pctx.lineTo(si.x, si.y);
        }
        pctx.closePath();
        pctx.fill();
      } else if (currentTool === 'line' && shapeStart && shapeCur) {
        pctx.lineWidth = Math.max(2, brushSize * cfg.scale * 0.9);
        const a = map(shapeStart), b = map(shapeCur);
        pctx.beginPath();
        pctx.moveTo(a.x, a.y);
        pctx.lineTo(b.x, b.y);
        pctx.stroke();
      } else if ((currentTool === 'ellipse' || currentTool === 'rect') && shapeStart && shapeCur) {
        const a = map(shapeStart), b = map(shapeCur);
        pctx.beginPath();
        if (currentTool === 'rect') {
          pctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        } else {
          pctx.ellipse((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, Math.abs(b.x - a.x) * 0.5, Math.abs(b.y - a.y) * 0.5, 0, 0, Math.PI * 2);
        }
        pctx.fill();
      }
      pctx.restore();
    }

    pctx.restore();

    // Part outer dashed border
    pctx.save();
    tracePartClipPath(pctx, currentPart, W, H);
    pctx.strokeStyle = 'rgba(28, 25, 23, 0.42)';
    pctx.lineWidth = 2;
    pctx.setLineDash([6, 4]);
    pctx.stroke();
    pctx.restore();

    drawReferenceGuides(pctx, currentPart, W, H);
  }

  function effectiveBrushSize() {
    if (!pressureEnabled || !draftPressures.length) return brushSize;
    const avg = draftPressures.reduce((a, b) => a + b, 0) / draftPressures.length;
    return clamp(round2(brushSize * (0.45 + avg * 1.15)), 0.8, 14);
  }

  function simplifyPoints(pts, minDist) {
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const prev = out[out.length - 1];
      if (Math.hypot(pts[i].x - prev.x, pts[i].y - prev.y) >= minDist) out.push(pts[i]);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  function getBoardPos(e) {
    const rect = paintCanvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * paintCanvas.width,
      y: ((e.clientY - rect.top) / rect.height) * paintCanvas.height
    };
  }

  function pushMark(markObj) {
    const raw = API().getRawSkin();
    raw.marks = raw.marks || [];
    raw.marks.push(markObj);
    if (mirrorEnabled && PART_CONFIG[currentPart].canMirror && Spec.canMirror(currentPart)) {
      raw.marks.push(Spec.mirrorMark(markObj));
    }
  }

  function pushRegion(regObj) {
    const raw = API().getRawSkin();
    raw.regions = raw.regions || [];
    raw.regions.push(regObj);
    if (mirrorEnabled && PART_CONFIG[currentPart].canMirror && Spec.canMirror(currentPart)) {
      raw.regions.push(Spec.mirrorRegion(regObj));
    }
  }

  function eraseAt(partPt) {
    const raw = API().getRawSkin();
    const radius = Math.max(4, brushSize * 1.6);
    const spacesToCheck = [currentPart];
    const mirrorPair = { leftEar: 'rightEar', rightEar: 'leftEar', leftArm: 'rightArm', rightArm: 'leftArm' };
    if (mirrorEnabled && mirrorPair[currentPart]) spacesToCheck.push(mirrorPair[currentPart]);

    let changed = false;
    if (raw.marks && raw.marks.length) {
      const nextMarks = raw.marks.filter((m) => {
        if (!spacesToCheck.includes(m.space)) return true;
        const pts = (m.points || []).map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p));
        const hit = pts.some((p) => Math.hypot(p.x - partPt.x, p.y - partPt.y) <= radius ||
          (mirrorEnabled && m.space === currentPart && !mirrorPair[currentPart] && Math.hypot(-p.x - partPt.x, p.y - partPt.y) <= radius));
        if (hit) changed = true;
        return !hit;
      });
      raw.marks = nextMarks;
    }

    if (raw.regions && raw.regions.length) {
      const nextRegs = raw.regions.filter((r) => {
        if (!spacesToCheck.includes(r.space)) return true;
        const flat = Spec.flattenRegion(r.anchors || []);
        const hit = Spec.pointInPolygon(partPt, flat) ||
          (mirrorEnabled && r.space === currentPart && !mirrorPair[currentPart] && Spec.pointInPolygon({ x: -partPt.x, y: partPt.y }, flat));
        if (hit) changed = true;
        return !hit;
      });
      raw.regions = nextRegs;
    }

    if (changed) {
      erasedAny = true;
      API().syncSkin(false);
      renderBoard();
    }
  }

  function applyBucketFill(ppos) {
    const raw = API().getRawSkin();
    const c = brushColor.toUpperCase();
    if (ppos && raw.marks && raw.marks.length) {
      for (let i = raw.marks.length - 1; i >= 0; i--) {
        const m = raw.marks[i];
        if (!m || m.space !== currentPart || !m.points || !m.points.length) continue;
        let hit = false;
        if (m.kind === 'polygon' && m.points.length >= 3) {
          hit = Spec.pointInPolygon(ppos, m.points.map((p) => ({ x: p[0], y: p[1] })));
        } else {
          const tol = Math.max(3.5, (m.width || 2) * 0.65);
          for (let j = 0; j < m.points.length; j++) {
            if (Math.hypot(m.points[j][0] - ppos.x, m.points[j][1] - ppos.y) <= tol) { hit = true; break; }
          }
        }
        if (hit) {
          m.color = c;
          API().syncSkin(true);
          renderBoard();
          API().showToast(`已将自绘笔触/色块改色为 ${c}`);
          return;
        }
      }
    }
    raw.palette = raw.palette || {};
    if (currentPart === 'leftEar' || currentPart === 'rightEar') {
      raw.palette.earOuter = c;
    } else if (currentPart === 'leftArm' || currentPart === 'rightArm') {
      raw.palette.legs = c;
      raw.idleLegs = 'legs';
    } else if (currentPart === 'tail') {
      raw.palette.tail = c;
    } else {
      raw.palette.body = c;
    }
    API().syncSkin(true);
    renderBoard();
    API().showToast(`已填充「${PART_CONFIG[currentPart].title}」底色为 ${c}`);
  }

  function pickEyedropper(canvasPt) {
    const px = pctx.getImageData(clamp(Math.round(canvasPt.x), 0, paintCanvas.width - 1), clamp(Math.round(canvasPt.y), 0, paintCanvas.height - 1), 1, 1).data;
    const hex = Spec.rgbToHex(px[0], px[1], px[2]);
    setBrushColor(hex);
    setTool('brush');
    API().showToast(`已吸取颜色 ${hex}`);
  }

  function updateTabletBadge(e) {
    const badge = document.getElementById('paint-tablet-badge');
    if (!badge) return;
    if (e.pointerType === 'pen') {
      const pct = Math.round(clamp(e.pressure || 0.5, 0, 1) * 100);
      badge.textContent = `数位板压感已连接 · ${pct}%`;
      badge.classList.add('pen-active');
    } else {
      badge.textContent = '鼠标 / 触控绘图';
      badge.classList.remove('pen-active');
    }
  }

  paintCanvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    updateTabletBadge(e);
    const cpos = getBoardPos(e);
    const ppos = PART_CONFIG[currentPart].fromCanvas(cpos, paintCanvas.width, paintCanvas.height);

    if (currentTool === 'bucket') {
      applyBucketFill(ppos);
      return;
    }
    if (currentTool === 'eyedropper') {
      pickEyedropper(cpos);
      return;
    }

    drawing = true;
    erasedAny = false;
    paintCanvas.setPointerCapture(e.pointerId);

    if (currentTool === 'eraser') {
      eraseAt(ppos);
      return;
    }

    if (currentTool === 'brush' || currentTool === 'fillBrush') {
      draftPoints = [ppos];
      draftPressures = [e.pointerType === 'pen' ? clamp(e.pressure || 0.5, 0.05, 1) : 0.5];
    } else {
      shapeStart = ppos;
      shapeCur = ppos;
    }
    renderBoard();
  });

  paintCanvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    e.preventDefault();
    updateTabletBadge(e);
    const cpos = getBoardPos(e);
    const ppos = PART_CONFIG[currentPart].fromCanvas(cpos, paintCanvas.width, paintCanvas.height);

    if (currentTool === 'eraser') {
      eraseAt(ppos);
      return;
    }
    if (currentTool === 'brush' || currentTool === 'fillBrush') {
      const last = draftPoints[draftPoints.length - 1];
      if (!last || Math.hypot(ppos.x - last.x, ppos.y - last.y) >= 1.2) {
        draftPoints.push(ppos);
        draftPressures.push(e.pointerType === 'pen' ? clamp(e.pressure || 0.5, 0.05, 1) : 0.5);
      }
    } else {
      shapeCur = ppos;
    }
    renderBoard();
  });

  function finishStroke() {
    if (!drawing) return;
    drawing = false;

    if (currentTool === 'eraser') {
      if (erasedAny) API().syncSkin(true);
      renderBoard();
      return;
    }

    if (currentTool === 'brush' && draftPoints.length >= 2) {
      const pts = simplifyPoints(draftPoints, 2.2).slice(0, 60).map((p) => [round2(p.x), round2(p.y)]);
      pushMark({
        space: currentPart,
        kind: 'stroke',
        color: brushColor.toUpperCase(),
        alpha: round2(brushAlpha),
        width: effectiveBrushSize(),
        points: pts
      });
      API().syncSkin(true);
    } else if (currentTool === 'fillBrush' && draftPoints.length >= 3) {
      const pts = simplifyPoints(draftPoints, 3.0).slice(0, 64).map((p) => ({ x: round2(p.x), y: round2(p.y) }));
      if (pts.length >= 3) {
        pushRegion({
          _label: `画板色块 (${currentPart})`,
          space: currentPart,
          fill: brushColor.toUpperCase(),
          alpha: round2(brushAlpha),
          anchors: pts
        });
        API().syncSkin(true);
      }
    } else if (currentTool === 'line' && shapeStart && shapeCur && Math.hypot(shapeCur.x - shapeStart.x, shapeCur.y - shapeStart.y) >= 1.5) {
      pushMark({
        space: currentPart,
        kind: 'stroke',
        color: brushColor.toUpperCase(),
        alpha: round2(brushAlpha),
        width: round2(brushSize),
        points: [[round2(shapeStart.x), round2(shapeStart.y)], [round2(shapeCur.x), round2(shapeCur.y)]]
      });
      API().syncSkin(true);
    } else if ((currentTool === 'rect' || currentTool === 'ellipse') && shapeStart && shapeCur) {
      const x0 = Math.min(shapeStart.x, shapeCur.x), x1 = Math.max(shapeStart.x, shapeCur.x);
      const y0 = Math.min(shapeStart.y, shapeCur.y), y1 = Math.max(shapeStart.y, shapeCur.y);
      if (x1 - x0 >= 1.5 && y1 - y0 >= 1.5) {
        let anchors;
        if (currentTool === 'rect') {
          anchors = [
            { x: round2(x0), y: round2(y0) },
            { x: round2(x1), y: round2(y0) },
            { x: round2(x1), y: round2(y1) },
            { x: round2(x0), y: round2(y1) }
          ];
        } else {
          const cx = (x0 + x1) * 0.5, cy = (y0 + y1) * 0.5;
          const rx = (x1 - x0) * 0.5, ry = (y1 - y0) * 0.5;
          anchors = [];
          for (let i = 0; i < 16; i++) {
            const ang = (i / 16) * Math.PI * 2;
            anchors.push({ x: round2(cx + Math.cos(ang) * rx), y: round2(cy + Math.sin(ang) * ry) });
          }
        }
        pushRegion({
          _label: currentTool === 'rect' ? `矩形 (${currentPart})` : `椭圆 (${currentPart})`,
          space: currentPart,
          fill: brushColor.toUpperCase(),
          alpha: round2(brushAlpha),
          anchors
        });
        API().syncSkin(true);
      }
    }

    draftPoints = [];
    draftPressures = [];
    shapeStart = null;
    shapeCur = null;
    renderBoard();
  }

  paintCanvas.addEventListener('pointerup', finishStroke);
  paintCanvas.addEventListener('pointercancel', finishStroke);

  // --- UI Bindings ---
  function setPart(part) {
    if (!PART_CONFIG[part]) return;
    currentPart = part;
    document.querySelectorAll('#paint-part-tabs .paint-part-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.part === part);
    });
    document.getElementById('paint-part-title').textContent = PART_CONFIG[part].title;
    document.getElementById('paint-part-hint').textContent = PART_CONFIG[part].hint;
    renderBoard();
  }

  function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll('#paint-tool-grid .paint-tool-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.tool === tool);
    });
    paintCanvas.style.cursor = tool === 'bucket' ? 'cell' : tool === 'eyedropper' ? 'copy' : 'crosshair';
  }

  function setBrushColor(hex) {
    brushColor = hex;
    const inp = document.getElementById('paint-color');
    if (inp) inp.value = hex.slice(0, 7);
    document.querySelectorAll('#paint-swatches .paint-swatch').forEach((s) => {
      s.classList.toggle('active', s.dataset.color.toUpperCase() === hex.slice(0, 7).toUpperCase());
    });
  }

  document.getElementById('paint-part-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-part]');
    if (btn) setPart(btn.dataset.part);
  });

  document.getElementById('paint-tool-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tool]');
    if (btn) setTool(btn.dataset.tool);
  });

  const swatchesWrap = document.getElementById('paint-swatches');
  SWATCH_COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'paint-swatch' + (c.toUpperCase() === brushColor.toUpperCase() ? ' active' : '');
    b.dataset.color = c;
    b.style.background = c;
    b.title = c;
    b.addEventListener('click', () => setBrushColor(c));
    swatchesWrap.appendChild(b);
  });

  document.getElementById('paint-color').addEventListener('input', (e) => setBrushColor(e.target.value));
  document.getElementById('paint-size').addEventListener('input', (e) => {
    brushSize = parseFloat(e.target.value);
    document.getElementById('paint-size-val').textContent = brushSize.toFixed(1);
  });
  document.getElementById('paint-alpha').addEventListener('input', (e) => {
    brushAlpha = parseFloat(e.target.value);
    document.getElementById('paint-alpha-val').textContent = `${Math.round(brushAlpha * 100)}%`;
  });
  document.getElementById('paint-mirror').addEventListener('change', (e) => { mirrorEnabled = e.target.checked; });
  document.getElementById('paint-pressure').addEventListener('change', (e) => { pressureEnabled = e.target.checked; });
  document.getElementById('paint-grid').addEventListener('change', (e) => { gridEnabled = e.target.checked; renderBoard(); });

  document.getElementById('paint-btn-undo').addEventListener('click', () => {
    API().undo();
    renderBoard();
  });

  document.getElementById('paint-btn-clear-part').addEventListener('click', () => {
    const raw = API().getRawSkin();
    raw.marks = (raw.marks || []).filter((m) => m.space !== currentPart);
    raw.regions = (raw.regions || []).filter((r) => r.space !== currentPart);
    API().syncSkin(true);
    renderBoard();
    API().showToast(`已清空「${PART_CONFIG[currentPart].title}」上的画作`);
  });

  document.getElementById('paint-preview-poses').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-paint-pose]');
    if (!btn) return;
    previewPose = btn.dataset.paintPose;
    document.querySelectorAll('#paint-preview-poses [data-paint-pose]').forEach((b) => {
      b.classList.toggle('active', b === btn);
    });
  });

  // --- Live 2.5D Preview Loop ---
  function tickPreview(now) {
    if (!active) return;
    const dt = Math.min(0.05, (now - lastTick) / 1000);
    lastTick = now;

    previewState.time += dt;
    const t = previewState.time;

    previewState.isDragging = previewPose === 'drag';
    previewState.lieIntensity = previewPose === 'sleep' ? 1.0 : 0.0;
    previewState.eyeClose = previewPose === 'sleep' ? 1.0 : ((t % 4.2) > 4.05 ? 1.0 : 0.0);
    previewState.headYaw = Math.sin(t * 0.9) * 0.28;
    previewState.headPitch = previewPose === 'sleep' ? 0.25 : Math.cos(t * 0.7) * 0.10;

    if (previewPose === 'typing') {
      const beat = Math.sin(t * 7.5);
      previewState.leftPawActive = true;
      previewState.rightPawActive = true;
      previewState.leftPaw = { x: 142 + Math.sin(t * 3.8) * 14, y: 244 + (beat > 0 ? 10 : -4) };
      previewState.rightPaw = { x: 222 + Math.cos(t * 4.2) * 14, y: 244 + (beat <= 0 ? 10 : -4) };
    } else {
      previewState.leftPawActive = false;
      previewState.rightPawActive = false;
      previewState.leftPaw = { ...Renderer.LEFT_PAW_REST };
      previewState.rightPaw = { ...Renderer.RIGHT_PAW_REST };
    }

    const api = API();
    const skin = api && api.getResolvedSkin();
    if (skin) {
      rctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
      Renderer.renderCat(rctx, skin, previewState, {
        keyboardTheme: api.getKeyboardThemeId ? api.getKeyboardThemeId() : 'classicMilk',
        eyeTheme: api.getEyeTheme ? api.getEyeTheme() : 'warmAmber',
        whiteOutline: true
      });
    }

    rafId = requestAnimationFrame(tickPreview);
  }

  global.KuroPaintStudio = {
    onEnter() {
      active = true;
      lastTick = performance.now();
      renderBoard();
      if (!rafId) rafId = requestAnimationFrame(tickPreview);
    },
    onLeave() {
      active = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    },
    refresh() {
      if (active) renderBoard();
    }
  };
})(window);
