"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

// Dramatic flowing liquid/aurora blob
function FlowingBlob() {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      uColorA: { value: new THREE.Color("#10b981") },
      uColorB: { value: new THREE.Color("#06b6d4") },
      uColorC: { value: new THREE.Color("#8b5cf6") },
      uColorD: { value: new THREE.Color("#ec4899") },
    }),
    []
  );

  const vertexShader = `
    uniform float uTime;
    varying vec3 vPosition;
    varying vec3 vNormal;
    varying float vDisplacement;
    varying vec2 vUv;
    
    //
    // GLSL textureless classic 3D noise "cnoise",
    // with an RSL-style periodic variant "pnoise".
    //
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
    vec3 fade(vec3 t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }

    float cnoise(vec3 P) {
      vec3 Pi0 = floor(P);
      vec3 Pi1 = Pi0 + vec3(1.0);
      Pi0 = mod289(Pi0);
      Pi1 = mod289(Pi1);
      vec3 Pf0 = fract(P);
      vec3 Pf1 = Pf0 - vec3(1.0);
      vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
      vec4 iy = vec4(Pi0.yy, Pi1.yy);
      vec4 iz0 = Pi0.zzzz;
      vec4 iz1 = Pi1.zzzz;

      vec4 ixy = permute(permute(ix) + iy);
      vec4 ixy0 = permute(ixy + iz0);
      vec4 ixy1 = permute(ixy + iz1);

      vec4 gx0 = ixy0 * (1.0 / 7.0);
      vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;
      gx0 = fract(gx0);
      vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
      vec4 sz0 = step(gz0, vec4(0.0));
      gx0 -= sz0 * (step(0.0, gx0) - 0.5);
      gy0 -= sz0 * (step(0.0, gy0) - 0.5);

      vec4 gx1 = ixy1 * (1.0 / 7.0);
      vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;
      gx1 = fract(gx1);
      vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
      vec4 sz1 = step(gz1, vec4(0.0));
      gx1 -= sz1 * (step(0.0, gx1) - 0.5);
      gy1 -= sz1 * (step(0.0, gy1) - 0.5);

      vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);
      vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
      vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);
      vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
      vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);
      vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
      vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);
      vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);

      vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
      g000 *= norm0.x;
      g010 *= norm0.y;
      g100 *= norm0.z;
      g110 *= norm0.w;
      vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
      g001 *= norm1.x;
      g011 *= norm1.y;
      g101 *= norm1.z;
      g111 *= norm1.w;

      float n000 = dot(g000, Pf0);
      float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
      float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
      float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
      float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
      float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
      float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
      float n111 = dot(g111, Pf1);

      vec3 fade_xyz = fade(Pf0);
      vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
      vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
      float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
      return 2.2 * n_xyz;
    }
    
    void main() {
      vUv = uv;
      vPosition = position;
      vNormal = normal;
      
      // Multi-octave noise for dramatic organic deformation
      float slowTime = uTime * 0.15;
      float noise1 = cnoise(position * 0.8 + slowTime) * 0.8;
      float noise2 = cnoise(position * 1.6 + slowTime * 1.3) * 0.4;
      float noise3 = cnoise(position * 3.2 + slowTime * 1.7) * 0.2;
      float noise4 = cnoise(position * 6.4 + slowTime * 2.1) * 0.1;
      
      // Swirling motion
      float swirl = sin(position.y * 2.0 + uTime * 0.3) * 0.3;
      
      float displacement = noise1 + noise2 + noise3 + noise4 + swirl;
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
    uniform vec3 uColorD;
    
    varying vec3 vPosition;
    varying vec3 vNormal;
    varying float vDisplacement;
    varying vec2 vUv;
    
    void main() {
      // Dramatic fresnel for glowing edges
      vec3 viewDirection = normalize(cameraPosition - vPosition);
      float fresnel = pow(1.0 - abs(dot(viewDirection, vNormal)), 2.5);
      
      // Flowing color gradient based on position and time
      float colorMix1 = sin(vPosition.y * 1.5 + uTime * 0.2) * 0.5 + 0.5;
      float colorMix2 = cos(vPosition.x * 1.2 + uTime * 0.15) * 0.5 + 0.5;
      float colorMix3 = sin(vDisplacement * 3.0 + uTime * 0.3) * 0.5 + 0.5;
      
      // Blend between 4 colors for iridescent effect
      vec3 color1 = mix(uColorA, uColorB, colorMix1);
      vec3 color2 = mix(uColorC, uColorD, colorMix2);
      vec3 baseColor = mix(color1, color2, colorMix3 * 0.7);
      
      // Add bright edge glow
      vec3 glowColor = mix(uColorB, uColorA, fresnel);
      baseColor = mix(baseColor, glowColor, fresnel * 0.8);
      
      // Specular highlights
      float specular = pow(fresnel, 4.0) * 1.5;
      baseColor += vec3(specular * 0.3);
      
      // Chromatic aberration effect at edges
      float chromatic = fresnel * 0.2;
      baseColor.r += chromatic;
      baseColor.b += chromatic * 0.5;
      
      gl_FragColor = vec4(baseColor, 0.95);
    }
  `;

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    }
    if (meshRef.current) {
      meshRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.1) * 0.2;
      meshRef.current.rotation.y = state.clock.elapsedTime * 0.08;
      meshRef.current.rotation.z = Math.cos(state.clock.elapsedTime * 0.05) * 0.1;
    }
  });

  return (
    <mesh ref={meshRef} scale={2.8} position={[-2, 0.5, 0]}>
      <icosahedronGeometry args={[1, 128]} />
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

// Orbiting light trails
function LightTrails() {
  const trailsRef = useRef<THREE.Group>(null);
  const trails = useMemo(() => {
    return Array.from({ length: 6 }, (_, i) => ({
      radius: 3.5 + i * 0.4,
      speed: 0.3 + i * 0.08,
      offset: (i / 6) * Math.PI * 2,
      color: i % 2 === 0 ? "#10b981" : "#06b6d4",
    }));
  }, []);

  useFrame((state) => {
    if (trailsRef.current) {
      trailsRef.current.rotation.z = state.clock.elapsedTime * 0.1;
    }
  });

  return (
    <group ref={trailsRef} position={[-2, 0.5, 0]}>
      {trails.map((trail, i) => (
        <TrailOrbit key={i} {...trail} />
      ))}
    </group>
  );
}

function TrailOrbit({ radius, speed, offset, color }: { radius: number; speed: number; offset: number; color: string }) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  useFrame((state) => {
    if (meshRef.current) {
      const angle = state.clock.elapsedTime * speed + offset;
      meshRef.current.position.x = Math.cos(angle) * radius;
      meshRef.current.position.y = Math.sin(angle) * radius * 0.6;
      meshRef.current.position.z = Math.sin(angle * 0.5) * 1.5;
    }
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.04, 16, 16]} />
      <meshBasicMaterial color={color} transparent opacity={0.9} />
    </mesh>
  );
}

