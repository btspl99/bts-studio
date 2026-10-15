'use strict';
/**
 * Transition library. Each transition renders the blend of A (outgoing) and B (incoming)
 * for progress t ∈ [0,1]. drawA/drawB draw a full frame into the given context.
 */
(function (BTS) {
  const { ease, clamp } = BTS.U;

  const list = [
    { id: 'Cut', name: 'Cut' },
    { id: 'Fade', name: 'Fade' },
    { id: 'Merge', name: 'Merge' },
    { id: 'Zoom', name: 'Zoom' },
    { id: 'CrossZoom', name: 'Cross Zoom' },
    { id: 'Wipe', name: 'Wipe ►' },
    { id: 'WipeLeft', name: 'Wipe ◄' },
    { id: 'WipeDown', name: 'Wipe ▼' },
    { id: 'WipeDiag', name: 'Wipe Diagonal' },
    { id: 'Iris', name: 'Iris (Circle)' },
    { id: 'BarnDoor', name: 'Barn Door' },
    { id: 'Slide', name: 'Slide ►' },
    { id: 'SlideLeft', name: 'Slide ◄' },
    { id: 'SlideUp', name: 'Slide ▲' },
    { id: 'Push', name: 'Push' },
    { id: 'Fly', name: 'Fly' },
    { id: 'Cube', name: 'Cube' },
    { id: 'Flip', name: 'Flip' },
    { id: 'DipBlack', name: 'Dip to Black' },
    { id: 'DipWhite', name: 'Dip to White' },
    { id: 'Blur', name: 'Blur Dissolve' },
    { id: 'Stinger1', name: 'Stinger 1' },
    { id: 'Stinger2', name: 'Stinger 2' }
  ];

  function withAlpha(ctx, a, fn) { ctx.save(); ctx.globalAlpha *= clamp(a, 0, 1); fn(); ctx.restore(); }
  function clipRect(ctx, x, y, w, h, fn) { ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); fn(); ctx.restore(); }
  function scaled(ctx, W, H, s, cx, cy, fn) { ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-cx, -cy); fn(); ctx.restore(); }

  function draw(id, ctx, W, H, t, drawA, drawB, opts = {}) {
    const e = ease.inOut(clamp(t, 0, 1));
    switch (id) {
      case 'Cut':
        (t < 0.5 ? drawA : drawB)(ctx); break;
      case 'Fade':
        drawA(ctx); withAlpha(ctx, t, () => drawB(ctx)); break;
      case 'Merge':
        withAlpha(ctx, 1 - e * 0.35, () => scaled(ctx, W, H, 1 + e * 0.04, W / 2, H / 2, () => drawA(ctx)));
        withAlpha(ctx, e, () => scaled(ctx, W, H, 1.04 - e * 0.04, W / 2, H / 2, () => drawB(ctx))); break;
      case 'Zoom':
        drawA(ctx); withAlpha(ctx, ease.out(t), () => scaled(ctx, W, H, 0.2 + 0.8 * ease.out(t), W / 2, H / 2, () => drawB(ctx))); break;
      case 'CrossZoom': {
        const blurA = e * 12;
        withAlpha(ctx, 1 - e, () => { ctx.filter = `blur(${blurA}px)`; scaled(ctx, W, H, 1 + e * 1.2, W / 2, H / 2, () => drawA(ctx)); ctx.filter = 'none'; });
        withAlpha(ctx, e, () => { ctx.filter = `blur(${(1 - e) * 12}px)`; scaled(ctx, W, H, 2.2 - e * 1.2, W / 2, H / 2, () => drawB(ctx)); ctx.filter = 'none'; });
        break;
      }
      case 'Wipe':
        drawA(ctx); clipRect(ctx, 0, 0, W * e, H, () => drawB(ctx)); break;
      case 'WipeLeft':
        drawA(ctx); clipRect(ctx, W * (1 - e), 0, W * e, H, () => drawB(ctx)); break;
      case 'WipeDown':
        drawA(ctx); clipRect(ctx, 0, 0, W, H * e, () => drawB(ctx)); break;
      case 'WipeDiag': {
        drawA(ctx); ctx.save(); ctx.beginPath();
        const d = (W + H) * e;
        ctx.moveTo(0, 0); ctx.lineTo(d, 0); ctx.lineTo(d - H, H); ctx.lineTo(0, H); ctx.closePath(); ctx.clip(); drawB(ctx); ctx.restore();
        break;
      }
      case 'Iris': {
        drawA(ctx); ctx.save(); ctx.beginPath();
        ctx.arc(W / 2, H / 2, Math.hypot(W, H) / 2 * e, 0, Math.PI * 2); ctx.clip(); drawB(ctx); ctx.restore(); break;
      }
      case 'BarnDoor':
        drawA(ctx); clipRect(ctx, W / 2 - (W / 2) * e, 0, W * e, H, () => drawB(ctx)); break;
      case 'Slide':
        drawA(ctx); ctx.save(); ctx.translate(-W + W * e, 0); drawB(ctx); ctx.restore(); break;
      case 'SlideLeft':
        drawA(ctx); ctx.save(); ctx.translate(W - W * e, 0); drawB(ctx); ctx.restore(); break;
      case 'SlideUp':
        drawA(ctx); ctx.save(); ctx.translate(0, H - H * e); drawB(ctx); ctx.restore(); break;
      case 'Push':
        ctx.save(); ctx.translate(W * e, 0); drawA(ctx); ctx.restore();
        ctx.save(); ctx.translate(-W + W * e, 0); drawB(ctx); ctx.restore(); break;
      case 'Fly': {
        drawA(ctx);
        const s = 0.3 + 0.7 * ease.out(t);
        ctx.save(); ctx.globalAlpha = clamp(t * 3, 0, 1);
        ctx.translate(W * (1 - ease.out(t)) * 0.6 + W / 2, H / 2); ctx.rotate((1 - ease.out(t)) * 0.25); ctx.scale(s, s); ctx.translate(-W / 2, -H / 2);
        ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 40; drawB(ctx); ctx.restore();
        break;
      }
      case 'Cube': {
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
        const xa = W * e;
        ctx.save(); ctx.translate(xa, 0); ctx.transform(1 - e, (e) * 0.08, 0, 1, 0, 0); withAlpha(ctx, 1 - e * 0.5, () => drawA(ctx)); ctx.restore();
        ctx.save(); ctx.transform(e, -(1 - e) * 0.08, 0, 1, 0, (1 - e) * 0.08 * W * 0); withAlpha(ctx, 0.5 + e * 0.5, () => drawB(ctx)); ctx.restore();
        break;
      }
      case 'Flip': {
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
        const sx = Math.cos(e * Math.PI);
        ctx.save(); ctx.translate(W / 2, 0); ctx.scale(Math.abs(sx) || 0.001, 1); ctx.translate(-W / 2, 0);
        (sx > 0 ? drawA : drawB)(ctx); ctx.restore();
        break;
      }
      case 'DipBlack':
      case 'DipWhite': {
        const col = id === 'DipBlack' ? '#000' : '#fff';
        if (t < 0.5) { drawA(ctx); withAlpha(ctx, t * 2, () => { ctx.fillStyle = col; ctx.fillRect(0, 0, W, H); }); }
        else { drawB(ctx); withAlpha(ctx, (1 - t) * 2, () => { ctx.fillStyle = col; ctx.fillRect(0, 0, W, H); }); }
        break;
      }
      case 'Blur': {
        const b = Math.sin(t * Math.PI) * 18;
        ctx.save(); ctx.filter = `blur(${b}px)`; drawA(ctx); ctx.globalAlpha = t; drawB(ctx); ctx.restore();
        break;
      }
      default:
        drawA(ctx); withAlpha(ctx, t, () => drawB(ctx));
    }
  }

  BTS.Transitions = { list, draw, isStinger: (id) => /^Stinger/.test(id) };
})(window.BTS);
