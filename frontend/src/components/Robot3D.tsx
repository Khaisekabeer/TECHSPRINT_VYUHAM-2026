import React, { useEffect, useRef } from 'react';
import { useGLTF, useAnimations } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';

export function Robot3D({ gameState, questionResult }: { gameState: any, questionResult: any }) {
  const group = useRef<any>(null);
  const { nodes, materials, animations } = useGLTF(`${import.meta.env.BASE_URL}RobotExpressive.glb`) as any;
  const { actions, names } = useAnimations(animations, group);

  useEffect(() => {
    if (!actions) return;
    
    // Default animation
    let animName = 'Idle';

    if (gameState?.state === 'lobby') {
      animName = 'Wave';
    } else if (gameState?.state === 'intro') {
      animName = 'Walking';
    } else if (gameState?.state === 'question') {
      animName = 'Running';
    } else if (gameState?.state === 'leaderboard') {
      if (questionResult?.speedStar) {
        animName = 'Dance';
      } else {
        animName = 'Yes';
      }
    }

    // Stop all current animations
    Object.values(actions).forEach((action) => (action as any).stop());
    
    // Play target animation
    const targetAction = actions[animName];
    if (targetAction) {
      targetAction.reset().fadeIn(0.5).play();
    }

  }, [gameState?.state, questionResult, actions]);

  // Slowly rotate the robot
  useFrame((state) => {
    if (group.current) {
      (group.current as any).rotation.y = Math.sin(state.clock.elapsedTime * 0.5) * 0.2;
    }
  });

  return (
    <group ref={group as any} dispose={null} scale={1.5} position={[0, -1.5, 0]}>
      <primitive object={nodes.Scene || nodes.scene} />
    </group>
  );
}

useGLTF.preload(`${import.meta.env.BASE_URL}RobotExpressive.glb`);