// Ambient floating particles
function AmbientParticles() {
  const pointsRef = useRef<THREE.Points>(null);
  
  const positions = useMemo(() => {
    const count = 800;
    const positions = new Float32Array(count * 3);
    
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 15;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 10;
    }
    
    return positions;
  }, []);

  useFrame((state) => {
    if (pointsRef.current) {
      pointsRef.current.rotation.y = state.clock.elapsedTime * 0.02;
      pointsRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.01) * 0.1;
    }
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
        size={0.02}
        color="#34d399"
        transparent
        opacity={0.4}
        sizeAttenuation
      />
    </points>
  );
}

// Camera animation
function CameraRig() {
  const { camera } = useThree();
  
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    camera.position.x = Math.sin(t * 0.05) * 0.5;
    camera.position.y = Math.cos(t * 0.03) * 0.3;
    camera.lookAt(new THREE.Vector3(-1, 0, 0));
  });
  
  return null;
}

function Scene() {
  return (
    <>
      <color attach="background" args={["#030712"]} />
      <fog attach="fog" args={["#030712", 8, 20]} />
      
      <ambientLight intensity={0.3} />
      <pointLight position={[5, 5, 5]} intensity={0.5} color="#10b981" />
      <pointLight position={[-5, -3, -5]} intensity={0.3} color="#06b6d4" />
      <pointLight position={[0, 5, -5]} intensity={0.2} color="#8b5cf6" />
      
      <FlowingBlob />
      <LightTrails />
      <AmbientParticles />
      <CameraRig />
    </>
  );
}

export function AnimatedHeroBg() {
  return (
    <div className="absolute inset-0 h-full w-full">
      <Canvas
        camera={{ position: [0, 0, 8], fov: 50 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <Scene />
      </Canvas>
      
      {/* Dramatic gradient overlays */}
      <div className="absolute inset-0 bg-gradient-to-r from-gray-950/90 via-gray-950/50 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-transparent to-gray-950/60" />
      <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-gray-950 to-transparent" />
    </div>
  );
}
