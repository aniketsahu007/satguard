// ═══════════════════════════════════════════════
//  SatGuard — Satellite Cyber Defence Platform
//  main.js  |  Three.js Globe + HUD Logic
//  Upgrades: Fresnel Atmosphere · NASA Texture · Cloud Layer
// ═══════════════════════════════════════════════

// ─────────────────────────────────────────────
//  RENDERER + SCENE + CAMERA
// ─────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x060a10, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0, 3.2);

// ─────────────────────────────────────────────
//  STARS — 4 layers + Milky Way band
// ─────────────────────────────────────────────
(function createStars() {
    function randSphere(n, rMin, rMax) {
        const pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const r = rMin + Math.random() * (rMax - rMin);
            pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            pos[i * 3 + 2] = r * Math.cos(phi);
        }
        return pos;
    }

    // Layer 1 — vast distant field, cool blue-white
    const geoA = new THREE.BufferGeometry();
    geoA.setAttribute('position', new THREE.BufferAttribute(randSphere(7000, 140, 200), 3));
    scene.add(new THREE.Points(geoA, new THREE.PointsMaterial({
        color: 0xb0c4de, size: 0.04, sizeAttenuation: true, transparent: true, opacity: 0.45
    })));

    // Layer 2 — mid-field, pure white
    const geoB = new THREE.BufferGeometry();
    geoB.setAttribute('position', new THREE.BufferAttribute(randSphere(2000, 100, 140), 3));
    scene.add(new THREE.Points(geoB, new THREE.PointsMaterial({
        color: 0xffffff, size: 0.08, sizeAttenuation: true, transparent: true, opacity: 0.6
    })));

    // Layer 3 — foreground bright stars, warm tint (like Orion / Betelgeuse mix)
    const geoC = new THREE.BufferGeometry();
    geoC.setAttribute('position', new THREE.BufferAttribute(randSphere(300, 85, 100), 3));
    scene.add(new THREE.Points(geoC, new THREE.PointsMaterial({
        color: 0xfff0d0, size: 0.18, sizeAttenuation: true, transparent: true, opacity: 0.85
    })));

    // Layer 4 — handful of vivid blue giants (O-type stars)
    const geoD = new THREE.BufferGeometry();
    geoD.setAttribute('position', new THREE.BufferAttribute(randSphere(60, 88, 95), 3));
    scene.add(new THREE.Points(geoD, new THREE.PointsMaterial({
        color: 0x99ccff, size: 0.22, sizeAttenuation: true, transparent: true, opacity: 0.9
    })));

    // ── Milky Way band ───────────────────────────────────────────────────────
    // Box-Muller for Gaussian scatter
    function gauss() {
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    // Band is a great circle tilted ~50° off the XZ plane
    // Define two perpendicular axes that span the band plane
    const bAxisA = new THREE.Vector3(0.85, 0.45, 0.28).normalize(); // "east" along band
    const bAxisB = new THREE.Vector3(-0.2, 0.78, -0.59).normalize(); // "north" along band

    const nMW = 3500;
    const posMW = new Float32Array(nMW * 3);
    for (let i = 0; i < nMW; i++) {
        const angle = Math.random() * Math.PI * 2;           // position along band
        const scatter = gauss() * 0.18;                         // perpendicular scatter (narrow)
        const r = 155 + Math.random() * 30;

        const dir = new THREE.Vector3()
            .addScaledVector(bAxisA, Math.cos(angle))
            .addScaledVector(bAxisB, Math.sin(angle))
            .normalize();

        // Add scatter in a perpendicular direction
        const perp = new THREE.Vector3().crossVectors(dir, bAxisA).normalize();
        dir.addScaledVector(perp, scatter).normalize();

        posMW[i * 3] = dir.x * r;
        posMW[i * 3 + 1] = dir.y * r;
        posMW[i * 3 + 2] = dir.z * r;
    }
    const geoMW = new THREE.BufferGeometry();
    geoMW.setAttribute('position', new THREE.BufferAttribute(posMW, 3));
    scene.add(new THREE.Points(geoMW, new THREE.PointsMaterial({
        color: 0xd0dff5, size: 0.035, sizeAttenuation: true, transparent: true, opacity: 0.35
    })));
})();

// ─────────────────────────────────────────────
//  FRESNEL ATMOSPHERE — GLSL SHADERS
// ─────────────────────────────────────────────
const fresnelVert = `
    varying vec3 vNormal;
    varying vec3 vViewDir;
    void main() {
        vNormal  = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvPos.xyz);
        gl_Position = projectionMatrix * mvPos;
    }
`;

