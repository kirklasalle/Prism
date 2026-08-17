/**
 * Types for WifiVision RF CSI Spatial Sensory Addon
 */

export interface CSICoordinates {
    x: number; // Lateral position in meters
    y: number; // Vertical height in meters
    z: number; // Longitudinal depth in meters
}

export interface CSIVitals {
    respiration_bpm: number;
    respiration_waveform: number; // -1.0 to 1.0
    motion_intensity: number; // 0.0 to 1.0
}

export interface CSIPresenceFrame {
    source: string;
    timestamp: number;
    presence_detected: boolean;
    confidence: number;
    coordinates: CSICoordinates;
    vitals: CSIVitals;
    spatial_zone: string;
    security_status: string;
}

export type CSIFrameCallback = (frame: CSIPresenceFrame) => void;
