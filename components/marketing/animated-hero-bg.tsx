"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

function MorphingSphere() {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color("#10b981") }, // emerald-500
      uColorB: { value: new THREE.Color("#34d399") }, // emerald-400
      uColorC: { value: new THREE.Color("#064e3b") }, // emerald-950
    }),
    []
  );

  const vertexShader = `
    uniform float uTime;
    varying vec3 vPosition;
    varying vec3 vNormal;
    varying float vDisplacement;
    
    // Simplex noise functions
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
    
    float snoise(vec3 v) {
      const vec2 C = vec2(1.0/6.0, 1.0/3.0);
      const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
      
      vec3 i  = floor(v + dot(v, C.yyy));
      vec3 x0 = v - i + dot(i, C.xxx);
      
      vec3 g = step(x0.yzx, x0.xyz);
      vec3 l = 1.0 - g;
      vec3 i1 = min(g.xyz, l.zxy);
      vec3 i2 = max(g.xyz, l.zxy);
      
      vec3 x1 = x0 - i1 + C.xxx;
      vec3 x2 = x0 - i2 + C.yyy;
      vec3 x3 = x0 - D.yyy;
      
      i = mod289(i);
      vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
        + i.y + vec4(0.0, i1.y, i2.y, 1.0))
        + i.x + vec4(0.0, i1.x, i2.x, 1.0));
      
      float n_ = 0.142857142857;
      vec3 ns = n_ * D.wyz - D.xzx;
      
      vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
      
      vec4 x_ = floor(j * ns.z);
      vec4 y_ = floor(j - 7.0 * x_);
      
      vec4 x = x_ *ns.x + ns.yyyy;
      vec4 y = y_ *ns.x + ns.yyyy;
      vec4 h = 1.0 - abs(x) - abs(y);
      
      vec4 b0 = vec4(x.xy, y.xy);
      vec4 b1 = vec4(x.zw, y.zw);
      
      vec4 s0 = floor(b0)*2.0 + 1.0;
      vec4 s1 = floor(b1)*2.0 + 1.0;
      vec4 sh = -step(h, vec4(0.0));
      
      vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
      vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
      
      vec3 p0 = vec3(a0.xy, h.x);
      vec3 p1 = vec3(a0.zw, h.y);
      vec3 p2 = vec3(a1.xy, h.z);
      vec3 p3 = vec3(a1.zw, h.w);
      
      vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
      p0 *= norm.x;
      p1 *= norm.y;
      p2 *= norm.z;
      p3 *= norm.w;
      
      vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
      m = m * m;
      return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
    }
    
    void main() {
      vPosition = position;
      vNormal = normal;
      
      // Multi-layered noise for organic deformation
      float noise1 = snoise(position * 1.5 + uTime * 0.3) * 0.4;
      float noise2 = snoise(position * 3.0 + uTime * 0.5) * 0.2;
      float noise3 = snoise(position * 6.0 + uTime * 0.7) * 0.1;
      
      float displacement = noise1 + noise2 + noise3;
      vDisplacement = displacement;
      
      vec3 newPosition = position + normal * displacement;
      
      gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
    }
  `;

  const fragmentShader = `
    uniform float uTime;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    uniform vec3 uColorC;
    
    varying vec3 vPosition;
    varying vec3 vNormal;
    varying float vDisplacement;
    
    void main() {
      // Fresnel effect for edge glow
      vec3 viewDirection = normalize(cameraPosition - vPosition);
      float fresnel = pow(1.0 - abs(dot(viewDirection, vNormal)), 3.0);
      
      // Color based on displacement and fresnel
      vec3 color = mix(uColorC, uColorA, vDisplacement + 0.5);
      color = mix(color, uColorB, fresnel * 0.8);
      
      // Pulsing glow
      float pulse = sin(uTime * 2.0) * 0.1 + 0.9;
      
      // Add bright edges
      float edgeGlow = fresnel * 1.5 * pulse;
      color += uColorB * edgeGlow;
      
      gl_FragColor = vec4(color, 0.9);
    }
  `;

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    }
    if (meshRef.current) {
      meshRef.current.rotation.x = state.clock.elapsedTime * 0.1;
      meshRef.current.rotation.y = state.clock.elapsedTime * 0.15;
    }
  });

  return (
    <mesh ref={meshRef} scale={2.2} position={[0, 0, 0]}>
      <icosahedronGeometry args={[1, 64]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function FloatingRings() {
  const group1Ref = useRef<THREE.Group>(null);
  const group2Ref = useRef<THREE.Group>(null);
  const group3Ref = useRef<THREE.Group>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (group1Ref.current) {
      group1Ref.current.rotation.x = t * 0.2;
      group1Ref.current.rotation.z = t * 0.1;
    }
    if (group2Ref.current) {
      group2Ref.current.rotation.y = t * 0.15;
      group2Ref.current.rotation.x = t * 0.08;
    }
    if (group3Ref.current) {
      group3Ref.current.rotation.z = t * 0.12;
      group3Ref.current.rotation.y = t * 0.18;
    }
  });

  return (
    <>
      <group ref={group1Ref}>
        <mesh>
          <torusGeometry args={[3.2, 0.02, 16, 100]} />
          <meshBasicMaterial color="#34d399" transparent opacity={0.6} />
        </mesh>
      </group>
      <group ref={group2Ref}>
        <mesh>
          <torusGeometry args={[3.6, 0.015, 16, 100]} />
          <meshBasicMaterial color="#10b981" transparent opacity={0.4} />
        </mesh>
      </group>
      <group ref={group3Ref}>
        <mesh>
          <torusGeometry args={[4.0, 0.01, 16, 100]} />
          <meshBasicMaterial color="#6ee7b7" transparent opacity={0.3} />
        </mesh>
      </group>
    </>
  );
}