// Outer halo — BackSide, creates the iconic blue atmospheric rim
const fresnelFragOuter = `
    varying vec3 vNormal;
    varying vec3 vViewDir;
    void main() {
        float rim = 1.0 - abs(dot(vNormal, vViewDir));
        rim = pow(rim, 2.8);
        vec3 atmColor = vec3(0.18, 0.52, 1.0);
        gl_FragColor  = vec4(atmColor, rim * 0.85);
    }
`;

// Inner rim — FrontSide, tightens the blue glow right on the sphere edge
const fresnelFragInner = `
    varying vec3 vNormal;
    varying vec3 vViewDir;
    void main() {
        float rim = 1.0 - abs(dot(vNormal, vViewDir));
        rim = pow(rim, 5.0);
        vec3 atmColor = vec3(0.25, 0.6, 1.0);
        gl_FragColor  = vec4(atmColor, rim * 0.4);
    }
`;

// ─────────────────────────────────────────────
//  IMPROVED PROCEDURAL EARTH (fallback texture)
// ─────────────────────────────────────────────
function makeProceduralEarth() {
    const c = document.createElement('canvas');
    c.width = 2048; c.height = 1024;
    const ctx = c.getContext('2d');

    // Deep ocean
    const ocean = ctx.createLinearGradient(0, 0, 0, 1024);
    ocean.addColorStop(0, '#040f1e');
    ocean.addColorStop(0.3, '#071828');
    ocean.addColorStop(0.7, '#061525');
    ocean.addColorStop(1, '#050e1a');
    ctx.fillStyle = ocean;
    ctx.fillRect(0, 0, 2048, 1024);

    // Polar ice caps
    ctx.fillStyle = 'rgba(200,220,255,0.55)';
    ctx.beginPath(); ctx.ellipse(1024, 20, 900, 55, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(1024, 1004, 900, 55, 0, 0, Math.PI * 2); ctx.fill();

    const continents = [
        // North America
        { x: 230, y: 220, rx: 105, ry: 75, rot: 0.2 }, { x: 200, y: 280, rx: 80, ry: 60, rot: -0.1 },
        { x: 260, y: 310, rx: 55, ry: 45, rot: 0.1 }, { x: 215, y: 360, rx: 40, ry: 55, rot: 0.3 },
        // South America
        { x: 310, y: 430, rx: 50, ry: 40, rot: 0.1 }, { x: 300, y: 510, rx: 45, ry: 65, rot: -0.1 },
        { x: 310, y: 600, rx: 35, ry: 50, rot: 0.0 },
        // Europe
        { x: 620, y: 195, rx: 55, ry: 40, rot: 0.15 }, { x: 650, y: 230, rx: 45, ry: 35, rot: -0.1 },
        { x: 680, y: 265, rx: 30, ry: 25, rot: 0.0 },
        // Africa
        { x: 640, y: 330, rx: 65, ry: 55, rot: 0.0 }, { x: 650, y: 420, rx: 70, ry: 70, rot: 0.0 },
        { x: 645, y: 520, rx: 55, ry: 65, rot: 0.05 }, { x: 640, y: 620, rx: 35, ry: 45, rot: 0.0 },
        // Asia
        { x: 850, y: 190, rx: 160, ry: 85, rot: 0.1 }, { x: 900, y: 280, rx: 130, ry: 80, rot: 0.05 },
        { x: 870, y: 350, rx: 90, ry: 60, rot: 0.0 }, { x: 950, y: 200, rx: 80, ry: 60, rot: 0.2 },
        // India
        { x: 830, y: 400, rx: 45, ry: 60, rot: 0.0 },
        // SE Asia
        { x: 980, y: 390, rx: 55, ry: 40, rot: 0.3 }, { x: 1010, y: 430, rx: 40, ry: 30, rot: 0.2 },
        // Australia
        { x: 1050, y: 530, rx: 90, ry: 65, rot: 0.1 }, { x: 1070, y: 620, rx: 50, ry: 40, rot: 0.0 },
        // Greenland
        { x: 390, y: 145, rx: 55, ry: 45, rot: 0.1 },
        // Japan / UK
        { x: 1050, y: 270, rx: 20, ry: 40, rot: 0.4 }, { x: 610, y: 175, rx: 20, ry: 35, rot: 0.1 },
        { x: 635, y: 155, rx: 18, ry: 50, rot: 0.15 },
    ];

    continents.forEach(({ x, y, rx, ry, rot }) => {
        ctx.fillStyle = '#1a3322';
        ctx.beginPath(); ctx.ellipse(x + 4, y + 4, rx * 1.05, ry * 1.05, rot, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1f3e2a';
        ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#254430';
        ctx.beginPath(); ctx.ellipse(x - rx * 0.1, y - ry * 0.1, rx * 0.65, ry * 0.65, rot, 0, Math.PI * 2); ctx.fill();
    });

    // Lat/lon grid
    ctx.strokeStyle = 'rgba(88,166,255,0.035)';
    ctx.lineWidth = 1;
    for (let lat = -80; lat <= 80; lat += 20) {
        const gy = (lat + 90) / 180 * 1024;
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(2048, gy); ctx.stroke();
    }
    for (let lon = 0; lon < 360; lon += 20) {
        const gx = lon / 360 * 2048;
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, 1024); ctx.stroke();
    }

    // Ocean shimmer
    const shimmer = ctx.createRadialGradient(1100, 350, 0, 1100, 350, 400);
    shimmer.addColorStop(0, 'rgba(88,166,255,0.04)');
    shimmer.addColorStop(1, 'rgba(88,166,255,0)');
    ctx.fillStyle = shimmer;
    ctx.fillRect(0, 0, 2048, 1024);

    return new THREE.CanvasTexture(c);
}

// ─────────────────────────────────────────────
//  EARTH MESH — real NASA texture, procedural fallback
// ─────────────────────────────────────────────
const earthGeo = new THREE.SphereGeometry(1, 72, 72);
const earthMat = new THREE.MeshPhongMaterial({
    map: makeProceduralEarth(),   // shown instantly
    specular: new THREE.Color(0x0a1828),
    shininess: 18,
    emissive: new THREE.Color(0x020608),
    emissiveIntensity: 0.25,
});

// Attempt to upgrade to real NASA texture
const texLoader = new THREE.TextureLoader();
texLoader.crossOrigin = 'anonymous';
texLoader.load(
    'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/land_ocean_ice_cloud_2048.jpg',
    (tex) => { earthMat.map = tex; earthMat.needsUpdate = true; },
    undefined,
    () => { /* CORS blocked — procedural already applied, no action needed */ }
);

const earth = new THREE.Mesh(earthGeo, earthMat);
scene.add(earth);

// ─────────────────────────────────────────────
//  CLOUD LAYER — procedural, animated
// ─────────────────────────────────────────────
function makeCloudTexture() {
    const c = document.createElement('canvas');
    c.width = 2048; c.height = 1024;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 2048, 1024);

    // Latitude-banded cloud patterns — matches real Earth cloud distribution
    const bands = [
        { y: 120, spread: 60, density: 35, alpha: 0.28 },  // polar N
        { y: 260, spread: 55, density: 55, alpha: 0.22 },  // mid-lat N
        { y: 390, spread: 40, density: 28, alpha: 0.16 },  // subtropical dry N
        { y: 512, spread: 70, density: 70, alpha: 0.26 },  // ITCZ equatorial band
        { y: 634, spread: 40, density: 28, alpha: 0.16 },  // subtropical dry S
        { y: 760, spread: 55, density: 55, alpha: 0.22 },  // mid-lat S
        { y: 904, spread: 60, density: 35, alpha: 0.28 },  // polar S
    ];

    bands.forEach(({ y, spread, density, alpha }) => {
        for (let i = 0; i < density; i++) {
            const cx = Math.random() * 2048;
            const cy = y + (Math.random() - 0.5) * spread * 2;
            const rx = 30 + Math.random() * 140;
            const ry = 8 + Math.random() * 28;
            const rot = (Math.random() - 0.5) * 0.6;

            // Each cloud = 3 overlapping soft radial blobs
            for (let j = 0; j < 3; j++) {
                const ox = (Math.random() - 0.5) * rx * 0.5;
                const oy = (Math.random() - 0.5) * ry * 0.8;
                const a = alpha * (0.4 + Math.random() * 0.6);
                const grad = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, rx * 0.7);
                grad.addColorStop(0, `rgba(255,255,255,${a})`);
                grad.addColorStop(0.5, `rgba(240,248,255,${a * 0.55})`);
                grad.addColorStop(1, `rgba(255,255,255,0)`);
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.ellipse(cx + ox, cy + oy, rx * (0.5 + j * 0.2), ry * (0.5 + j * 0.2), rot, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    });

    return new THREE.CanvasTexture(c);
}

const cloudGeo = new THREE.SphereGeometry(1.012, 72, 72);
const cloudMat = new THREE.MeshPhongMaterial({
    map: makeCloudTexture(),
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    side: THREE.FrontSide,
});
const clouds = new THREE.Mesh(cloudGeo, cloudMat);
scene.add(clouds);

// ─────────────────────────────────────────────
//  FRESNEL ATMOSPHERE — two-pass
// ─────────────────────────────────────────────

// Pass 1: outer atmospheric halo (BackSide)
scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(1.08, 72, 72),
    new THREE.ShaderMaterial({
        vertexShader: fresnelVert,
        fragmentShader: fresnelFragOuter,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    })
));

