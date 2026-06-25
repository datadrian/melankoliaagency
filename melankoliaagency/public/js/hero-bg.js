/* ================================================
   MELANKOLIA AGENCY — 3D LOGO STRUCTURE
   The logo is laid flat — rotated 90° on X axis —
   like an enormous floor/ceiling structure.
   Camera drifts slowly through it, above and below.
   You might not even know what you're flying through.
   All white. Massive scale. No mouse input.
   ================================================ */
(function () {
  const canvas = document.getElementById('heroCanvas');
  if (!canvas || typeof THREE === 'undefined') return;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, 0.008); // very gentle fog — structure is massive

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);

  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  /* ---- LIGHTING — pure white, no colour ---- */
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
  keyLight.position.set(0, 1, 0.5);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
  fillLight.position.set(0, -1, 0.5);
  scene.add(fillLight);

  /* ---- MATERIALS — white only ---- */
  const matFace = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 0.06,
    metalness: 0.2,
    roughness: 0.7,
    transparent: true,
    opacity: 0.10,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const matEdge = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.28,
  });

  /* ---- SVG PATHS ---- */
  const SVG_W = 792, SVG_H = 612;
  // Scale: make the structure enormous — ~200 world units wide
  // (screen feels like you're inside something tens of km across)
  const WORLD_SCALE = 200 / SVG_W;  // 792px → 200 units
  const EXTRUDE_DEPTH = 18;          // thick slabs

  const pathStrings = [
    "M214.58,440.24c-41.14,0-82.29-.07-123.43.1-4.99.02-8.13-1.41-10.4-5.97-2.86-5.75-6.1-11.37-9.69-16.7-2.8-4.16-2.73-7.53-.2-11.87,22.33-38.35,44.46-76.82,66.63-115.27,18.87-32.72,37.82-65.39,56.49-98.22,3.01-5.29,6.35-8.08,12.73-7.43,5.69.58,11.53.51,17.24.01,5.54-.48,8.53,1.87,11.16,6.47,24.39,42.59,48.96,85.09,73.48,127.61,16.79,29.1,33.54,58.21,50.46,87.24,2.18,3.75,2.51,6.79.08,10.56-3.77,5.84-7.28,11.88-10.45,18.07-2.14,4.18-5.11,5.49-9.63,5.48-41.49-.12-82.99-.07-124.48-.07ZM144.3,346.69c-16.17,28-31.86,55.16-48,83.1,3.49,0,5.74,0,8,0,56.84,0,113.68,0,170.53,0,20.05,0,40.1.03,60.15-.07,1.75,0,4.24-.36,5.09-1.51,2.51-3.41,4.36-7.3,6.87-11.7-2.98,0-4.87,0-6.76,0-31.73,0-63.47.01-95.2,0-8.6,0-10.38-3.09-6.09-10.5,8.36-14.47,16.75-28.93,25.07-43.43.72-1.25,1.76-3.14,1.31-4.1-1.87-3.94-4.26-7.64-6.76-11.95-1.57,2.65-2.66,4.42-3.7,6.23-11.38,19.76-22.82,39.49-34.08,59.32-1.88,3.31-4.12,4.53-7.92,4.51-27.2-.14-54.4-.07-81.6-.08-8.95,0-10.7-3-6.23-10.75,8.25-14.33,16.58-28.62,24.75-43,.82-1.45,1.54-3.75.96-5.06-1.6-3.6-3.91-6.89-6.37-11.02ZM87.38,423.73c1.06-1.73,1.98-3.15,2.82-4.61,16.13-27.88,32.24-55.77,48.39-83.64,3.72-6.41,7.73-6.4,11.45,0,8.5,14.6,16.9,29.25,25.43,43.83.8,1.37,2.12,3.29,3.36,3.42,4.16.43,8.38.16,13.25.16-1.45-2.64-2.34-4.32-3.29-5.96-11.2-19.47-22.3-39-33.71-58.35-2.56-4.34-2.45-7.72.07-12.02,13.31-22.67,26.34-45.51,39.48-68.28,5.07-8.79,8.54-8.7,13.69.25,8,13.88,15.97,27.77,24.07,41.59.87,1.49,2.4,3.42,3.83,3.61,3.88.5,7.87.17,12.99.17-16.15-28.04-31.73-55.09-47.67-82.76-1.27,1.96-2.25,3.34-3.09,4.79-37.51,64.99-75.01,130-112.51,195q-6.34,11,.43,21.89c.09.14.25.24.99.91ZM346.39,405.94c-1.07-1.98-1.83-3.48-2.67-4.93-14.7-25.49-29.41-50.96-44.1-76.45-23.89-41.47-47.75-82.96-71.68-124.41-.99-1.71-2.41-4.16-3.91-4.38-4.11-.61-8.38-.21-13.38-.21,1.56,2.84,2.53,4.67,3.56,6.45,15.74,27.29,31.49,54.57,47.22,81.86,4.23,7.34,2.34,10.68-6.09,10.7-16.56.04-33.13-.03-49.69.08-1.75.01-4.23.36-5.09,1.5-2.44,3.26-4.23,7.02-6.7,11.34,2.89,0,4.76,0,6.64,0,22.67.01,45.33.18,68-.09,4.91-.06,7.58,1.68,9.91,5.78,13.24,23.31,26.69,46.49,40.05,69.73,4.14,7.2,2.14,10.53-6.36,10.54-16.56.02-33.13-.04-49.69.08-1.67.01-4.01.57-4.88,1.73-2.35,3.13-4.08,6.72-6.36,10.67h95.23Z",
    "M400.71,84.68c41.14,0,82.29.07,123.43-.1,4.99-.02,8.13,1.41,10.4,5.97,2.86,5.75,6.1,11.37,9.69,16.7,2.8,4.16,2.73,7.53.2,11.87-22.33,38.35-44.46,76.82-66.63,115.27-18.87,32.72-37.82,65.39-56.49,98.22-3.01,5.29-6.35,8.08-12.73,7.43-5.69-.58-11.53-.51-17.24-.01-5.54.48-8.53-1.87-11.16-6.47-24.39-42.59-48.96-85.09-73.48-127.61-16.79-29.1-33.54-58.21-50.46-87.24-2.18-3.75-2.51-6.79-.08-10.56,3.77-5.84,7.28-11.88,10.45-18.07,2.14-4.18,5.11-5.49,9.63-5.48,41.49.12,82.99.07,124.48.07ZM470.99,178.24c16.17-28,31.86-55.16,48-83.1-3.49,0-5.74,0-8,0-56.84,0-113.68,0-170.53,0-20.05,0-40.1-.03-60.15.07-1.75,0-4.24.36-5.09,1.51-2.51,3.41-4.36,7.3-6.87,11.7,2.98,0,4.87,0,6.76,0,31.73,0,63.47-.01,95.2,0,8.6,0,10.38,3.09,6.09,10.5-8.36,14.47-16.75,28.93-25.07,43.43-.72,1.25-1.76,3.14-1.31,4.1,1.87,3.94,4.26,7.64,6.76,11.95,1.57-2.65,2.66-4.42,3.7-6.23,11.38-19.76,22.82-39.49,34.08-59.32,1.88-3.31,4.12-4.53,7.92-4.51,27.2.14,54.4.07,81.6.08,8.95,0,10.7,3,6.23,10.75-8.25,14.33-16.58,28.62-24.75,43-.82,1.45-1.54,3.75-.96,5.06,1.6,3.6,3.91,6.89,6.37,11.02ZM527.91,101.19c-1.06,1.73-1.98,3.15-2.82,4.61-16.13,27.88-32.24,55.77-48.39,83.64-3.72,6.41-7.73,6.4-11.45,0-8.5-14.6-16.9-29.25-25.43-43.83-.8-1.37-2.12-3.29-3.36-3.42-4.16-.43-8.38-.16-13.25-.16,1.45,2.64,2.34,4.32,3.29,5.96,11.2,19.47,22.3,39,33.71,58.35,2.56,4.34,2.45,7.72-.07,12.02-13.31,22.67-26.34,45.51-39.48,68.28-5.07,8.79-8.54,8.7-13.69-.25-8-13.88-15.97-27.77-24.07-41.59-.87-1.49-2.4-3.42-3.83-3.61-3.88-.5-7.87-.17-12.99-.17,16.15,28.04,31.73,55.09,47.67,82.76,1.27-1.96,2.25-3.34,3.09-4.79,37.51-64.99,75.01-130,112.51-195q6.34-11-.43-21.89c-.09-.14-.25-.24-.99-.91ZM268.9,118.98c1.07,1.98,1.83,3.48,2.67,4.93,14.7,25.49,29.41,50.96,44.1,76.45,23.89,41.47,47.75,82.96,71.68,124.41.99,1.71,2.41,4.16,3.91,4.38,4.11.61,8.38.21,13.38.21-1.56-2.84-2.53-4.67-3.56-6.45-15.74-27.29-31.49-54.57-47.22-81.86-4.23-7.34-2.34-10.68,6.09-10.7,16.56-.04,33.13.03,49.69-.08,1.75-.01,4.23-.36,5.09-1.5,2.44-3.26,4.23-7.02,6.7-11.34-2.89,0-4.76,0-6.64,0-22.67-.01-45.33-.18-68,.09-4.91.06-7.58-1.68-9.91-5.78-13.24-23.31-26.69-46.49-40.05-69.73-4.14-7.2-2.14-10.53,6.36-10.54,16.56-.02,33.13.04,49.69-.08,1.67-.01,4.01-.57,4.88-1.73,2.35-3.13,4.08-6.72,6.36-10.67h-95.23Z",
    "M584.54,442.76c-41.14,0-82.29-.07-123.43.1-4.99.02-8.13-1.41-10.4-5.97-2.86-5.75-6.1-11.37-9.69-16.7-2.8-4.16-2.73-7.53-.2-11.87,22.33-38.35,44.46-76.82,66.63-115.27,18.87-32.72,37.82-65.39,56.49-98.22,3.01-5.29,6.35-8.08,12.73-7.43,5.69.58,11.53.51,17.24.01,5.54-.48,8.53,1.87,11.16,6.47,24.39,42.59,48.96,85.09,73.48,127.61,16.79,29.1,33.54,58.21,50.46,87.24,2.18,3.75,2.51,6.79.08,10.56-3.77,5.84-7.28,11.88-10.45,18.07-2.14,4.18-5.11,5.49-9.63,5.48-41.49-.12-82.99-.07-124.48-.07ZM514.26,349.21c-16.17,28-31.86,55.16-48,83.1,3.49,0,5.74,0,8,0,56.84,0,113.68,0,170.53,0,20.05,0,40.1.03,60.15-.07,1.75,0,4.24-.36,5.09-1.51,2.51-3.41,4.36-7.3,6.87-11.7-2.98,0-4.87,0-6.76,0-31.73,0-63.47.01-95.2,0-8.6,0-10.38-3.09-6.09-10.5,8.36-14.47,16.75-28.93,25.07-43.43.72-1.25,1.76-3.14,1.31-4.1-1.87-3.94-4.26-7.64-6.76-11.95-1.57,2.65-2.66,4.42-3.7,6.23-11.38,19.76-22.82,39.49-34.08,59.32-1.88,3.31-4.12,4.53-7.92,4.51-27.2-.14-54.4-.07-81.6-.08-8.95,0-10.7-3-6.23-10.75,8.25-14.33,16.58-28.62,24.75-43,.82-1.45,1.54-3.75.96-5.06-1.6-3.6-3.91-6.89-6.37-11.02ZM457.34,426.25c1.06-1.73,1.98-3.15,2.82-4.61,16.13-27.88,32.24-55.77,48.39-83.64,3.72-6.41,7.73-6.4,11.45,0,8.5,14.6,16.9,29.25,25.43,43.83.8,1.37,2.12,3.29,3.36,3.42,4.16.43,8.38.16,13.25.16-1.45-2.64-2.34-4.32-3.29-5.96-11.2-19.47-22.3-39-33.71-58.35-2.56-4.34-2.45-7.72.07-12.02,13.31-22.67,26.34-45.51,39.48-68.28,5.07-8.79,8.54-8.7,13.69.25,8,13.88,15.97,27.77,24.07,41.59.87,1.49,2.4,3.42,3.83,3.61,3.88.5,7.87.17,12.99.17-16.15-28.04-31.73-55.09-47.67-82.76-1.27,1.96-2.25,3.34-3.09,4.79-37.51,64.99-75.01,130-112.51,195q-6.34,11,.43,21.89c.09.14.25.24.99.91ZM716.35,408.46c-1.07-1.98-1.83-3.48-2.67-4.93-14.7-25.49-29.41-50.96-44.1-76.45-23.89-41.47-47.75-82.96-71.68-124.41-.99-1.71-2.41-4.16-3.91-4.38-4.11-.61-8.38-.21-13.38-.21,1.56,2.84,2.53,4.67,3.56,6.45,15.74,27.29,31.49,54.57,47.22,81.86,4.23,7.34,2.34,10.68-6.09,10.7-16.56.04-33.13-.03-49.69.08-1.75.01-4.23.36-5.09,1.5-2.44,3.26-4.23,7.02-6.7,11.34,2.89,0,4.76,0,6.64,0,22.67.01,45.33.18,68-.09,4.91-.06,7.58,1.68,9.91,5.78,13.24,23.31,26.69,46.49,40.05,69.73,4.14,7.2,2.14,10.53-6.36,10.54-16.56.02-33.13-.04-49.69.08-1.67.01-4.01.57-4.88,1.73-2.35,3.13-4.08,6.72-6.36,10.67h95.23Z"
  ];

  /* ---- PARSE SVG PATH → sampled THREE.Shape ---- */
  function parseSVGPath(d) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', SVG_W);
    svg.setAttribute('height', SVG_H);
    svg.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden';
    document.body.appendChild(svg);
    const el = document.createElementNS(ns, 'path');
    el.setAttribute('d', d);
    svg.appendChild(el);
    const len = el.getTotalLength();
    const SAMPLES = 400;
    const pts = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const p = el.getPointAtLength((i / SAMPLES) * len);
      pts.push(new THREE.Vector2(
        (p.x - SVG_W / 2) * WORLD_SCALE,
        -(p.y - SVG_H / 2) * WORLD_SCALE
      ));
    }
    document.body.removeChild(svg);
    return new THREE.Shape(pts);
  }

  /* ---- BUILD ONE LOGO GROUP ---- */
  function buildLogo() {
    const group = new THREE.Group();
    pathStrings.forEach(d => {
      const shape = parseSVGPath(d);
      // Extruded solid
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: EXTRUDE_DEPTH,
        bevelEnabled: true,
        bevelThickness: 0.4,
        bevelSize: 0.3,
        bevelSegments: 3,
        curveSegments: 20,
      });
      geo.translate(0, 0, -EXTRUDE_DEPTH / 2);
      group.add(new THREE.Mesh(geo, matFace.clone()));
      // White edge lines only
      const edges = new THREE.EdgesGeometry(geo, 12);
      group.add(new THREE.LineSegments(edges, matEdge.clone()));
    });

    // KEY: rotate the entire logo 90° on X so it lies flat —
    // XZ plane, like an enormous floor/ceiling panel
    // Camera will fly above it, through its thickness, below it
    group.rotation.x = Math.PI / 2;

    return group;
  }

  /* ---- INSTANCES along Y axis ----
     Since structure is now flat (XZ plane), we stack instances
     vertically (Y) and also along Z so the camera passes through
     layers as it drifts
  */
  const template = buildLogo();

  // Place several instances at different Y heights and Z positions
  // to create the sense of infinite layered architecture
  const INSTANCES = [
    { x:   0, y:  30, z:    0 },
    { x:   0, y: -30, z:    0 },
    { x:  20, y:   5, z: -180 },
    { x: -20, y:  -5, z: -180 },
    { x:   0, y:  30, z: -360 },
    { x:   0, y: -30, z: -360 },
    { x:  20, y:   5, z: -540 },
    { x: -20, y:  -5, z: -540 },
  ];

  const meshInstances = [];
  INSTANCES.forEach(({ x, y, z }) => {
    const inst = template.clone(true);
    inst.position.set(x, y, z);
    scene.add(inst);
    meshInstances.push(inst);
  });

  const RECYCLE_DEPTH = 720; // total z span before recycling

  /* ---- SPARSE WHITE PARTICLES ---- */
  const PC = 800;
  const pArr = new Float32Array(PC * 3);
  for (let i = 0; i < PC; i++) {
    pArr[i*3]   = (Math.random()-0.5) * 400;
    pArr[i*3+1] = (Math.random()-0.5) * 120;
    pArr[i*3+2] = -(Math.random() * RECYCLE_DEPTH);
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pArr, 3));
  scene.add(new THREE.Points(pGeo, new THREE.PointsMaterial({
    color: 0xffffff, size: 0.25, transparent: true, opacity: 0.2, sizeAttenuation: true,
  })));

  /* ---- AUTONOMOUS CAMERA ----
     Drifts forward along -Z at a glacial pace.
     Y oscillates slowly — rising above the structure,
     sinking down through it, passing below.
     X drifts gently side to side.
     Camera always looks slightly ahead and level —
     so you see the edge of the structure at an angle,
     never head-on.
  */
  camera.position.set(8, 18, 60);

  let elapsed = 0;
  const FWD_SPEED = 0.05; // world units per frame — slow for a massive structure

  // LookAt target — always slightly ahead, with gentle drift
  const lookTarget = new THREE.Vector3();

  function tick() {
    requestAnimationFrame(tick);
    elapsed += 0.004;

    // Forward drift
    camera.position.z -= FWD_SPEED;

    // Slow vertical oscillation — above → through → below the flat structure
    // Period ~2000 frames = very slow pass
    camera.position.y = Math.sin(elapsed * 0.18) * 55;

    // Gentle lateral drift — never centred, always slightly off-axis
    camera.position.x = Math.sin(elapsed * 0.11 + 1.2) * 22;

    // Look slightly ahead and toward the structure centre
    // Tilt down when above, tilt up when below
    lookTarget.set(
      camera.position.x * 0.3,           // converge toward centre X
      camera.position.y * 0.1,           // look slightly toward Y=0 (the structure plane)
      camera.position.z - 80             // always looking ahead
    );
    camera.lookAt(lookTarget);

    // Subtle roll — like a ship banking
    camera.rotation.z = Math.sin(elapsed * 0.09) * 0.04;

    // Recycle instances
    meshInstances.forEach(inst => {
      if (inst.position.z > camera.position.z + 200) {
        inst.position.z -= RECYCLE_DEPTH;
      }
    });

    // Recycle particles
    const pa = pGeo.attributes.position.array;
    for (let i = 0; i < PC; i++) {
      if (pa[i*3+2] > camera.position.z + 80) pa[i*3+2] -= RECYCLE_DEPTH;
    }
    pGeo.attributes.position.needsUpdate = true;

    renderer.render(scene, camera);
  }

  tick();
})();
