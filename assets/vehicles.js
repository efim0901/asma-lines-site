/* ============================================================
   ASMA Lines — vehicle illustration factory
   ------------------------------------------------------------
   Renders side-view vehicle SVGs for the driving marker in the
   calculator. Chosen from a matrix of:
     weightClass : xs | s | m | l | xl   (5 ranges)
     cargoType   : standard | fragile | temperature
     variant     : 0..4 (5 distinct body shapes per class)
   → 5 × 5 = 25 shapes, × 3 cargo themes = 75 visuals.
   The caller picks a random variant each time weight / cargo
   changes, so the animation is different on every recalculation.
   ============================================================ */
(function () {
  'use strict';

  /* --- 5 cab colour palettes ---------------------------------- */
  const PALETTES = [
    { cab: '#1F1D1A', cabDark: '#0A0908', cabWin: 'rgba(160,190,210,.55)' }, // graphite
    { cab: '#8B2536', cabDark: '#4E1521', cabWin: 'rgba(180,205,225,.55)' }, // burgundy
    { cab: '#243B4A', cabDark: '#122330', cabWin: 'rgba(170,200,220,.55)' }, // navy
    { cab: '#3A2E1F', cabDark: '#1F1810', cabWin: 'rgba(180,200,210,.5)'  }, // bronze
    { cab: '#D8D4C8', cabDark: '#8A867A', cabWin: 'rgba(140,170,190,.6)'  }, // ivory
  ];

  /* --- 3 cargo themes ----------------------------------------- */
  const CARGO = {
    standard: {
      box: '#E8E4D8', boxDark: '#C0BCB0', boxEdge: '#8A867A',
      stripe: null, badge: null, reefer: false,
    },
    fragile: {
      box: '#F0DFB8', boxDark: '#D4BC88', boxEdge: '#A07020',
      stripe: '#B8860B', badge: 'fragile', reefer: false,
    },
    temperature: {
      box: '#C8DCE8', boxDark: '#95B5CB', boxEdge: '#4A7A9A',
      stripe: '#4A7A9A', badge: 'snowflake', reefer: true,
    },
  };

  /* --- low-level SVG helpers ---------------------------------- */
  function shadow(cx, rx) {
    return `<ellipse cx="${cx}" cy="52" rx="${rx}" ry="2.2" fill="rgba(0,0,0,.45)"/>`;
  }
  function wheel(cx, r) {
    r = r || 5.5;
    return `<circle cx="${cx}" cy="46" r="${r}" fill="#0A0908"/>` +
           `<circle cx="${cx}" cy="46" r="${r * 0.42}" fill="#5A5754"/>`;
  }
  function badge(kind, x, y) {
    if (kind === 'fragile') {
      return `<g transform="translate(${x} ${y})" stroke="#5A3A0A" fill="none" ` +
             `stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">` +
             `<rect x="-3.4" y="-5" width="6.8" height="10" rx=".5"/>` +
             `<path d="M-1.6 -2.6 L-1.6 .8 L0 2.8 L1.6 .8 L1.6 -2.6"/></g>`;
    }
    if (kind === 'snowflake') {
      return `<g transform="translate(${x} ${y})" stroke="#1A3A4A" ` +
             `stroke-width="1.1" stroke-linecap="round">` +
             `<line x1="-3.4" y1="0" x2="3.4" y2="0"/>` +
             `<line x1="0" y1="-3.4" x2="0" y2="3.4"/>` +
             `<line x1="-2.4" y1="-2.4" x2="2.4" y2="2.4"/>` +
             `<line x1="-2.4" y1="2.4" x2="2.4" y2="-2.4"/></g>`;
    }
    return '';
  }

  /* --- trailer body builders ---------------------------------- */
  function boxBody(c, x, y, w, h) {
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c.box}" ` +
            `stroke="${c.boxEdge}" stroke-width=".8"/>`;
    s += `<rect x="${x}" y="${y}" width="2.4" height="${h}" fill="${c.boxDark}" opacity=".7"/>`;
    if (c.stripe) s += `<rect x="${x}" y="${y + h - 5}" width="${w}" height="3" fill="${c.stripe}" opacity=".9"/>`;
    if (c.reefer) s += `<rect x="${x + 2}" y="${y - 4}" width="11" height="5" rx="1" ` +
                       `fill="${c.boxDark}" stroke="${c.boxEdge}" stroke-width=".7"/>`;
    if (c.badge && w > 22) s += badge(c.badge, x + w / 2, y + h / 2);
    return s;
  }
  function curtainBody(c, x, y, w, h) {
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c.box}" ` +
            `stroke="${c.boxEdge}" stroke-width=".8"/>`;
    const steps = Math.max(3, Math.floor(w / 10));
    for (let i = 1; i < steps; i++) {
      const px = x + (w / steps) * i;
      s += `<line x1="${px}" y1="${y + 2}" x2="${px}" y2="${y + h - 2}" ` +
           `stroke="${c.boxDark}" stroke-width=".5" opacity=".55"/>`;
    }
    if (c.stripe) s += `<rect x="${x}" y="${y + h - 5}" width="${w}" height="3" fill="${c.stripe}" opacity=".85"/>`;
    if (c.badge && w > 22) s += badge(c.badge, x + w / 2, y + h / 2);
    return s;
  }
  function flatBody(c, x, y, w, h) {
    return `<rect x="${x}" y="${y + h - 5}" width="${w}" height="4" fill="#5A4830"/>` +
           `<rect x="${x}" y="${y + h - 9}" width="2" height="5" fill="#5A4830"/>` +
           `<rect x="${x + w - 2}" y="${y + h - 9}" width="2" height="5" fill="#5A4830"/>` +
           (c.badge && w > 24 ? badge(c.badge, x + w / 2, y + h - 12) : '');
  }
  function tankerBody(c, x, y, w, h) {
    return `<rect x="${x}" y="${y + 2}" width="${w}" height="${h - 4}" rx="${(h - 4) / 2}" ` +
           `fill="${c.box}" stroke="${c.boxEdge}" stroke-width=".8"/>` +
           `<rect x="${x + 2}" y="${y + h / 2 - 1}" width="${w - 4}" height="2" fill="${c.boxDark}" opacity=".5"/>` +
           (c.stripe ? `<rect x="${x + 1}" y="${y + h - 6}" width="${w - 2}" height="3" rx="1.5" fill="${c.stripe}" opacity=".8"/>` : '');
  }
  function containerBody(c, x, y, w, h) {
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c.box}" ` +
            `stroke="${c.boxEdge}" stroke-width=".8"/>`;
    for (let px = x + 5; px < x + w - 2; px += 5) {
      s += `<line x1="${px}" y1="${y + 1}" x2="${px}" y2="${y + h - 1}" ` +
           `stroke="${c.boxDark}" stroke-width=".4" opacity=".65"/>`;
    }
    if (c.stripe) s += `<rect x="${x}" y="${y + h - 5}" width="${w}" height="3" fill="${c.stripe}" opacity=".85"/>`;
    if (c.badge && w > 22) s += badge(c.badge, x + w / 2, y + h / 2);
    return s;
  }

  /* --- cab shapes --------------------------------------------- */
  function cabSmall(p, x, y, w, h) {
    return `<path d="M${x} ${y + h} L${x} ${y + 5} Q${x} ${y} ${x + 3} ${y} ` +
           `L${x + w - 6} ${y} L${x + w} ${y + 4} L${x + w} ${y + h} Z" fill="${p.cab}"/>` +
           `<path d="M${x + 2} ${y + 4} L${x + 2} ${y + 2} L${x + w - 10} ${y + 2} ` +
           `L${x + w - 6} ${y + 5} Z" fill="${p.cabWin}"/>` +
           `<rect x="${x}" y="${y + h - 1}" width="${w}" height="1.2" fill="${p.cabDark}"/>`;
  }
  function cabBig(p, x, y, w, h) {
    return `<path d="M${x} ${y + h} L${x} ${y + 6} Q${x} ${y} ${x + 4} ${y} ` +
           `L${x + w - 8} ${y} L${x + w} ${y + 6} L${x + w} ${y + h} Z" fill="${p.cab}"/>` +
           `<path d="M${x + 3} ${y + 5} L${x + 3} ${y + 2} L${x + w - 12} ${y + 2} ` +
           `L${x + w - 7} ${y + 6} Z" fill="${p.cabWin}"/>` +
           `<rect x="${x}" y="${y + h - 2}" width="${w}" height="2" fill="${p.cabDark}"/>`;
  }

  function svg(content) {
    return `<svg viewBox="0 0 200 60" xmlns="http://www.w3.org/2000/svg" ` +
           `preserveAspectRatio="xMidYMid meet" aria-hidden="true">${content}</svg>`;
  }

  /* ============================================================
     25 vehicle shapes, 5 per weight class
     Each function receives (palette, cargo) and returns SVG.
     ============================================================ */
  const SHAPES = {
    /* --- xs  (≤ 0.5 t) -------------------------------------- */
    xs: [
      // 0 — city van (Berlingo-style)
      function (p, c) {
        return svg(
          shadow(105, 55) +
          `<path d="M60 44 L60 26 L78 20 L150 20 L150 44 Z" fill="${p.cab}"/>` +
          `<path d="M62 26 L78 22 L94 22 L94 28 L62 28 Z" fill="${p.cabWin}"/>` +
          `<rect x="98" y="22" width="28" height="6" fill="${p.cabWin}"/>` +
          `<rect x="60" y="42" width="90" height="2" fill="${p.cabDark}"/>` +
          wheel(85) + wheel(135)
        );
      },
      // 1 — cargo mini box
      function (p, c) {
        return svg(
          shadow(105, 55) +
          cabSmall(p, 55, 24, 26, 20) +
          boxBody(c, 81, 20, 68, 24) +
          wheel(72) + wheel(138)
        );
      },
      // 2 — small flatbed
      function (p, c) {
        return svg(
          shadow(105, 55) +
          cabSmall(p, 55, 24, 26, 20) +
          flatBody(c, 81, 30, 68, 14) +
          wheel(72) + wheel(138)
        );
      },
      // 3 — small sprinter van
      function (p, c) {
        return svg(
          shadow(105, 58) +
          `<path d="M50 44 L50 22 L64 16 L152 16 L152 44 Z" fill="${p.cab}"/>` +
          `<path d="M52 22 L64 18 L82 18 L82 24 L52 24 Z" fill="${p.cabWin}"/>` +
          `<rect x="86" y="18" width="22" height="6" fill="${p.cabWin}"/>` +
          wheel(78) + wheel(135)
        );
      },
      // 4 — small reefer van (always refrigerated body)
      function (p, c) {
        const body = `<rect x="80" y="18" width="72" height="26" fill="${c.box}" ` +
                     `stroke="${c.boxEdge}" stroke-width=".8"/>` +
                     `<rect x="80" y="18" width="2.4" height="26" fill="${c.boxDark}" opacity=".7"/>` +
                     `<rect x="82" y="14" width="11" height="5" rx="1" fill="${c.boxDark}" ` +
                     `stroke="${c.boxEdge}" stroke-width=".7"/>` +
                     (c.badge ? badge(c.badge, 116, 31) : badge('snowflake', 116, 31));
        return svg(
          shadow(105, 58) +
          cabSmall(p, 52, 22, 28, 22) +
          body +
          wheel(72) + wheel(140)
        );
      },
    ],

    /* --- s  (0.5 – 2 t) ------------------------------------- */
    s: [
      // 0 — full-size cargo van (Sprinter)
      function (p, c) {
        return svg(
          shadow(105, 62) +
          `<path d="M42 44 L42 20 L58 14 L158 14 L158 44 Z" fill="${p.cab}"/>` +
          `<path d="M44 20 L58 16 L78 16 L78 22 L44 22 Z" fill="${p.cabWin}"/>` +
          `<rect x="82" y="16" width="24" height="6" fill="${p.cabWin}"/>` +
          `<rect x="112" y="16" width="22" height="6" fill="${p.cabWin}"/>` +
          wheel(72) + wheel(138)
        );
      },
      // 1 — small box truck
      function (p, c) {
        return svg(
          shadow(105, 65) +
          cabBig(p, 42, 22, 30, 22) +
          boxBody(c, 72, 16, 86, 28) +
          wheel(66) + wheel(146)
        );
      },
      // 2 — small curtain truck
      function (p, c) {
        return svg(
          shadow(105, 65) +
          cabBig(p, 42, 22, 30, 22) +
          curtainBody(c, 72, 16, 86, 28) +
          wheel(66) + wheel(146)
        );
      },
      // 3 — small flatbed truck
      function (p, c) {
        return svg(
          shadow(105, 65) +
          cabBig(p, 42, 22, 30, 22) +
          flatBody(c, 72, 28, 86, 16) +
          wheel(66) + wheel(146)
        );
      },
      // 4 — small tanker
      function (p, c) {
        return svg(
          shadow(105, 65) +
          cabBig(p, 42, 22, 30, 22) +
          tankerBody(c, 72, 14, 86, 30) +
          wheel(66) + wheel(146)
        );
      },
    ],

    /* --- m  (2 – 8 t) ---------------------------------------- */
    m: [
      // 0 — medium box truck
      function (p, c) {
        return svg(
          shadow(100, 78) +
          cabBig(p, 22, 18, 34, 26) +
          boxBody(c, 56, 12, 118, 32) +
          wheel(46) + wheel(140) + wheel(164)
        );
      },
      // 1 — medium curtain
      function (p, c) {
        return svg(
          shadow(100, 78) +
          cabBig(p, 22, 18, 34, 26) +
          curtainBody(c, 56, 12, 118, 32) +
          wheel(46) + wheel(140) + wheel(164)
        );
      },
      // 2 — container truck
      function (p, c) {
        return svg(
          shadow(100, 78) +
          cabBig(p, 22, 18, 34, 26) +
          containerBody(c, 56, 12, 118, 32) +
          wheel(46) + wheel(140) + wheel(164)
        );
      },
      // 3 — medium tanker
      function (p, c) {
        return svg(
          shadow(100, 78) +
          cabBig(p, 22, 18, 34, 26) +
          tankerBody(c, 56, 10, 118, 34) +
          wheel(46) + wheel(140) + wheel(164)
        );
      },
      // 4 — medium refrigerated box
      function (p, c) {
        const cc = Object.assign({}, c, { reefer: true });
        return svg(
          shadow(100, 78) +
          cabBig(p, 22, 18, 34, 26) +
          boxBody(cc, 56, 12, 118, 32) +
          wheel(46) + wheel(140) + wheel(164)
        );
      },
    ],

    /* --- l  (8 – 20 t) --------------------------------------- */
    l: [
      // 0 — 3-axle box truck
      function (p, c) {
        return svg(
          shadow(100, 88) +
          cabBig(p, 10, 14, 38, 30) +
          boxBody(c, 48, 8, 142, 36) +
          wheel(34, 6) + wheel(132, 6) + wheel(160, 6) + wheel(184, 6)
        );
      },
      // 1 — 3-axle curtain
      function (p, c) {
        return svg(
          shadow(100, 88) +
          cabBig(p, 10, 14, 38, 30) +
          curtainBody(c, 48, 8, 142, 36) +
          wheel(34, 6) + wheel(132, 6) + wheel(160, 6) + wheel(184, 6)
        );
      },
      // 2 — 3-axle container
      function (p, c) {
        return svg(
          shadow(100, 88) +
          cabBig(p, 10, 14, 38, 30) +
          containerBody(c, 48, 8, 142, 36) +
          wheel(34, 6) + wheel(132, 6) + wheel(160, 6) + wheel(184, 6)
        );
      },
      // 3 — 3-axle tanker
      function (p, c) {
        return svg(
          shadow(100, 88) +
          cabBig(p, 10, 14, 38, 30) +
          tankerBody(c, 48, 6, 142, 38) +
          wheel(34, 6) + wheel(132, 6) + wheel(160, 6) + wheel(184, 6)
        );
      },
      // 4 — 3-axle flatbed
      function (p, c) {
        return svg(
          shadow(100, 88) +
          cabBig(p, 10, 14, 38, 30) +
          flatBody(c, 48, 22, 142, 22) +
          wheel(34, 6) + wheel(132, 6) + wheel(160, 6) + wheel(184, 6)
        );
      },
    ],

    /* --- xl  (> 20 t) — semi-trailers ------------------------ */
    xl: [
      // 0 — semi with box trailer
      function (p, c) {
        return svg(
          shadow(100, 92) +
          cabBig(p, 6, 14, 42, 30) +
          boxBody(c, 48, 6, 146, 38) +
          wheel(28, 6) + wheel(140, 6) + wheel(168, 6) + wheel(192, 6)
        );
      },
      // 1 — semi with curtain trailer
      function (p, c) {
        return svg(
          shadow(100, 92) +
          cabBig(p, 6, 14, 42, 30) +
          curtainBody(c, 48, 6, 146, 38) +
          wheel(28, 6) + wheel(140, 6) + wheel(168, 6) + wheel(192, 6)
        );
      },
      // 2 — semi with container
      function (p, c) {
        return svg(
          shadow(100, 92) +
          cabBig(p, 6, 14, 42, 30) +
          containerBody(c, 48, 6, 146, 38) +
          wheel(28, 6) + wheel(140, 6) + wheel(168, 6) + wheel(192, 6)
        );
      },
      // 3 — semi tanker
      function (p, c) {
        return svg(
          shadow(100, 92) +
          cabBig(p, 6, 14, 42, 30) +
          tankerBody(c, 48, 6, 146, 38) +
          wheel(28, 6) + wheel(140, 6) + wheel(168, 6) + wheel(192, 6)
        );
      },
      // 4 — semi flatbed
      function (p, c) {
        return svg(
          shadow(100, 92) +
          cabBig(p, 6, 14, 42, 30) +
          flatBody(c, 48, 20, 146, 24) +
          wheel(28, 6) + wheel(140, 6) + wheel(168, 6) + wheel(192, 6)
        );
      },
    ],
  };

  /* --- weight → class ----------------------------------------- */
  function classFor(weight) {
    if (weight <= 0.5) return 'xs';
    if (weight <= 2)   return 's';
    if (weight <= 8)   return 'm';
    if (weight <= 20)  return 'l';
    return 'xl';
  }

  /* --- normalise cargo ---------------------------------------- */
  function cargoFor(value) {
    if (value === 'fragile') return CARGO.fragile;
    if (value === 'temperature') return CARGO.temperature;
    return CARGO.standard;
  }

  /* --- public API --------------------------------------------- */
  function build(weightClass, cargoType, variant) {
    const shapes = SHAPES[weightClass] || SHAPES.s;
    const fn = shapes[variant % shapes.length];
    const palette = PALETTES[variant % PALETTES.length];
    return fn(palette, cargoFor(cargoType));
  }

  function pickRandom(weightClass, cargoType) {
    const v = Math.floor(Math.random() * 5);
    return { svg: build(weightClass, cargoType, v), variant: v };
  }

  window.ASMAVehicles = {
    build,
    pickRandom,
    classFor,
    variants: 5,
    classes: ['xs', 's', 'm', 'l', 'xl'],
  };
})();