// Pass 2: inner rim glow (FrontSide)
scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(1.015, 72, 72),
    new THREE.ShaderMaterial({
        vertexShader: fresnelVert,
        fragmentShader: fresnelFragInner,
        side: THREE.FrontSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    })
));

// ─────────────────────────────────────────────
//  LIGHTS
// ─────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0x1a2840, 0.9));
const sun = new THREE.DirectionalLight(0xfff5e8, 1.2);   // warm sunlight
sun.position.set(5, 3, 4);
scene.add(sun);
const fill = new THREE.DirectionalLight(0x1a3a6a, 0.18); // cool Earthshine fill
fill.position.set(-4, -2, -3);
scene.add(fill);

// ─────────────────────────────────────────────
//  SATELLITES
// ─────────────────────────────────────────────
const satelliteData = [
    { name: 'SMAP-01', color: 0x3fb950, orbitTilt: 0.20, orbitSpeed: 0.48, orbitRadius: 1.45, phase: 0.0 },
    { name: 'SMAP-02', color: 0x3fb950, orbitTilt: 0.80, orbitSpeed: 0.36, orbitRadius: 1.55, phase: 2.1 },
    { name: 'MSL-RELAY', color: 0x58a6ff, orbitTilt: 1.20, orbitSpeed: 0.60, orbitRadius: 1.35, phase: 1.0 },
    { name: 'GPS-GUARD', color: 0x58a6ff, orbitTilt: 0.50, orbitSpeed: 0.42, orbitRadius: 1.65, phase: 3.5 },
    { name: 'OBS-TERRA', color: 0x3fb950, orbitTilt: 1.57, orbitSpeed: 0.54, orbitRadius: 1.42, phase: 0.7 },
];

