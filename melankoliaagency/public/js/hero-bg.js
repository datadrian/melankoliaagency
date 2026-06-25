/* ================================================
   MELANKOLIA AGENCY — HERO BACKGROUND
   Slow parallax drift through the logo mark
   Three.js + SVG texture approach
   ================================================ */

(function () {
  const canvas = document.getElementById('heroCanvas');
  if (!canvas) return;

  // ---- RENDERER ----
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x000000, 1);

  // ---- SCENE / CAMERA ----
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100);
  camera.position.set(0, 0, 1.8);

  // ---- LOAD SVG AS TEXTURE via offscreen canvas ----
  function buildSVGTexture(callback) {
    const svgUrl = '/images/logo-mark-white.svg';
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // Render SVG into an offscreen canvas so we control size/colour
      const oc = document.createElement('canvas');
      // Use a wide canvas matching the SVG aspect (792:612 ≈ 1.294)
      oc.width  = 1024;
      oc.height = Math.round(1024 / (792 / 612));  // ~792
      const ctx = oc.getContext('2d');
      ctx.clearRect(0, 0, oc.width, oc.height);
      ctx.drawImage(img, 0, 0, oc.width, oc.height);
      const tex = new THREE.CanvasTexture(oc);
      tex.needsUpdate = true;
      callback(tex);
    };
    img.onerror = () => {
      // Fallback: plain texture if SVG fails
      const oc = document.createElement('canvas');
      oc.width = oc.height = 4;
      callback(new THREE.CanvasTexture(oc));
    };
    img.src = svgUrl;
  }

  buildSVGTexture((logoTex) => {

    // ---- LOGO PLANES — stack several at different Z depths ----
    // The viewer drifts slowly forward; each plane has its own depth/scale/opacity
    // giving a genuine parallax "flying through" feel

    const planes = [];
    const LAYERS = [
      // { z, scale, opacity, rotZ }
      { z: -3.0, scale: 5.5,  opacity: 0.04, rotZ:  0.00 },
      { z: -1.6, scale: 3.8,  opacity: 0.07, rotZ:  0.003 },
      { z: -0.4, scale: 2.4,  opacity: 0.10, rotZ: -0.004 },
      { z:  0.6, scale: 1.5,  opacity: 0.13, rotZ:  0.002 },
      { z:  1.4, scale: 0.9,  opacity: 0.09, rotZ: -0.002 },
    ];

    // SVG aspect: 792 / 612
    const svgAspect = 792 / 612;

    LAYERS.forEach(({ z, scale, opacity, rotZ }) => {
      const geo = new THREE.PlaneGeometry(scale * svgAspect, scale);
      const mat = new THREE.MeshBasicMaterial({
        map: logoTex,
        transparent: true,
        opacity: opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, 0, z);
      mesh.rotation.z = rotZ;
      scene.add(mesh);
      planes.push({ mesh, baseZ: z, baseOpacity: opacity, baseScale: scale, rotZ });
    });

    // ---- SUBTLE PARTICLE FIELD — fine dust behind logo ----
    const COUNT = 600;
    const pos = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 12;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 9;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 8 - 2;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pMat = new THREE.PointsMaterial({
      color: 0xc8a96e,
      size: 0.012,
      transparent: true,
      opacity: 0.35,
      sizeAttenuation: true,
    });
    scene.add(new THREE.Points(pGeo, pMat));

    // ---- MOUSE PARALLAX STATE ----
    let targetX = 0, targetY = 0;
    let currentX = 0, currentY = 0;
    document.addEventListener('mousemove', (e) => {
      targetX = (e.clientX / window.innerWidth  - 0.5) * 0.18;
      targetY = (e.clientY / window.innerHeight - 0.5) * 0.10;
    }, { passive: true });

    // Touch support
    document.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      targetX = (t.clientX / window.innerWidth  - 0.5) * 0.1;
      targetY = (t.clientY / window.innerHeight - 0.5) * 0.06;
    }, { passive: true });

    // ---- SCROLL parallax ----
    let scrollY = 0;
    window.addEventListener('scroll', () => {
      scrollY = window.scrollY;
    }, { passive: true });

    // ---- RESIZE ----
    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // ---- ANIMATE ----
    let time = 0;
    let camZ = 1.8;
    const DRIFT_SPEED = 0.00018; // extremely slow forward drift

    function animate() {
      requestAnimationFrame(animate);
      time += 0.005;

      // Smooth mouse follow
      currentX += (targetX - currentX) * 0.035;
      currentY += (targetY - currentY) * 0.035;

      // Very slow forward drift (POV creeping into the logo)
      camZ -= DRIFT_SPEED;
      // Oscillate gently so it never "arrives" — pendulum feel
      const driftZ = 1.8 + Math.sin(time * 0.12) * 0.25;

      camera.position.set(
        currentX,
        -currentY,
        driftZ
      );
      // Slight camera tilt toward mouse
      camera.rotation.y = currentX * -0.12;
      camera.rotation.x = currentY * 0.08;
      // Very slow roll
      camera.rotation.z = Math.sin(time * 0.07) * 0.004;

      // Planes breathe — opacity pulse, very slow
      planes.forEach(({ mesh, baseOpacity }, i) => {
        mesh.material.opacity = baseOpacity * (0.75 + 0.25 * Math.sin(time * 0.3 + i * 1.1));
        // Each layer drifts laterally at a slightly different rate (parallax)
        mesh.position.x = currentX * (i * 0.3 + 0.2) * -0.8;
        mesh.position.y = currentY * (i * 0.2 + 0.1) *  0.8;
      });

      renderer.render(scene, camera);
    }

    animate();
  });

})();
