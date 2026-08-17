import * as THREE from 'three';
import { type CSIPresenceFrame } from './types';
import { WifiVisionSensoryBridge } from './WifiVisionSensoryBridge';

/**
 * WifiVisionSpatialVisualizer
 * Renders Three.js 3D spatial representations of RF Channel State Information (CSI):
 * 1. Physical human presence beacon and RF ripple particle waves.
 * 2. Ambient room light pulsation matching human respiration BPM.
 * 3. Directional gaze vector target for NPC character avatars.
 */
export class WifiVisionSpatialVisualizer {
    private scene: THREE.Scene;
    private bridge: WifiVisionSensoryBridge;
    private presenceMarker: THREE.Mesh | null = null;
    private rippleMesh: THREE.Points | null = null;
    private ambientLight: THREE.AmbientLight | null = null;
    private unsubscribe: (() => void) | null = null;
    private baseLightIntensity: number = 0.6;

    constructor(scene: THREE.Scene, bridge: WifiVisionSensoryBridge, ambientLight?: THREE.AmbientLight) {
        this.scene = scene;
        this.bridge = bridge;
        this.ambientLight = ambientLight || null;
        this.initVisualElements();
    }

    private initVisualElements(): void {
        // 1. Presence Beacon Sphere
        const geo = new THREE.SphereGeometry(0.25, 16, 16);
        const mat = new THREE.MeshBasicMaterial({
            color: 0x06b6d4,
            wireframe: true,
            transparent: true,
            opacity: 0.8
        });
        this.presenceMarker = new THREE.Mesh(geo, mat);
        this.presenceMarker.position.set(0, -100, 0); // Hide until detected
        this.scene.add(this.presenceMarker);

        // 2. RF Ripple Particles
        const particleCount = 120;
        const particleGeo = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);

        for (let i = 0; i < particleCount; i++) {
            const angle = (i / particleCount) * Math.PI * 2;
            const radius = 0.8 + 0.4 * Math.random();
            positions[i * 3] = Math.cos(angle) * radius;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 0.2;
            positions[i * 3 + 2] = Math.sin(angle) * radius;
        }

        particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const particleMat = new THREE.PointsMaterial({
            color: 0x8b5cf6,
            size: 0.05,
            transparent: true,
            opacity: 0.75,
            blending: THREE.AdditiveBlending
        });

        this.rippleMesh = new THREE.Points(particleGeo, particleMat);
        this.rippleMesh.position.set(0, -100, 0);
        this.scene.add(this.rippleMesh);

        // Subscribe to sensory frames
        this.unsubscribe = this.bridge.subscribe(this.onFrameReceived.bind(this));
    }

    private onFrameReceived(frame: CSIPresenceFrame): void {
        if (!frame.presence_detected) {
            if (this.presenceMarker) this.presenceMarker.position.set(0, -100, 0);
            if (this.rippleMesh) this.rippleMesh.position.set(0, -100, 0);
            return;
        }

        const { x, y, z } = frame.coordinates;

        // Update presence marker position in Three.js space
        if (this.presenceMarker) {
            this.presenceMarker.position.set(x, y, z);
        }

        // Update RF wave ring position
        if (this.rippleMesh) {
            this.rippleMesh.position.set(x, 0.1, z);
            this.rippleMesh.rotation.y += 0.05;
        }

        // Modulate ambient light with human respiration waveform
        if (this.ambientLight) {
            const pulse = 1.0 + 0.15 * frame.vitals.respiration_waveform;
            this.ambientLight.intensity = this.baseLightIntensity * pulse;
        }
    }

    public update(): void {
        // Rotate ripple particles continuously
        if (this.rippleMesh && this.rippleMesh.position.y > -50) {
            this.rippleMesh.rotation.y += 0.02;
        }
    }

    public destroy(): void {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
        if (this.presenceMarker) {
            this.scene.remove(this.presenceMarker);
            this.presenceMarker.geometry.dispose();
            (this.presenceMarker.material as THREE.Material).dispose();
            this.presenceMarker = null;
        }
        if (this.rippleMesh) {
            this.scene.remove(this.rippleMesh);
            this.rippleMesh.geometry.dispose();
            (this.rippleMesh.material as THREE.Material).dispose();
            this.rippleMesh = null;
        }
    }
}