const satellites = [];
satelliteData.forEach((sd, i) => {
    const inc = sd.orbitTilt;
    const raan = i * 0.6;

    // ── PIVOT — the orbital plane itself ──────────────────────────────────
    // Both the orbit ring AND the satellite mesh are children of this pivot.
    // That guarantees they always share the exact same plane — no math mismatch.
    //   rotateY(raan) → spins the ascending node around the pole axis
    //   rotateX(inc)  → tilts the plane by inclination angle
    const pivot = new THREE.Object3D();
    pivot.rotation.order = 'YXZ';
    pivot.rotation.y = raan;
    pivot.rotation.x = inc;
    scene.add(pivot);

    // ── Orbit ring ────────────────────────────────────────────────────────
    // TorusGeometry lies in the XY plane (normal = +Z) by default.
    // Satellite moves in local XZ plane (y = 0).
    // FIX: rotate ring 90° around X so it also lies in XZ plane.
    const orbitRing = new THREE.Mesh(
        new THREE.TorusGeometry(sd.orbitRadius, 0.0016, 8, 160),
        new THREE.MeshBasicMaterial({ color: 0x334455, transparent: true, opacity: 0.55 })
    );
    orbitRing.rotation.x = Math.PI / 2;   // ← THE FIX — aligns ring to XZ plane
    pivot.add(orbitRing);

    // ── Satellite group — child of the SAME pivot ─────────────────────────
    const satGroup = new THREE.Group();

    // ── Main bus body ──────────────────────────────────────────────────────
    // Slightly larger so it's visible, multi-face metallic look
    const bodyMat = new THREE.MeshPhongMaterial({
        color: 0x8899aa,
        emissive: new THREE.Color(sd.color),
        emissiveIntensity: 0.4,
        shininess: 120,
        specular: new THREE.Color(0xaaccee),
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.018, 0.038), bodyMat);
    satGroup.add(body);

    // Gold thermal blanket strips on the body (MLI foil — every real sat has these)
    const foilMat = new THREE.MeshPhongMaterial({
        color: 0xd4a017, emissive: 0x7a5500,
        emissiveIntensity: 0.3, shininess: 200,
        specular: new THREE.Color(0xffdd88),
    });
    [-0.008, 0.006].forEach(zOff => {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.0275, 0.0185, 0.006), foilMat);
        strip.position.set(0, 0, zOff);
        satGroup.add(strip);
    });

    // ── Solar panels — larger, with visible cell structure ─────────────────
    const panelMat = new THREE.MeshPhongMaterial({
        color: 0x0b1a40,
        emissive: 0x0a1530,
        emissiveIntensity: 0.5,
        shininess: 180,
        specular: new THREE.Color(0x3366cc),
    });
    // Bright blue reflective tint on panel surface
    const panelCapMat = new THREE.MeshPhongMaterial({
        color: 0x112255,
        emissive: 0x0a1840,
        emissiveIntensity: 0.6,
        shininess: 250,
        specular: new THREE.Color(0x4488ff),
    });
    const frameMat = new THREE.MeshPhongMaterial({
        color: 0x445566, shininess: 80,
        specular: new THREE.Color(0x778899),
    });

    [-1, 1].forEach(side => {
        // Outer panel wing
        const wing = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.002, 0.022), panelMat);
        wing.position.set(side * 0.049, 0, 0);
        satGroup.add(wing);

        // Shiny top face cap
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.070, 0.0025, 0.020), panelCapMat);
        cap.position.set(side * 0.049, 0.001, 0);
        satGroup.add(cap);

        // Aluminium frame border
        const frame = new THREE.Mesh(new THREE.BoxGeometry(0.074, 0.003, 0.024), frameMat);
        frame.position.set(side * 0.049, -0.001, 0);
        satGroup.add(frame);

        // Cell divider lines — 4 vertical, 2 horizontal
        const divMatV = new THREE.MeshBasicMaterial({ color: 0x223355 });
        const divMatH = new THREE.MeshBasicMaterial({ color: 0x223355 });
        for (let c = -1; c <= 1; c++) {
            const dv = new THREE.Mesh(new THREE.BoxGeometry(0.0012, 0.003, 0.022), divMatV);
            dv.position.set(side * 0.049 + c * 0.022, 0, 0);
            satGroup.add(dv);
        }
        [-0.007, 0.007].forEach(zOff => {
            const dh = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.003, 0.0012), divMatH);
            dh.position.set(side * 0.049, 0, zOff);
            satGroup.add(dh);
        });

        // Panel hinge connecting wing to body
        const hinge = new THREE.Mesh(
            new THREE.CylinderGeometry(0.002, 0.002, 0.020, 6),
            new THREE.MeshPhongMaterial({ color: 0x667788, shininess: 60 })
        );
        hinge.rotation.z = Math.PI / 2;
        hinge.position.set(side * 0.014, 0, 0);
        satGroup.add(hinge);
    });

    // ── Antenna boom + parabolic dish ─────────────────────────────────────
    const boomMat = new THREE.MeshPhongMaterial({
        color: 0xbbccdd, shininess: 100,
        specular: new THREE.Color(0xddeeff)
    });

    // Main boom
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.0014, 0.0014, 0.030, 6), boomMat);
    boom.position.set(0, -0.024, 0);
    satGroup.add(boom);

    // Parabolic dish — open CylinderGeometry for depth illusion
    const dishOuter = new THREE.Mesh(
        new THREE.CylinderGeometry(0.013, 0.004, 0.008, 12, 1, false),
        new THREE.MeshPhongMaterial({
            color: 0xddeeff, shininess: 200,
            specular: new THREE.Color(0xffffff),
            side: THREE.DoubleSide,
        })
    );
    dishOuter.position.set(0, -0.043, 0);
    dishOuter.rotation.x = Math.PI;
    satGroup.add(dishOuter);

    // Dish feed horn at centre
    const feedHorn = new THREE.Mesh(
        new THREE.CylinderGeometry(0.002, 0.004, 0.006, 6),
        new THREE.MeshPhongMaterial({ color: 0x889aaa, shininess: 80 })
    );
    feedHorn.position.set(0, -0.038, 0);
    satGroup.add(feedHorn);

    // Star tracker
    const tracker = new THREE.Mesh(
        new THREE.BoxGeometry(0.006, 0.006, 0.006),
        new THREE.MeshPhongMaterial({
            color: 0x111111, shininess: 40,
            specular: new THREE.Color(0x334455)
        })
    );
    tracker.position.set(0.008, 0.012, 0.010);
    satGroup.add(tracker);

    // Thruster nozzles - four small cones on body corners
    const thrusterMat = new THREE.MeshPhongMaterial({
        color: 0x556677, shininess: 120, specular: new THREE.Color(0x99aacc)
    });
    [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => {
        const nozzle = new THREE.Mesh(
            new THREE.CylinderGeometry(0.0018, 0.003, 0.007, 6), thrusterMat
        );
        nozzle.position.set(sx * 0.014, -0.012, sz * 0.020);
        nozzle.rotation.x = Math.PI;
        satGroup.add(nozzle);
    });

    // Navigation lights - red port, green starboard
    const navLightR = new THREE.Mesh(
        new THREE.SphereGeometry(0.0025, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0xff2200 })
    );
    navLightR.position.set(-0.014, 0.010, 0.020);
    satGroup.add(navLightR);

    const navLightG = new THREE.Mesh(
        new THREE.SphereGeometry(0.0025, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0x00ff88 })
    );
    navLightG.position.set(0.014, 0.010, 0.020);
    satGroup.add(navLightG);

    const navGlowR = new THREE.Sprite(
        new THREE.SpriteMaterial({ color: 0xff2200, transparent: true, opacity: 0.7 })
    );
    navGlowR.scale.set(0.014, 0.014, 1);
    navGlowR.position.set(-0.014, 0.010, 0.020);
    satGroup.add(navGlowR);

    const navGlowG = new THREE.Sprite(
        new THREE.SpriteMaterial({ color: 0x00ff88, transparent: true, opacity: 0.7 })
    );
    navGlowG.scale.set(0.014, 0.014, 1);
    navGlowG.position.set(0.014, 0.010, 0.020);
    satGroup.add(navGlowG);



    // Glow sprite
    const spriteMat = new THREE.SpriteMaterial({ color: sd.color, transparent: true, opacity: 0.45 });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(0.08, 0.08, 1);
    satGroup.add(sprite);

    pivot.add(satGroup);

    satellites.push({
        pivot,
        mesh: satGroup,
        body,
        sprite,
        navGlowR,
        navGlowG,
        orbitRadius: sd.orbitRadius,
        orbitSpeed: sd.orbitSpeed,
        phase: sd.phase,
        data: sd,
        status: 'safe',
    });
});

