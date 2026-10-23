import { useLayoutEffect, useRef, type ComponentRef } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { PerspectiveCamera } from 'three';
import { cameraFit, OFFICE_H } from './camera';

/**
 * OrbitControls con inquadratura automatica: la camera si riadatta all'ufficio al resize e quando il layout cresce,
 * ma solo finché l'utente non la muove (rotazione, zoom o pan): da lì in poi resta dov'è lui l'ha lasciata.
 */
export function FitCamera({ width, depth }: { width: number; depth: number }) {
  const camera = useThree((s) => s.camera);
  const aspect = useThree((s) => s.size.width / s.size.height);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const moved = useRef(false);
  const fit = cameraFit(width, depth, OFFICE_H, camera instanceof PerspectiveCamera ? camera.fov : 38, aspect);

  useLayoutEffect(() => {
    if (moved.current) return;
    camera.position.set(...fit.position);
    controls.current?.target.set(0, 0, 0);
    camera.lookAt(0, 0, 0);
    controls.current?.update();
    invalidate();
  }, [camera, fit.position[0], fit.position[1], fit.position[2], invalidate]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      maxPolarAngle={Math.PI / 2.3}
      minDistance={5}
      // sui viewport stretti l'inquadratura iniziale può superare il vecchio limite di 2 volte il lato
      maxDistance={Math.max(Math.max(width, depth) * 2, fit.distance * 1.5)}
      onStart={() => (moved.current = true)}
    />
  );
}
