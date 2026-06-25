/* ================================================
   MELANKOLIA AGENCY — SITE BACKGROUND
   True 3D: camera flies forward through
   enormous logo-mark planes in deep space.
   Fixed canvas behind all content.
   ================================================ */
(function () {
  const canvas = document.getElementById('heroCanvas');
  if (!canvas || typeof THREE === 'undefined') return;

  /* ---- RENDERER ---- */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x000000, 1);

  /* ---- SCENE / CAMERA ---- */
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, 0.055);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 120);

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  /* ---- BUILD LOGO TEXTURE FROM SVG ---- */
  function makeTex(cb) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // Render white SVG onto a black canvas so it's visible as additive texture
      const oc = document.createElement('canvas');
      // SVG viewBox 792×612
      oc.width = 1024; oc.height = Math.round(1024 * 612 / 792);
      const ctx = oc.getContext('2d');
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, oc.width, oc.height);
      ctx.drawImage(img, 0, 0, oc.width, oc.height);
      const t = new THREE.CanvasTexture(oc);
      cb(t);
    };
    img.onerror = () => cb(new THREE.CanvasTexture(document.createElement('canvas')));
    img.src = '/images/logo-mark-white.svg';
  }

  makeTex((tex) => {

    /* ---- LOGO PLANE TUNNEL ----
       We place N logo planes along the Z axis, camera flies through them.
       Planes recycle: when one passes behind camera it jumps to far end.
    */
    const SVG_ASPECT = 792 / 612;          // logo width:height
    const PLANE_SCALE  = 14;               // world units tall
    const PLANE_W      = PLANE_SCALE * SVG_ASPECT;
    const PLANE_H      = PLANE_SCALE;
    const N_PLANES     = 12;
    const SPACING      = 8;                // z gap between planes
    const TOTAL_DEPTH  = N_PLANES * SPACING;

    const planeMat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.13,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    const planeGeo = new THREE.PlaneGeometry(PLANE_W, PLANE_H);
    const meshes = [];

    for (let i = 0; i < N_PLANES; i++) {
      const m = new THREE.Mesh(planeGeo, planeMat.clone());
      m.position.z = -i * SPACING;
      // Slight random tilt per plane — like drifting debris
      m.rotation.z = (Math.random() - 0.5) * 0.06;
      m.position.x = (Math.random() - 0.5) * 0.4;
      m.position.y = (Math.random() - 0.5) * 0.2;
      scene.add(m);
      meshes.push(m);
    }

    /* ---- GOLD PARTICLE FIELD ---- */
    const PC = 800;
    const pArr = new Float32Array(PC * 3);
    for (let i = 0; i < PC; i++) {
      pArr[i*3]   = (Math.random()-0.5)*30;
      pArr[i*3+1] = (Math.random()-0.5)*22;
      pArr[i*3+2] = -(Math.random()*TOTAL_DEPTH);
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pArr,3));
    scene.add(new THREE.Points(pGeo, new THREE.PointsMaterial({
      color:0xc8a96e, size:0.025, transparent:true, opacity:0.5, sizeAttenuation:true
    })));

    /* ---- MOUSE PARALLAX ---- */
    let mx=0, my=0, tmx=0, tmy=0;
    window.addEventListener('mousemove', e => {
      tmx = (e.clientX/window.innerWidth  - 0.5) *  0.5;
      tmy = (e.clientY/window.innerHeight - 0.5) * -0.3;
    }, {passive:true});

    /* ---- ANIMATION ---- */
    let t = 0;
    // Camera starts behind the planes and moves forward (decreasing Z)
    const CAM_START_Z = 6;
    const FLY_SPEED   = 0.006;   // units/frame — slow, hypnotic

    camera.position.set(0, 0, CAM_START_Z);

    function tick() {
      requestAnimationFrame(tick);
      t += 0.005;

      // Smooth mouse
      mx += (tmx - mx) * 0.04;
      my += (tmy - my) * 0.04;

      // Forward flight
      camera.position.z -= FLY_SPEED;

      // Camera gently oscillates off-centre — feels like floating
      camera.position.x = mx * 1.8 + Math.sin(t * 0.17) * 0.15;
      camera.position.y = my * 1.2 + Math.cos(t * 0.13) * 0.08;

      // Look slightly ahead of centre — gives the "flying into" sense
      camera.lookAt(
        camera.position.x * 0.1,
        camera.position.y * 0.1,
        camera.position.z - 20
      );

      // Recycle planes: when a plane is 2 units behind camera, push to far end
      meshes.forEach(m => {
        if (m.position.z > camera.position.z + 2) {
          m.position.z -= TOTAL_DEPTH;
          // Refresh slight tilt & drift
          m.rotation.z = (Math.random()-0.5)*0.06;
          m.position.x = (Math.random()-0.5)*0.4;
          m.position.y = (Math.random()-0.5)*0.2;
        }
        // Opacity: far planes are faint, near planes pulse brighter
        const dist = Math.abs(m.position.z - camera.position.z);
        m.material.opacity = Math.max(0.04, 0.18 - dist * 0.012)
          * (0.8 + 0.2 * Math.sin(t * 0.4 + m.position.z * 0.1));
      });

      // Recycle particles
      const pa = pGeo.attributes.position.array;
      for (let i=0; i<PC; i++) {
        if (pa[i*3+2] > camera.position.z + 3) pa[i*3+2] -= TOTAL_DEPTH;
      }
      pGeo.attributes.position.needsUpdate = true;

      renderer.render(scene, camera);
    }
    tick();
  });
})();