// ─────────────────────────────────────────────
//  ATTACK LINES
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
//  CLOCK
// ─────────────────────────────────────────────
function updateClock() {
    const now = new Date();
    const h = String(now.getUTCHours()).padStart(2, '0');
    const m = String(now.getUTCMinutes()).padStart(2, '0');
    const s = String(now.getUTCSeconds()).padStart(2, '0');
    document.getElementById('clock').textContent = `${h}:${m}:${s} UTC`;
}
setInterval(updateClock, 1000);
updateClock();

// ─────────────────────────────────────────────
//  TELEMETRY NOISE
// ─────────────────────────────────────────────
let teleState = { sig: -94, alt: 550, cmd: 2.245, temp: 22.4, pwr: 98.2, anom: 0.12, pkt: 4821 };
let currentMode = 'normal';
let alertTimer = null;

function noisify(val, std, min, max) {
    return Math.min(max, Math.max(min, val + (Math.random() - 0.5) * std * 2));
}

function updateTelemetry() {
    const hasLiveBackend = (typeof backendOnline !== 'undefined' && backendOnline);

    if (currentMode === 'normal') {
        teleState.sig = noisify(-94, 0.8, -100, -88);
        teleState.alt = noisify(550, 2, 540, 560);
        teleState.cmd = noisify(2.245, 0.005, 2.23, 2.26);
        teleState.temp = noisify(22.4, 0.5, 18, 26);
        teleState.pwr = noisify(98.2, 0.3, 95, 100);
        teleState.anom = noisify(0.12, 0.03, 0.05, 0.25);
        teleState.pkt += Math.floor(Math.random() * 12 + 4);
        if (!hasLiveBackend) setThreat(teleState.anom, '— No Threat Detected', '—', 'MONITORING', 'normal');
    } else if (currentMode === 'spoof') {
        teleState.cmd = noisify(2.245, 0.08, 2.1, 2.4);
        teleState.anom = noisify(0.72, 0.05, 0.6, 0.9);
        teleState.pkt += Math.floor(Math.random() * 80 + 50);
        if (!hasLiveBackend) setThreat(teleState.anom, 'Command Spoofing', '91.4%', 'ISOLATE CHANNEL', 'critical');
    } else if (currentMode === 'inject') {
        teleState.sig = noisify(-70, 8, -100, -50);
        teleState.anom = noisify(0.85, 0.04, 0.75, 0.96);
        teleState.pkt += Math.floor(Math.random() * 200 + 100);
        if (!hasLiveBackend) setThreat(teleState.anom, 'Signal Injection', '87.2%', 'BLOCK TX NODE', 'critical');
    } else if (currentMode === 'manip') {
        teleState.temp = noisify(teleState.temp, 2, 10, 55);
        teleState.pwr = noisify(teleState.pwr, 3, 60, 100);
        teleState.anom = noisify(0.55, 0.06, 0.35, 0.72);
        if (!hasLiveBackend) setThreat(teleState.anom, 'Telemetry Manipulation', '76.8%', 'NOTIFY GROUND CTL', 'suspicious');
    } else if (currentMode === 'hw') {
        teleState.pwr = noisify(teleState.pwr, 4, 30, 80);
        teleState.temp = noisify(teleState.temp, 3, 25, 45);
        teleState.anom = noisify(0.65, 0.05, 0.45, 0.85);
        if (!hasLiveBackend) setThreat(teleState.anom, 'Hardware Degradation', '82.1%', 'INIT DIAGNOSTICS', 'suspicious');
    }

    if (!hasLiveBackend) {
        const anom = teleState.anom;
        const anomEl = document.getElementById('t-anom');
        anomEl.textContent = anom.toFixed(3);
        anomEl.className = 'val' + (anom > 0.6 ? ' crit' : anom > 0.3 ? ' warn' : '');
    }

    const cmdEl = document.getElementById('t-cmd');
    cmdEl.textContent = teleState.cmd.toFixed(3) + ' GHz';
    cmdEl.className = 'val' + (currentMode === 'spoof' ? ' warn' : '');

    const sigEl = document.getElementById('t-sig');
    sigEl.textContent = teleState.sig.toFixed(1) + ' dBm';
    sigEl.className = 'val' + (currentMode === 'inject' ? ' crit' : '');

    document.getElementById('t-alt').textContent = teleState.alt.toFixed(0) + ' km';
    document.getElementById('t-temp').textContent = teleState.temp.toFixed(1) + ' °C';
    document.getElementById('t-pwr').textContent = teleState.pwr.toFixed(1) + ' %';
    document.getElementById('t-pkt').textContent = teleState.pkt.toLocaleString();
}
setInterval(updateTelemetry, 800);