function ParticleField() {
  const pointsRef = useRef<THREE.Points>(null);
  
  const { positions, velocities } = useMemo(() => {
    const count = 500;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const radius = 4 + Math.random() * 3;
      
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);
      
      velocities[i * 3] = (Math.random() - 0.5) * 0.01;
      velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.01;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.01;
    }
    
    return { positions, velocities };
  }, []);

  useFrame((state) => {
    if (!pointsRef.current) return;
    const positions = pointsRef.current.geometry.attributes.position.array as Float32Array;
    const time = state.clock.elapsedTime;
    
    for (let i = 0; i < positions.length / 3; i++) {
      const i3 = i * 3;
      
      // Orbital motion
      const x = positions[i3];
      const y = positions[i3 + 1];
      const angle = 0.002;
      
      positions[i3] = x * Math.cos(angle) - y * Math.sin(angle);
      positions[i3 + 1] = x * Math.sin(angle) + y * Math.cos(angle);
      positions[i3 + 2] += Math.sin(time + i) * 0.002;
    }
    
    pointsRef.current.geometry.attributes.position.needsUpdate = true;
    pointsRef.current.rotation.y = time * 0.05;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={positions.length / 3}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.03}
        color="#34d399"
        transparent
        opacity={0.6}
        sizeAttenuation
      />
    </points>
  );
}

function EnergyBeams() {
  const beamsRef = useRef<THREE.Group>(null);
  
  useFrame((state) => {
    if (beamsRef.current) {
      beamsRef.current.rotation.y = state.clock.elapsedTime * 0.3;
    }
  });

  const beams = useMemo(() => {
    return Array.from({ length: 8 }, (_, i) => ({
      rotation: (i / 8) * Math.PI * 2,
      length: 2 + Math.random() * 1.5,
      speed: 0.5 + Math.random() * 0.5,
    }));
  }, []);

  return (
    <group ref={beamsRef}>
      {beams.map((beam, i) => (
        <mesh
          key={i}
          position={[
            Math.cos(beam.rotation) * 2.5,
            0,
            Math.sin(beam.rotation) * 2.5,
          ]}
          rotation={[0, -beam.rotation + Math.PI / 2, Math.PI / 2]}
        >
          <cylinderGeometry args={[0.008, 0.001, beam.length, 8]} />
          <meshBasicMaterial
            color="#10b981"
            transparent
            opacity={0.4}
          />
        </mesh>
      ))}
    </group>
  );
}

function Scene() {
  return (
    <>
      <color attach="background" args={["#030712"]} />
      <fog attach="fog" args={["#030712", 5, 15]} />
      
      <ambientLight intensity={0.2} />
      <pointLight position={[10, 10, 10]} intensity={0.5} color="#34d399" />
      <pointLight position={[-10, -10, -10]} intensity={0.3} color="#10b981" />
      
      <MorphingSphere />
      <FloatingRings />
      <ParticleField />
      <EnergyBeams />
    </>
  );
}

export function AnimatedHeroBg() {
  return (
    <div className="absolute inset-0 h-full w-full">
      <Canvas
        camera={{ position: [0, 0, 8], fov: 45 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <Scene />
      </Canvas>
      
      {/* Gradient overlay for text readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-gray-950/80" />
      <div className="absolute inset-0 bg-gradient-to-t from-transparent via-transparent to-gray-950/40" />
    </div>
  );
}
