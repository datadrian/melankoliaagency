/* ================================================
   MELANKOLIA AGENCY — 3D LOGO STRUCTURE
   The logo mark is extruded into thick 3D geometry.
   Camera drifts autonomously through it — above,
   below, banking around — like flying inside a
   massive dark structure. Empire Strikes Back energy.
   ================================================ */
(function () {
  const canvas = document.getElementById('heroCanvas');
  if (!canvas || typeof THREE === 'undefined') return;

  /* ---- RENDERER ---- */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x000000, 1);
  renderer.shadowMap.enabled = false;

  /* ---- SCENE ---- */
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, 0.022);

  /* ---- CAMERA ---- */
  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 500);

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  /* ---- MATERIALS ---- */
  const matFace = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x888888,
    emissiveIntensity: 0.25,
    metalness: 0.6,
    roughness: 0.5,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const matEdge = new THREE.MeshStandardMaterial({
    color: 0xc8a96e,
    emissive: 0xc8a96e,
    emissiveIntensity: 0.5,
    metalness: 0.8,
    roughness: 0.3,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  /* ---- LIGHTS ---- */
  scene.add(new THREE.AmbientLight(0x111111, 1));

  const rimLight1 = new THREE.PointLight(0xc8a96e, 3, 120);
  rimLight1.position.set(30, 20, -10);
  scene.add(rimLight1);

  const rimLight2 = new THREE.PointLight(0x4466ff, 1.5, 100);
  rimLight2.position.set(-40, -15, 20);
  scene.add(rimLight2);

  /* ---- SVG PATH DATA — all 3 shapes of the logo ---- */
  // SVG viewBox: 792 x 612. We normalise to world units.
  // Three.js SVGLoader parses the d= strings directly.

  const SVG_W = 792, SVG_H = 612;
  const WORLD_SCALE = 1 / 40;   // 792px → ~19.8 world units wide
  const EXTRUDE_DEPTH = 4.5;    // how thick (world units)

  const pathStrings = [
    "M214.58,440.24c-41.14,0-82.29-.07-123.43.1-4.99.02-8.13-1.41-10.4-5.97-2.86-5.75-6.1-11.37-9.69-16.7-2.8-4.16-2.73-7.53-.2-11.87,22.33-38.35,44.46-76.82,66.63-115.27,18.87-32.72,37.82-65.39,56.49-98.22,3.01-5.29,6.35-8.08,12.73-7.43,5.69.58,11.53.51,17.24.01,5.54-.48,8.53,1.87,11.16,6.47,24.39,42.59,48.96,85.09,73.48,127.61,16.79,29.1,33.54,58.21,50.46,87.24,2.18,3.75,2.51,6.79.08,10.56-3.77,5.84-7.28,11.88-10.45,18.07-2.14,4.18-5.11,5.49-9.63,5.48-41.49-.12-82.99-.07-124.48-.07ZM144.3,346.69c-16.17,28-31.86,55.16-48,83.1,3.49,0,5.74,0,8,0,56.84,0,113.68,0,170.53,0,20.05,0,40.1.03,60.15-.07,1.75,0,4.24-.36,5.09-1.51,2.51-3.41,4.36-7.3,6.87-11.7-2.98,0-4.87,0-6.76,0-31.73,0-63.47.01-95.2,0-8.6,0-10.38-3.09-6.09-10.5,8.36-14.47,16.75-28.93,25.07-43.43.72-1.25,1.76-3.14,1.31-4.1-1.87-3.94-4.26-7.64-6.76-11.95-1.57,2.65-2.66,4.42-3.7,6.23-11.38,19.76-22.82,39.49-34.08,59.32-1.88,3.31-4.12,4.53-7.92,4.51-27.2-.14-54.4-.07-81.6-.08-8.95,0-10.7-3-6.23-10.75,8.25-14.33,16.58-28.62,24.75-43,.82-1.45,1.54-3.75.96-5.06-1.6-3.6-3.91-6.89-6.37-11.02ZM87.38,423.73c1.06-1.73,1.98-3.15,2.82-4.61,16.13-27.88,32.24-55.77,48.39-83.64,3.72-6.41,7.73-6.4,11.45,0,8.5,14.6,16.9,29.25,25.43,43.83.8,1.37,2.12,3.29,3.36,3.42,4.16.43,8.38.16,13.25.16-1.45-2.64-2.34-4.32-3.29-5.96-11.2-19.47-22.3-39-33.71-58.35-2.56-4.34-2.45-7.72.07-12.02,13.31-22.67,26.34-45.51,39.48-68.28,5.07-8.79,8.54-8.7,13.69.25,8,13.88,15.97,27.77,24.07,41.59.87,1.49,2.4,3.42,3.83,3.61,3.88.5,7.87.17,12.99.17-16.15-28.04-31.73-55.09-47.67-82.76-1.27,1.96-2.25,3.34-3.09,4.79-37.51,64.99-75.01,130-112.51,195q-6.34,11,.43,21.89c.09.14.25.24.99.91ZM346.39,405.94c-1.07-1.98-1.83-3.48-2.67-4.93-14.7-25.49-29.41-50.96-44.1-76.45-23.89-41.47-47.75-82.96-71.68-124.41-.99-1.71-2.41-4.16-3.91-4.38-4.11-.61-8.38-.21-13.38-.21,1.56,2.84,2.53,4.67,3.56,6.45,15.74,27.29,31.49,54.57,47.22,81.86,4.23,7.34,2.34,10.68-6.09,10.7-16.56.04-33.13-.03-49.69.08-1.75.01-4.23.36-5.09,1.5-2.44,3.26-4.23,7.02-6.7,11.34,2.89,0,4.76,0,6.64,0,22.67.01,45.33.18,68-.09,4.91-.06,7.58,1.68,9.91,5.78,13.24,23.31,26.69,46.49,40.05,69.73,4.14,7.2,2.14,10.53-6.36,10.54-16.56.02-33.13-.04-49.69.08-1.67.01-4.01.57-4.88,1.73-2.35,3.13-4.08,6.72-6.36,10.67h95.23Z",
    "M400.71,84.68c41.14,0,82.29.07,123.43-.1,4.99-.02,8.13,1.41,10.4,5.97,2.86,5.75,6.1,11.37,9.69,16.7,2.8,4.16,2.73,7.53.2,11.87-22.33,38.35-44.46,76.82-66.63,115.27-18.87,32.72-37.82,65.39-56.49,98.22-3.01,5.29-6.35,8.08-12.73,7.43-5.69-.58-11.53-.51-17.24-.01-5.54.48-8.53-1.87-11.16-6.47-24.39-42.59-48.96-85.09-73.48-127.61-16.79-29.1-33.54-58.21-50.46-87.24-2.18-3.75-2.51-6.79-.08-10.56,3.77-5.84,7.28-11.88,10.45-18.07,2.14-4.18,5.11-5.49,9.63-5.48,41.49.12,82.99.07,124.48.07ZM470.99,178.24c16.17-28,31.86-55.16,48-83.1-3.49,0-5.74,0-8,0-56.84,0-113.68,0-170.53,0-20.05,0-40.1-.03-60.15.07-1.75,0-4.24.36-5.09,1.51-2.51,3.41-4.36,7.3-6.87,11.7,2.98,0,4.87,0,6.76,0,31.73,0,63.47-.01,95.2,0,8.6,0,10.38,3.09,6.09,10.5-8.36,14.47-16.75,28.93-25.07,43.43-.72,1.25-1.76,3.14-1.31,4.1,1.87,3.94,4.26,7.64,6.76,11.95,1.57-2.65,2.66-4.42,3.7-6.23,11.38-19.76,22.82-39.49,34.08-59.32,1.88-3.31,4.12-4.53,7.92-4.51,27.2.14,54.4.07,81.6.08,8.95,0,10.7,3,6.23,10.75-8.25,14.33-16.58,28.62-24.75,43-.82,1.45-1.54,3.75-.96,5.06,1.6,3.6,3.91,6.89,6.37,11.02ZM527.91,101.19c-1.06,1.73-1.98,3.15-2.82,4.61-16.13,27.88-32.24,55.77-48.39,83.64-3.72,6.41-7.73,6.4-11.45,0-8.5-14.6-16.9-29.25-25.43-43.83-.8-1.37-2.12-3.29-3.36-3.42-4.16-.43-8.38-.16-13.25-.16,1.45,2.64,2.34,4.32,3.29,5.96,11.2,19.47,22.3,39,33.71,58.35,2.56,4.34,2.45,7.72-.07,12.02-13.31,22.67-26.34,45.51-39.48,68.28-5.07,8.79-8.54,8.7-13.69-.25-8-13.88-15.97-27.77-24.07-41.59-.87-1.49-2.4-3.42-3.83-3.61-3.88-.5-7.87-.17-12.99-.17,16.15,28.04,31.73,55.09,47.67,82.76,1.27-1.96,2.25-3.34,3.09-4.79,37.51-64.99,75.01-130,112.51-195q6.34-11-.43-21.89c-.09-.14-.25-.24-.99-.91ZM268.9,118.98c1.07,1.98,1.83,3.48,2.67,4.93,14.7,25.49,29.41,50.96,44.1,76.45,23.89,41.47,47.75,82.96,71.68,124.41.99,1.71,2.41,4.16,3.91,4.38,4.11.61,8.38.21,13.38.21-1.56-2.84-2.53-4.67-3.56-6.45-15.74-27.29-31.49-54.57-47.22-81.86-4.23-7.34-2.34-10.68,6.09-10.7,16.56-.04,33.13.03,49.69-.08,1.75-.01,4.23-.36,5.09-1.5,2.44-3.26,4.23-7.02,6.7-11.34-2.89,0-4.76,0-6.64,0-22.67-.01-45.33-.18-68,.09-4.91.06-7.58-1.68-9.91-5.78-13.24-23.31-26.69-46.49-40.05-69.73-4.14-7.2-2.14-10.53,6.36-10.54,16.56-.02,33.13.04,49.69-.08,1.67-.01,4.01-.57,4.88-1.73,2.35-3.13,4.08-6.72,6.36-10.67h-95.23Z",
    "M584.54,442.76c-41.14,0-82.29-.07-123.43.1-4.99.02-8.13-1.41-10.4-5.97-2.86-5.75-6.1-11.37-9.69-16.7-2.8-4.16-2.73-7.53-.2-11.87,22.33-38.35,44.46-76.82,66.63-115.27,18.87-32.72,37.82-65.39,56.49-98.22,3.01-5.29,6.35-8.08,12.73-7.43,5.69.58,11.53.51,17.24.01,5.54-.48,8.53,1.87,11.16,6.47,24.39,42.59,48.96,85.09,73.48,127.61,16.79,29.1,33.54,58.21,50.46,87.24,2.18,3.75,2.51,6.79.08,10.56-3.77,5.84-7.28,11.88-10.45,18.07-2.14,4.18-5.11,5.49-9.63,5.48-41.49-.12-82.99-.07-124.48-.07ZM514.26,349.21c-16.17,28-31.86,55.16-48,83.1,3.49,0,5.74,0,8,0,56.84,0,113.68,0,170.53,0,20.05,0,40.1.03,60.15-.07,1.75,0,4.24-.36,5.09-1.51,2.51-3.41,4.36-7.3,6.87-11.7-2.98,0-4.87,0-6.76,0-31.73,0-63.47.01-95.2,0-8.6,0-10.38-3.09-6.09-10.5,8.36-14.47,16.75-28.93,25.07-43.43.72-1.25,1.76-3.14,1.31-4.1-1.87-3.94-4.26-7.64-6.76-11.95-1.57,2.65-2.66,4.42-3.7,6.23-11.38,19.76-22.82,39.49-34.08,59.32-1.88,3.31-4.12,4.53-7.92,4.51-27.2-.14-54.4-.07-81.6-.08-8.95,0-10.7-3-6.23-10.75,8.25-14.33,16.58-28.62,24.75-43,.82-1.45,1.54-3.75.96-5.06-1.6-3.6-3.91-6.89-6.37-11.02ZM457.34,426.25c1.06-1.73,1.98-3.15,2.82-4.61,16.13-27.88,32.24-55.77,48.39-83.64,3.72-6.41,7.73-6.4,11.45,0,8.5,14.6,16.9,29.25,25.43,43.83.8,1.37,2.12,3.29,3.36,3.42,4.16.43,8.38.16,13.25.16-1.45-2.64-2.34-4.32-3.29-5.96-11.2-19.47-22.3-39-33.71-58.35-2.56-4.34-2.45-7.72.07-12.02,13.31-22.67,26.34-45.51,39.48-68.28,5.07-8.79,8.54-8.7,13.69.25,8,13.88,15.97,27.77,24.07,41.59.87,1.49,2.4,3.42,3.83,3.61,3.88.5,7.87.17,12.99.17-16.15-28.04-31.73-55.09-47.67-82.76-1.27,1.96-2.25,3.34-3.09,4.79-37.51,64.99-75.01,130-112.51,195q-6.34,11,.43,21.89c.09.14.25.24.99.91ZM716.35,408.46c-1.07-1.98-1.83-3.48-2.67-4.93-14.7-25.49-29.41-50.96-44.1-76.45-23.89-41.47-47.75-82.96-71.68-124.41-.99-1.71-2.41-4.16-3.91-4.38-4.11-.61-8.38-.21-13.38-.21,1.56,2.84,2.53,4.67,3.56,6.45,15.74,27.29,31.49,54.57,47.22,81.86,4.23,7.34,2.34,10.68-6.09,10.7-16.56.04-33.13-.03-49.69.08-1.75.01-4.23.36-5.09,1.5-2.44,3.26-4.23,7.02-6.7,11.34,2.89,0,4.76,0,6.64,0,22.67.01,45.33.18,68-.09,4.91-.06,7.58,1.68,9.91,5.78,13.24,23.31,26.69,46.49,40.05,69.73,4.14,7.2,2.14,10.53-6.36,10.54-16.56.02-33.13-.04-49.69.08-1.67.01-4.01.57-4.88,1.73-2.35,3.13-4.08,6.72-6.36,10.67h95.23Z"
  ];

  /* ---- PARSE SVG PATHS → THREE.Shape via SVGLoader ---- */
  // SVGLoader is in the Three.js addons — load inline since we can't import modules easily.
  // We'll use a minimal custom parser for the path → Shape conversion.

  function parseSVGPath(d) {
    // Use an SVG element to get the path's points via getPointAtLength
    // This gives us a sampled polyline we can feed to THREE.Shape
    const ns = 'http://www.w3.org/2000/svg';
    const svgEl = document.createElementNS(ns, 'svg');
    svgEl.setAttribute('width', SVG_W);
    svgEl.setAttribute('height', SVG_H);
    svgEl.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden';
    document.body.appendChild(svgEl);

    const pathEl = document.createElementNS(ns, 'path');
    pathEl.setAttribute('d', d);
    svgEl.appendChild(pathEl);

    const totalLength = pathEl.getTotalLength();
    // Sample points along the path — more samples = smoother shape
    const SAMPLES = 320;
    const points2D = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const pt = pathEl.getPointAtLength((i / SAMPLES) * totalLength);
      // Flip Y (SVG Y is down, Three.js Y is up), centre on origin
      points2D.push(new THREE.Vector2(
        (pt.x - SVG_W / 2) * WORLD_SCALE,
        -(pt.y - SVG_H / 2) * WORLD_SCALE
      ));
    }

    document.body.removeChild(svgEl);

    // Build a single Shape from the sampled outline
    const shape = new THREE.Shape(points2D);
    return shape;
  }

  /* ---- BUILD EXTRUDED 3D GEOMETRY ---- */
  function buildLogoMesh() {
    const group = new THREE.Group();

    pathStrings.forEach((d, i) => {
      const shape = parseSVGPath(d);

      // Extruded solid faces
      const extGeo = new THREE.ExtrudeGeometry(shape, {
        depth: EXTRUDE_DEPTH,
        bevelEnabled: true,
        bevelThickness: 0.08,
        bevelSize: 0.06,
        bevelSegments: 4,
        curveSegments: 16,
      });
      // Centre geometry on Z
      extGeo.translate(0, 0, -EXTRUDE_DEPTH / 2);

      const faceMesh = new THREE.Mesh(extGeo, matFace.clone());
      group.add(faceMesh);

      // Wireframe edges — gold glow on the silhouette
      const edgesGeo = new THREE.EdgesGeometry(extGeo, 15); // 15° threshold
      const edgeMesh = new THREE.LineSegments(edgesGeo, new THREE.LineBasicMaterial({
        color: 0xc8a96e,
        transparent: true,
        opacity: 0.45,
      }));
      group.add(edgeMesh);
    });

    return group;
  }

  /* ---- PLACE MULTIPLE LOGO INSTANCES ---- */
  // The logo structure repeats along Z — camera flies through them
  const INSTANCE_COUNT = 6;
  const INSTANCE_SPACING = 28; // world units between each instance

  const logoInstances = [];
  const logoGroup = buildLogoMesh(); // build once, then clone

  for (let i = 0; i < INSTANCE_COUNT; i++) {
    const inst = logoGroup.clone(true);
    inst.position.z = -i * INSTANCE_SPACING;
    scene.add(inst);
    logoInstances.push(inst);
  }

  const TOTAL_SPAN = INSTANCE_COUNT * INSTANCE_SPACING;

  /* ---- PARTICLES ---- */
  const PC = 1200;
  const pArr = new Float32Array(PC * 3);
  for (let i = 0; i < PC; i++) {
    pArr[i*3]   = (Math.random()-0.5) * 40;
    pArr[i*3+1] = (Math.random()-0.5) * 30;
    pArr[i*3+2] = -(Math.random() * TOTAL_SPAN);
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pArr, 3));
  scene.add(new THREE.Points(pGeo, new THREE.PointsMaterial({
    color: 0xc8a96e, size: 0.04, transparent: true, opacity: 0.35, sizeAttenuation: true,
  })));

  /* ---- AUTONOMOUS CAMERA PATH ----
     A slow, looping spline that drifts the camera above, through,
     below and around the structure — no mouse input.
  */
  const camKeyframes = [
    // [x, y, z-offset-from-logo-centre, lookAt-x, lookAt-y, lookAt-z-offset]
    // The camera orbits the structure naturally
    { pos: new THREE.Vector3(0,   6,  12), look: new THREE.Vector3( 0.5, -0.5, -8) },
    { pos: new THREE.Vector3(-8,  2,   6), look: new THREE.Vector3( 1,    0,   -12) },
    { pos: new THREE.Vector3(-4, -5,   0), look: new THREE.Vector3( 2,    2,   -10) },
    { pos: new THREE.Vector3( 4, -7,  -6), look: new THREE.Vector3(-1,    3,   -14) },
    { pos: new THREE.Vector3( 9,  0,  -12), look: new THREE.Vector3(-2,  -1,   -20) },
    { pos: new THREE.Vector3( 3,  8,  -18), look: new THREE.Vector3( 0,   0,   -26) },
    { pos: new THREE.Vector3(-5,  4,  -24), look: new THREE.Vector3( 1,  -2,   -30) },
    { pos: new THREE.Vector3( 0,  6,   12), look: new THREE.Vector3( 0.5,-0.5,  -8) }, // loop
  ];

  // Build CatmullRom splines for position and lookAt
  const posSpline  = new THREE.CatmullRomCurve3(camKeyframes.map(k => k.pos),  true);
  const lookSpline = new THREE.CatmullRomCurve3(camKeyframes.map(k => k.look), true);

  // Camera offset drifts with the logo instances — anchor to instance[0] z
  let anchorZ = 0; // we'll update this each frame

  /* ---- ANIMATE ---- */
  let t = 0;
  const SPEED = 0.00014; // spline t advance per frame — very slow

  function tick() {
    requestAnimationFrame(tick);
    t = (t + SPEED) % 1;

    // Sample spline
    const localPos  = posSpline.getPoint(t);
    const localLook = lookSpline.getPoint(t);

    // Anchor camera to a drifting Z offset so it travels through instances
    anchorZ -= 0.007; // slow forward drift through the world

    camera.position.set(
      localPos.x,
      localPos.y,
      localPos.z + anchorZ
    );

    const lookTarget = new THREE.Vector3(
      localLook.x,
      localLook.y,
      localLook.z + anchorZ
    );
    camera.lookAt(lookTarget);

    // Recycle logo instances that have passed behind camera
    logoInstances.forEach(inst => {
      if (inst.position.z > camera.position.z + INSTANCE_SPACING) {
        inst.position.z -= TOTAL_SPAN;
      }
    });

    // Recycle particles
    const pa = pGeo.attributes.position.array;
    for (let i = 0; i < PC; i++) {
      if (pa[i*3+2] > camera.position.z + 5) pa[i*3+2] -= TOTAL_SPAN;
    }
    pGeo.attributes.position.needsUpdate = true;

    // Subtle rim light animation
    rimLight1.position.x = Math.sin(t * Math.PI * 6) * 30;
    rimLight1.position.y = Math.cos(t * Math.PI * 4) * 15;

    renderer.render(scene, camera);
  }

  tick();
})();