// ─────────────────────────────────────────────
//  THREAT PANEL HELPER
// ─────────────────────────────────────────────
function setThreat(score, type, conf, resp, level) {
    const num = document.getElementById('threat-num');
    const lbl = document.getElementById('threat-lbl');
    const bar = document.getElementById('threat-bar');
    const atkT = document.getElementById('atk-type-val');
    const atkC = document.getElementById('atk-conf-val');
    const atkR = document.getElementById('atk-resp-val');

    num.textContent = score.toFixed(2);
    num.className = 'threat-score-main ' + level;
    lbl.textContent = level === 'critical' ? '● HIGH RISK'
        : level === 'suspicious' ? '● SUSPICIOUS'
            : '● NORMAL';
    lbl.className = 'threat-level-tag ' + level;
    bar.style.width = (Math.min(score, 1) * 100) + '%';
    bar.style.background = level === 'critical' ? 'var(--crit)'
        : level === 'suspicious' ? 'var(--warn)'
            : 'var(--ok)';
    atkT.textContent = type;
    atkC.textContent = conf;
    atkR.textContent = resp;
    atkR.className = 'intel-val ' + (level === 'critical' ? 'crit' : level === 'suspicious' ? 'warn' : 'ok');
    document.getElementById('btn-playbook').disabled = (level === 'normal');
}

