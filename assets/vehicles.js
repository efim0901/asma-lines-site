/* ============================================================
   ASMA Lines — Top-Down Logistics Fleet Visualizer
   ------------------------------------------------------------
   Renders architectural top-down (bird's-eye) vehicle SVGs for
   the interactive route tracking on the dark graphite map.
   Accurately proportioned, styled in ASMA Lines corporate livery
   (burgundy #8B2536, graphite chassis, tinted glass, illuminated
   headlight beams and ruby tail lights).
   Supports dynamic steering rotation along highway tangents.
   ============================================================ */
(function () {
  'use strict';

  /* --- Corporate Palettes ----------------------------------- */
  const PALETTES = [
    { cab: '#1C1A18', cabRoof: '#8B2536', stripe: '#8B2536', border: '#48433D' }, // Signature ASMA Burgundy
    { cab: '#24211E', cabRoof: '#9E2A3E', stripe: '#C74D60', border: '#4D4741' }, // Carmine Crimson
    { cab: '#181A1C', cabRoof: '#1F2429', stripe: '#8B2536', border: '#383D42' }, // Graphite Black
  ];

  /* --- Defs: Headlight beam and glass reflections ------------ */
  function getGradients(idSuffix) {
    return `<defs>` +
      `<linearGradient id="beamGrad_${idSuffix}" x1="0" y1="1" x2="0" y2="0">` +
        `<stop offset="0%" stop-color="#FFF8E0" stop-opacity="0.48"/>` +
        `<stop offset="35%" stop-color="#FFF8E0" stop-opacity="0.22"/>` +
        `<stop offset="100%" stop-color="#FFF8E0" stop-opacity="0"/>` +
      `</linearGradient>` +
      `<linearGradient id="glassGrad_${idSuffix}" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0%" stop-color="#8BB5D0"/>` +
        `<stop offset="100%" stop-color="#203342"/>` +
      `</linearGradient>` +
    `</defs>`;
  }

  /* --- Cargo specific visual accents -------------------------- */
  function cargoAccent(type, cx, y, w) {
    if (type === 'temperature') {
      // Refrigerated reefer unit with glowing ice-cyan status LED
      return `<rect x="${cx - 4.5}" y="${y}" width="9" height="3" rx="0.8" fill="#162D3B" stroke="#3D6B88" stroke-width="0.6"/>` +
             `<circle cx="${cx}" cy="${y + 1.5}" r="0.9" fill="#5AC8FA"/>` +
             `<circle cx="${cx}" cy="${y + 1.5}" r="2" fill="#5AC8FA" fill-opacity="0.28"/>`;
    }
    if (type === 'fragile') {
      // High-visibility amber safety chevrons
      return `<path d="M${cx - 4} ${y + 6} L${cx} ${y + 3} L${cx + 4} ${y + 6}" stroke="#F5A623" stroke-width="1.2" fill="none" stroke-linecap="round"/>` +
             `<path d="M${cx - 4} ${y + 10} L${cx} ${y + 7} L${cx + 4} ${y + 10}" stroke="#F5A623" stroke-width="1.2" fill="none" stroke-linecap="round"/>`;
    }
    // Standard: ASMA signature center line
    return `<line x1="${cx}" y1="${y + 2}" x2="${cx}" y2="${y + w - 4}" stroke="#8B2536" stroke-width="2" stroke-linecap="round"/>` +
           `<line x1="${cx}" y1="${y + 5}" x2="${cx}" y2="${y + w - 8}" stroke="#E6A9B4" stroke-width="0.7" stroke-linecap="round"/>`;
  }

  /* --- Vehicle Builders (Top-Down Bird's-Eye Perspective) ----- */
  const BUILDERS = {
    // XL: Euro Articulated TIR 40-tonne Semi-Trailer Truck (width: 28, height: 72)
    xl: function (p, cargo, id) {
      const w = 28, h = 72;
      const svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" xmlns="http://www.w3.org/2000/svg">` +
        getGradients(id) +
        // Headlight beam projection onto dark asphalt
        `<polygon points="8,12 1,1 27,1 20,12" fill="url(#beamGrad_${id})"/>` +
        // Chassis drop shadow
        `<rect x="5" y="10" width="18" height="57" rx="3.5" fill="rgba(0,0,0,0.58)"/>` +
        // Side mirrors
        `<rect x="3.5" y="14" width="2" height="3.5" rx="0.6" fill="#383430"/>` +
        `<rect x="22.5" y="14" width="2" height="3.5" rx="0.6" fill="#383430"/>` +
        // Tractor Cab
        `<rect x="6" y="11" width="16" height="13" rx="3" fill="${p.cab}" stroke="${p.border}" stroke-width="0.75"/>` +
        `<rect x="7" y="11" width="14" height="2" rx="0.8" fill="#302C28"/>` +
        // Dual LED Headlights
        `<circle cx="7.5" cy="12" r="1.1" fill="#FFFBE6"/>` +
        `<circle cx="20.5" cy="12" r="1.1" fill="#FFFBE6"/>` +
        // Windshield
        `<path d="M8 14 Q14 12.5 20 14 L19.5 16.6 Q14 15.2 8.5 16.6 Z" fill="url(#glassGrad_${id})"/>` +
        // Cab roof with ASMA livery
        `<rect x="8.5" y="17" width="11" height="6" rx="1.5" fill="${p.cabRoof}" stroke="#5E1824" stroke-width="0.6"/>` +
        // Fifth wheel hitch
        `<rect x="11.5" y="24" width="5" height="3" fill="#100E0D"/>` +
        // Semi-Trailer Body
        `<rect x="6" y="26.5" width="16" height="39.5" rx="2" fill="#24211E" stroke="${p.border}" stroke-width="0.75"/>` +
        // Trailer roof ribs
        `<line x1="8" y1="36" x2="20" y2="36" stroke="#332F2C" stroke-width="0.7"/>` +
        `<line x1="8" y1="44" x2="20" y2="44" stroke="#332F2C" stroke-width="0.7"/>` +
        `<line x1="8" y1="52" x2="20" y2="52" stroke="#332F2C" stroke-width="0.7"/>` +
        cargoAccent(cargo, 14, 27.5, 36) +
        // Rear bumper & tail lights
        `<rect x="6.5" y="65.5" width="15" height="1.5" fill="#151311"/>` +
        `<circle cx="7.8" cy="65.5" r="1.2" fill="#FF3B30"/>` +
        `<circle cx="20.2" cy="65.5" r="1.2" fill="#FF3B30"/>` +
        `<ellipse cx="7.8" cy="67.5" rx="2.5" ry="1.2" fill="#FF3B30" fill-opacity="0.32"/>` +
        `<ellipse cx="20.2" cy="67.5" rx="2.5" ry="1.2" fill="#FF3B30" fill-opacity="0.32"/>` +
      `</svg>`;
      return { svg, width: w, height: h, anchor: [w / 2, h / 2] };
    },

    // L: Heavy 3-axle Rigid Distribution Truck (width: 26, height: 60)
    l: function (p, cargo, id) {
      const w = 26, h = 60;
      const svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" xmlns="http://www.w3.org/2000/svg">` +
        getGradients(id) +
        `<polygon points="7,10 1,1 25,1 19,10" fill="url(#beamGrad_${id})"/>` +
        `<rect x="5" y="8" width="16" height="48" rx="3" fill="rgba(0,0,0,0.56)"/>` +
        `<rect x="3" y="12" width="2" height="3" rx="0.5" fill="#383430"/>` +
        `<rect x="21" y="12" width="2" height="3" rx="0.5" fill="#383430"/>` +
        // Cab
        `<rect x="5" y="9" width="16" height="11.5" rx="2.5" fill="${p.cab}" stroke="${p.border}" stroke-width="0.75"/>` +
        `<circle cx="6.8" cy="10" r="1" fill="#FFFBE6"/>` +
        `<circle cx="19.2" cy="10" r="1" fill="#FFFBE6"/>` +
        `<path d="M7 12 Q13 10.8 19 12 L18.5 14 Q13 13 7.5 14 Z" fill="url(#glassGrad_${id})"/>` +
        `<rect x="7.5" y="14.5" width="11" height="5" rx="1.2" fill="${p.cabRoof}"/>` +
        // Container
        `<rect x="5" y="21" width="16" height="34.5" rx="2" fill="#24211E" stroke="${p.border}" stroke-width="0.75"/>` +
        `<line x1="7" y1="30" x2="19" y2="30" stroke="#332F2C" stroke-width="0.7"/>` +
        `<line x1="7" y1="40" x2="19" y2="40" stroke="#332F2C" stroke-width="0.7"/>` +
        cargoAccent(cargo, 13, 22, 30) +
        // Tail lights
        `<circle cx="6.8" cy="55" r="1.1" fill="#FF3B30"/>` +
        `<circle cx="19.2" cy="55" r="1.1" fill="#FF3B30"/>` +
        `<ellipse cx="6.8" cy="56.8" rx="2" ry="1" fill="#FF3B30" fill-opacity="0.3"/>` +
        `<ellipse cx="19.2" cy="56.8" rx="2" ry="1" fill="#FF3B30" fill-opacity="0.3"/>` +
      `</svg>`;
      return { svg, width: w, height: h, anchor: [w / 2, h / 2] };
    },

    // M: Medium 2-axle Distribution Truck (width: 24, height: 50)
    m: function (p, cargo, id) {
      const w = 24, h = 50;
      const svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" xmlns="http://www.w3.org/2000/svg">` +
        getGradients(id) +
        `<polygon points="6,9 1,1 23,1 18,9" fill="url(#beamGrad_${id})"/>` +
        `<rect x="4.5" y="8" width="15" height="39" rx="3" fill="rgba(0,0,0,0.52)"/>` +
        `<rect x="2.5" y="11" width="2" height="3" rx="0.5" fill="#383430"/>` +
        `<rect x="19.5" y="11" width="2" height="3" rx="0.5" fill="#383430"/>` +
        // Cab with spoiler
        `<rect x="4.5" y="8.5" width="15" height="10.5" rx="2.5" fill="${p.cab}" stroke="${p.border}" stroke-width="0.75"/>` +
        `<circle cx="6.2" cy="9.5" r="0.9" fill="#FFFBE6"/>` +
        `<circle cx="17.8" cy="9.5" r="0.9" fill="#FFFBE6"/>` +
        `<path d="M6.5 11.2 Q12 10.2 17.5 11.2 L17 13 Q12 12 7 13 Z" fill="url(#glassGrad_${id})"/>` +
        `<rect x="6.8" y="13.2" width="10.4" height="4.5" rx="1" fill="${p.cabRoof}"/>` +
        // Box
        `<rect x="4.5" y="19.5" width="15" height="27" rx="1.8" fill="#24211E" stroke="${p.border}" stroke-width="0.75"/>` +
        `<line x1="6" y1="28" x2="18" y2="28" stroke="#332F2C" stroke-width="0.6"/>` +
        `<line x1="6" y1="37" x2="18" y2="37" stroke="#332F2C" stroke-width="0.6"/>` +
        cargoAccent(cargo, 12, 20.5, 24) +
        `<circle cx="6" cy="46" r="1" fill="#FF3B30"/>` +
        `<circle cx="18" cy="46" r="1" fill="#FF3B30"/>` +
        `<ellipse cx="6" cy="47.5" rx="1.8" ry="0.9" fill="#FF3B30" fill-opacity="0.3"/>` +
        `<ellipse cx="18" cy="47.5" rx="1.8" ry="0.9" fill="#FF3B30" fill-opacity="0.3"/>` +
      `</svg>`;
      return { svg, width: w, height: h, anchor: [w / 2, h / 2] };
    },

    // S: Light Commercial Van / Cargo Truck (width: 22, height: 42)
    s: function (p, cargo, id) {
      const w = 22, h = 42;
      const svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" xmlns="http://www.w3.org/2000/svg">` +
        getGradients(id) +
        `<polygon points="5,8 1,1 21,1 17,8" fill="url(#beamGrad_${id})"/>` +
        `<rect x="4" y="7" width="14" height="32" rx="2.5" fill="rgba(0,0,0,0.5)"/>` +
        `<rect x="2" y="10" width="2" height="2.5" rx="0.5" fill="#383430"/>` +
        `<rect x="18" y="10" width="2" height="2.5" rx="0.5" fill="#383430"/>` +
        // Cab
        `<rect x="4" y="7.5" width="14" height="9.5" rx="2.2" fill="${p.cab}" stroke="${p.border}" stroke-width="0.7"/>` +
        `<circle cx="5.5" cy="8.5" r="0.8" fill="#FFFBE6"/>` +
        `<circle cx="16.5" cy="8.5" r="0.8" fill="#FFFBE6"/>` +
        `<path d="M5.8 10 Q11 9 16.2 10 L15.8 11.8 Q11 11 6.2 11.8 Z" fill="url(#glassGrad_${id})"/>` +
        `<rect x="6" y="12" width="10" height="4" rx="1" fill="${p.cabRoof}"/>` +
        // Cargo Body
        `<rect x="4" y="17.5" width="14" height="21" rx="1.5" fill="#24211E" stroke="${p.border}" stroke-width="0.7"/>` +
        cargoAccent(cargo, 11, 18.5, 18) +
        `<circle cx="5.5" cy="38" r="0.9" fill="#FF3B30"/>` +
        `<circle cx="16.5" cy="38" r="0.9" fill="#FF3B30"/>` +
      `</svg>`;
      return { svg, width: w, height: h, anchor: [w / 2, h / 2] };
    },

    // XS: Express Courier Van (Mercedes Sprinter style) (width: 20, height: 36)
    xs: function (p, cargo, id) {
      const w = 20, h = 36;
      const svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" xmlns="http://www.w3.org/2000/svg">` +
        getGradients(id) +
        `<polygon points="5,7 1,1 19,1 15,7" fill="url(#beamGrad_${id})"/>` +
        `<rect x="3.5" y="6" width="13" height="27" rx="3.5" fill="rgba(0,0,0,0.48)"/>` +
        `<rect x="1.8" y="9" width="1.7" height="2.2" rx="0.5" fill="#383430"/>` +
        `<rect x="16.5" y="9" width="1.7" height="2.2" rx="0.5" fill="#383430"/>` +
        // Aerodynamic van body
        `<rect x="3.5" y="6.5" width="13" height="26" rx="3" fill="${p.cab}" stroke="${p.border}" stroke-width="0.7"/>` +
        `<circle cx="4.8" cy="7.5" r="0.8" fill="#FFFBE6"/>` +
        `<circle cx="15.2" cy="7.5" r="0.8" fill="#FFFBE6"/>` +
        // Windshield
        `<path d="M5 9 Q10 7.8 15 9 L14.5 11.2 Q10 10.2 5.5 11.2 Z" fill="url(#glassGrad_${id})"/>` +
        // Roof with ASMA branding
        `<rect x="5.5" y="12" width="9" height="15" rx="1.2" fill="#24211E"/>` +
        `<line x1="10" y1="13" x2="10" y2="28" stroke="${p.cabRoof}" stroke-width="1.6" stroke-linecap="round"/>` +
        // Rear Doors & Tail lights
        `<line x1="10" y1="29" x2="10" y2="32.5" stroke="#110E0D" stroke-width="0.6"/>` +
        `<circle cx="4.8" cy="32" r="0.8" fill="#FF3B30"/>` +
        `<circle cx="15.2" cy="32" r="0.8" fill="#FF3B30"/>` +
        `<ellipse cx="4.8" cy="33.2" rx="1.4" ry="0.7" fill="#FF3B30" fill-opacity="0.28"/>` +
        `<ellipse cx="15.2" cy="33.2" rx="1.4" ry="0.7" fill="#FF3B30" fill-opacity="0.28"/>` +
      `</svg>`;
      return { svg, width: w, height: h, anchor: [w / 2, h / 2] };
    },
  };

  /* --- weight → class ----------------------------------------- */
  function classFor(weight) {
    if (weight <= 0.8) return 'xs';
    if (weight <= 2.5) return 's';
    if (weight <= 6)   return 'm';
    if (weight <= 15)  return 'l';
    return 'xl';
  }

  /* --- Public API --------------------------------------------- */
  let idCounter = 0;
  function build(weightClass, cargoType, variant) {
    const builder = BUILDERS[weightClass] || BUILDERS.m;
    const p = PALETTES[(variant || 0) % PALETTES.length];
    const id = `${weightClass}_${++idCounter}`;
    const res = builder(p, cargoType || 'standard', id);
    return {
      svg: res.svg,
      html: `<div class="calc-vehicle-rotator">${res.svg}</div>`,
      width: res.width,
      height: res.height,
      anchor: res.anchor,
    };
  }

  function pickRandom(weightClass, cargoType) {
    const v = Math.floor(Math.random() * PALETTES.length);
    return build(weightClass, cargoType, v);
  }

  window.ASMAVehicles = {
    build,
    pickRandom,
    classFor,
    classes: ['xs', 's', 'm', 'l', 'xl'],
  };
})();
