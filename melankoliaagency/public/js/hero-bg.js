/* ================================================
   MELANKOLIA AGENCY — THREE.JS HERO BACKGROUND
   POV flight through infinite logo-mark tunnel
   ================================================ */

(function() {
  const canvas = document.getElementById('heroCanvas');
  if (!canvas) return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.z = 0;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 1);

  // ---- FOG ----
  scene.fog = new THREE.FogExp2(0x000000, 0.018);

  // ---- LOGO MARK GEOMETRY ----
  // Based on the Melankolia triangle mark — 3 nested/offset triangle rings
  // Each ring is a wireframe triangle shape extruded into depth

  const GOLD = new THREE.Color(0xc8a96e);
  const WHITE = new THREE.Color(0xffffff);
  const DIM_GOLD = new THREE.Color(0x5a4a2a);

  function createTriangleRing(size, thickness, segments) {
    const shape = new THREE.Shape();
    const inner = size - thickness;
    // Outer triangle (pointing up)
    const h = size * Math.sqrt(3) / 2;
    const hi = inner * Math.sqrt(3) / 2;
    shape.moveTo(0, size * 0.667);
    shape.lineTo( size * 0.5, -size * 0.333);
    shape.lineTo(-size * 0.5, -size * 0.333);
    shape.closePath();
    // Inner hole (pointing up, smaller)
    const hole = new THREE.Path();
    hole.moveTo(0, inner * 0.667);
    hole.lineTo( inner * 0.5, -inner * 0.333);
    hole.lineTo(-inner * 0.5, -inner * 0.333);
    hole.closePath();
    shape.holes.push(hole);
    return shape;
  }

  function createInvertedTriangleRing(size, thickness) {
    const shape = new THREE.Shape();
    const inner = size - thickness;
    shape.moveTo(0, -size * 0.667);
    shape.lineTo( size * 0.5,  size * 0.333);
    shape.lineTo(-size * 0.5,  size * 0.333);
    shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(0, -inner * 0.667);
    hole.lineTo( inner * 0.5,  inner * 0.333);
    hole.lineTo(-inner * 0.5,  inner * 0.333);
    hole.closePath();
    shape.holes.push(hole);
    return shape;
  }

  // Extrude settings
  const extrudeSettings = { depth: 0.5, bevelEnabled: false };

  // Build tunnel rings — spread along Z axis
  const RING_COUNT = 60;
  const RING_SPACING = 18;
  const TUNNEL_LENGTH = RING_COUNT * RING_SPACING;

  const rings = [];

  for (let i = 0; i < RING_COUNT; i++) {
    const z = -(i * RING_SPACING) - 40;
    const scale = 4 + Math.random() * 1.5;
    const thickness = 0.08 + Math.random() * 0.06;
    const isInverted = (i % 3 === 1);
    const rotOffset = (i % 2) * (Math.PI / 3); // alternating 60° offset

    // Choose shape variant: 0 = up triangle, 1 = inverted, 2 = double (star of david)
    const variant = i % 3;
    const shapes = [];

    if (variant !== 1) {
      shapes.push({ shape: createTriangleRing(scale, scale * thickness), rot: rotOffset });
    }
    if (variant !== 0) {
      shapes.push({ shape: createInvertedTriangleRing(scale, scale * thickness), rot: rotOffset });
    }

    shapes.forEach(({ shape, rot }) => {
      const geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      const alpha = 0.15 + (i / RING_COUNT) * 0.05;
      const mat = new THREE.MeshBasicMaterial({
        color: i % 4 === 0 ? GOLD : (i % 4 === 2 ? WHITE : DIM_GOLD),
        transparent: true,
        opacity: 0.12 + Math.random() * 0.18,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        z
      );
      mesh.rotation.z = rot + (Math.random() - 0.5) * 0.15;
      scene.add(mesh);
      rings.push({ mesh, baseZ: z, speed: 0.008 + Math.random() * 0.004 });
    });
  }

  // ---- FLOATING PARTICLES ----
  const particleCount = 400;
  const pPositions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    pPositions[i * 3]     = (Math.random() - 0.5) * 30;
    pPositions[i * 3 + 1] = (Math.random() - 0.5) * 30;
    pPositions[i * 3 + 2] = -(Math.random() * TUNNEL_LENGTH);
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
  const pMat = new THREE.PointsMaterial({
    color: 0xc8a96e,
    size: 0.06,
    transparent: true,
    opacity: 0.5,
    sizeAttenuation: true,
  });
  const particles = new THREE.Points(pGeo, pMat);
  scene.add(particles);

  // ---- CAMERA DRIFT ----
  let time = 0;
  const SPEED = 0.045; // forward speed
  let camZ = 0;

  // Mouse parallax
  let mouseX = 0, mouseY = 0;
  document.addEventListener('mousemove', (e) => {
    mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  // Resize
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---- ANIMATE ----
  function animate() {
    requestAnimationFrame(animate);
    time += 0.008;
    camZ -= SPEED;

    // Subtle camera drift — like floating in zero-g
    camera.position.x += (mouseX * 1.2 - camera.position.x) * 0.02;
    camera.position.y += (-mouseY * 0.8 - camera.position.y) * 0.02;
    camera.position.z = camZ;

    // Very gentle camera sway
    camera.rotation.z = Math.sin(time * 0.3) * 0.008;

    // Recycle rings that pass the camera
    rings.forEach(r => {
      if (r.mesh.position.z > camZ + 20) {
        r.mesh.position.z -= TUNNEL_LENGTH;
      }
    });

    // Recycle particles
    const pos = particles.geometry.attributes.position.array;
    for (let i = 0; i < particleCount; i++) {
      if (pos[i * 3 + 2] > camZ + 5) {
        pos[i * 3 + 2] -= TUNNEL_LENGTH;
      }
    }
    particles.geometry.attributes.position.needsUpdate = true;

    // Slow ring pulse
    rings.forEach((r, i) => {
      r.mesh.material.opacity = (0.08 + Math.abs(Math.sin(time * 0.4 + i * 0.3)) * 0.18);
    });

    renderer.render(scene, camera);
  }

  animate();
})();