// ─────────────────────────────────────────────
//  SATELLITE STATUS
// ─────────────────────────────────────────────
const satIds = ['s1', 's2', 's3', 's4', 's5'];
function setSatStatus(idx, status, label) {
    const dot = document.getElementById(satIds[idx] + '-dot');
    const st = document.getElementById(satIds[idx] + '-st');
    if (!dot || !st) return;
    dot.className = 'sat-indicator ' + status;
    st.textContent = label;
    st.className = 'sat-status-label ' + status;
    satellites[idx].status = status;
}

// ─────────────────────────────────────────────
//  INCIDENT LOG
// ─────────────────────────────────────────────
function addLog(msg, level) {
    const list = document.getElementById('log-list');
    const now = new Date();
    const ts = String(now.getUTCHours()).padStart(2, '0') + ':'
        + String(now.getUTCMinutes()).padStart(2, '0') + ':'
        + String(now.getUTCSeconds()).padStart(2, '0');
    const div = document.createElement('div');
    div.className = 'log-entry ' + level;
    div.innerHTML = `<span class="log-dot"></span><span class="log-time">${ts}</span><span class="log-msg">${msg}</span>`;
    list.insertBefore(div, list.firstChild);
    if (list.children.length > 20) list.removeChild(list.lastChild);
}

// ─────────────────────────────────────────────
//  TOP BAR STATUS
// ─────────────────────────────────────────────
function setSystemStatus(level) {
    const el = document.getElementById('sys-status');
    const net = document.getElementById('net-status');
    if (level === 'critical') {
        el.innerHTML = '<span class="dot"></span> Threat Active'; el.className = 'status-badge danger';
        net.innerHTML = '<span class="dot"></span> Comm Anomaly'; net.className = 'status-badge danger';
    } else if (level === 'suspicious') {
        el.innerHTML = '<span class="dot"></span> Suspicious'; el.className = 'status-badge warning';
        net.innerHTML = '<span class="dot"></span> Monitoring'; net.className = 'status-badge warning';
    } else {
        el.innerHTML = '<span class="dot"></span> System Online'; el.className = 'status-badge online';
        net.innerHTML = '<span class="dot"></span> Network Nominal'; net.className = 'status-badge online';
    }
}

// ─────────────────────────────────────────────
//  ATTACK SIMULATION
// ─────────────────────────────────────────────
window.simulate = function (mode) {
    currentMode = mode;

    if (mode === 'normal') {
        setSystemStatus('normal');
        for (let i = 0; i < 5; i++) setSatStatus(i, 'safe', 'NOMINAL');
        document.getElementById('alert-banner').classList.remove('show');
        addLog('System returned to nominal — all clear', 'safe');
        clearTimeout(alertTimer);
        clearTimeout(window._bannerTimer);
        return;
    }

    const victimIdx = Math.floor(Math.random() * 5);
    setSatStatus(victimIdx, 'critical', 'COMPROMISED');
    setSatStatus((victimIdx + 1) % 5, 'suspicious', 'SUSPICIOUS');

    const banner = document.getElementById('alert-banner');
    const satName = satelliteData[victimIdx].name;

    if (mode === 'spoof') {
        banner.textContent = `⚠ Command Spoofing — ${satName}`;
        addLog(`CMD Spoof on ${satName}`, 'crit');
        addLog('Anomalous command frequency detected', 'warn');
        setSystemStatus('critical');
    } else if (mode === 'inject') {
        banner.textContent = `⚠ Signal Injection — ${satName}`;
        addLog(`Signal Injection on ${satName}`, 'crit');
        addLog('Abnormal RF spike in telemetry band', 'warn');
        setSystemStatus('critical');
    } else if (mode === 'manip') {
        banner.textContent = `⚠ Telemetry Manipulation Detected`;
        addLog(`Tele Manip — sensor drift on ${satName}`, 'crit');
        addLog('Gradual sensor value falsification', 'warn');
        setSystemStatus('suspicious');
    } else if (mode === 'hw') {
        banner.textContent = `⚠ Hardware Degradation Detected`;
        addLog(`HW Degradation — power drop on ${satName}`, 'warn');
        addLog('Thermal variance exceeding norms', 'warn');
        setSystemStatus('suspicious');
    }

    banner.classList.add('show');
    clearTimeout(alertTimer);
    alertTimer = setTimeout(() => banner.classList.remove('show'), 7000);
};

// Initial log entries
addLog('SatGuard AI Immune System online', 'safe');
addLog('Isolation Forest model loaded', 'safe');
addLog('Random Forest classifier loaded', 'safe');
addLog('Monitoring 5 active satellites', 'safe');

// ─────────────────────────────────────────────
//  ANIMATION LOOP
// ─────────────────────────────────────────────
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    earth.rotation.y = t * 0.040;   // Earth rotates east
    clouds.rotation.y = t * 0.044;   // Clouds drift slightly faster — realistic

    satellites.forEach((s, i) => {
        // Position in pivot local XZ plane - guaranteed to match orbit ring
        const theta = s.phase + t * s.orbitSpeed;
        s.mesh.position.set(
            Math.cos(theta) * s.orbitRadius,
            0,
            Math.sin(theta) * s.orbitRadius
        );
        s.mesh.lookAt(new THREE.Vector3(0, 0, 0));


        // Nav light blinking - alternating at different rates per satellite
        const blink = Math.sin(t * 3.5 + i * 1.2) > 0.4;
        s.navGlowR.material.opacity = blink ? 0.85 : 0.08;
        s.navGlowG.material.opacity = blink ? 0.08 : 0.85;

        // Status visuals
        if (s.status === 'critical') {
            const pulse = 0.5 + 0.5 * Math.sin(t * 6);
            s.sprite.material.opacity = pulse * 0.9;
            s.body.material.emissive.setHex(0xf85149);
            s.body.material.emissiveIntensity = 0.8;
        } else if (s.status === 'suspicious') {
            s.sprite.material.opacity = 0.5;
            s.body.material.emissive.setHex(0xd29922);
            s.body.material.emissiveIntensity = 0.6;
        } else {
            s.sprite.material.opacity = 0.25 + 0.12 * Math.sin(t * 1.5 + i);
            s.body.material.emissive.set(s.data.color);
            s.body.material.emissiveIntensity = 0.3 + 0.1 * Math.sin(t * 1.5 + i);
        }
    });


    camera.position.x = Math.sin(t * 0.04) * 0.1;
    camera.position.y = Math.sin(t * 0.025) * 0.06;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});