/**
 * @file desktop-sandbox-manager.test.ts
 * @description Unit and Integration tests for Governed Visual Desktop Sandbox (Phase V).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DesktopSandboxManager
} from '../src/core/operator/desktop-sandbox-manager.js';
import { DesktopControlTool } from '../src/adapters/system/desktop-control-tool.js';
import { ActivityBus } from '../src/core/activity/bus.js';
import type { ActivityEvent } from '../src/core/activity/types.js';

describe('Phase V: Governed Visual Desktop Sandbox Manager', () => {
  let manager: DesktopSandboxManager;
  let activityBus: ActivityBus;
  let emittedEvents: ActivityEvent[];

  beforeEach(() => {
    activityBus = new ActivityBus();
    emittedEvents = [];
    activityBus.subscribe({
      onEvent: (ev: ActivityEvent) => {
        emittedEvents.push(ev);
      }
    });

    manager = new DesktopSandboxManager(
      {
        imageName: 'prism-sandbox-desktop:debian-slim',
        webRtcPort: 6080,
        vncPort: 5901,
        resolution: '1920x1080',
        mockProvider: true
      },
      activityBus
    );
  });

  afterEach(async () => {
    await manager.stopSandbox().catch(() => {});
  });

  it('initializes in STOPPED state with default autonomous control mode', () => {
    const status = manager.getStatus();
    assert.equal(status.state, 'STOPPED');
    assert.equal(status.activeMode, 'autonomous');
    assert.equal(status.containerId, null);
    assert.equal(status.resolution, '1920x1080');
    assert.equal(status.webRtcPort, 6080);
    assert.equal(status.vncPort, 5901);
    assert.equal(status.snapshots.length, 0);
  });

  it('starts sandbox and transitions to RUNNING state with valid stream URL', async () => {
    const status = await manager.startSandbox();
    assert.equal(status.state, 'RUNNING');
    assert.ok(status.containerId?.startsWith('mock-sandbox-'));
    assert.ok(status.streamUrl.includes('6080/vnc.html'));
    assert.ok(status.startedAt !== null);

    const startEvent = emittedEvents.find((e) => e.operation === 'sandbox.desktop.started');
    assert.ok(startEvent, 'Must emit sandbox.desktop.started event');
    assert.equal((startEvent?.details as any)?.reasonCode, 'DSK-SBX-STARTED');
  });

  it('handles operator takeover mode switch and preemption of autonomous state', async () => {
    await manager.startSandbox();

    // Engage takeover
    const takeoverStatus = await manager.setControlMode('operator_takeover');
    assert.equal(takeoverStatus.activeMode, 'operator_takeover');
    assert.equal(takeoverStatus.state, 'HELD_FOR_OPERATOR');

    const takeoverEvent = emittedEvents.find((e) => e.operation === 'sandbox.desktop.takeover_engaged');
    assert.ok(takeoverEvent, 'Must emit sandbox.desktop.takeover_engaged event');
    assert.equal((takeoverEvent?.details as any)?.reasonCode, 'DSK-SBX-TAKEOVER-ON');

    // Resume autonomy
    const autoStatus = await manager.setControlMode('autonomous');
    assert.equal(autoStatus.activeMode, 'autonomous');
    assert.equal(autoStatus.state, 'RUNNING');

    const resumeEvent = emittedEvents.find((e) => e.operation === 'sandbox.desktop.autonomous_resumed');
    assert.ok(resumeEvent, 'Must emit sandbox.desktop.autonomous_resumed event');
  });

  it('creates checkpoint snapshots and tracks parent lineage', async () => {
    await manager.startSandbox();

    const snap1 = await manager.createSnapshot('Checkpoint Baseline');
    assert.ok(snap1.id.startsWith('snap-'));
    assert.equal(snap1.name, 'Checkpoint Baseline');
    assert.equal(snap1.parentSnapshotId, undefined);

    const snap2 = await manager.createSnapshot('Checkpoint Post-Install');
    assert.equal(snap2.name, 'Checkpoint Post-Install');
    assert.equal(snap2.parentSnapshotId, snap1.id);

    const status = manager.getStatus();
    assert.equal(status.snapshots.length, 2);
    assert.equal(status.lastSnapshotId, snap2.id);

    const snapEvent = emittedEvents.find((e) => e.operation === 'sandbox.desktop.snapshot_created');
    assert.ok(snapEvent, 'Must emit snapshot_created event');
  });

  it('reverts sandbox container state to a previous snapshot checkpoint', async () => {
    await manager.startSandbox();
    const snap = await manager.createSnapshot('Restore Point Alpha');

    const revertedStatus = await manager.revertSnapshot(snap.id);
    assert.equal(revertedStatus.state, 'RUNNING');
    assert.ok(revertedStatus.containerId?.startsWith('reverted-'));

    const revertEvent = emittedEvents.find((e) => e.operation === 'sandbox.desktop.reverted');
    assert.ok(revertEvent, 'Must emit sandbox.desktop.reverted event');
    assert.equal((revertEvent?.details as any)?.reasonCode, 'DSK-SBX-REVERTED');
  });

  it('executes direct desktop input actions and records duration', async () => {
    await manager.startSandbox();

    const clickRes = await manager.executeInputAction({
      type: 'click',
      x: 350,
      y: 420,
      button: 1
    });

    assert.equal(clickRes.success, true);
    assert.equal(clickRes.actionType, 'click');
    assert.ok(clickRes.actionId.startsWith('act-'));
    assert.ok(clickRes.durationMs >= 0);

    const typeRes = await manager.executeInputAction({
      type: 'type',
      text: 'echo "PRISM Phase V Sandbox"'
    });
    assert.equal(typeRes.success, true);
    assert.equal(typeRes.actionType, 'type');
  });

  it('captures instant single-frame screenshot', async () => {
    await manager.startSandbox();
    const snap = await manager.captureScreenshot();
    assert.ok(snap.screenshotBase64.length > 0);
    assert.ok(snap.timestamp);
  });

  it('captures high-speed direct framebuffer frame burst with SHA-256 cryptographic digest', async () => {
    await manager.startSandbox();

    const burst = await manager.captureBurstFrames({ durationMs: 1000, fps: 10 });
    assert.ok(burst.captureId.startsWith('burst-'));
    assert.equal(burst.frameCount, 10);
    assert.equal(burst.fps, 10);
    assert.equal(burst.frames.length, 10);
    assert.equal(burst.digestSha256.length, 64, 'Digest must be a valid 64-char SHA-256 hex string');

    const burstEvent = emittedEvents.find((e) => e.operation === 'sandbox.desktop.burst_captured');
    assert.ok(burstEvent, 'Must emit burst_captured event');
    assert.equal((burstEvent?.details as any)?.reasonCode, 'DSK-SBX-BURST-RECORDED');
  });

  it('resets sandbox to clean state on resetSandbox call', async () => {
    await manager.startSandbox();
    const prevCid = manager.getStatus().containerId;

    const resetStatus = await manager.resetSandbox();
    assert.equal(resetStatus.state, 'RUNNING');
    assert.notEqual(resetStatus.containerId, prevCid);
  });
});

describe('Phase V: DesktopControlTool Adapter & Policy Governance', () => {
  let manager: DesktopSandboxManager;
  let tool: DesktopControlTool;

  beforeEach(() => {
    manager = new DesktopSandboxManager({ mockProvider: true });
    tool = new DesktopControlTool(manager);
  });

  afterEach(async () => {
    await manager.stopSandbox().catch(() => {});
  });

  it('declares tool name and governance action rules', () => {
    assert.equal(tool.name, 'desktop_control');
    assert.ok(tool.governance?.actions.desktop_status);
    assert.ok(tool.governance?.actions.desktop_click);
    assert.ok(tool.governance?.actions.desktop_capture_burst);
    assert.ok(tool.governance?.actions.desktop_snapshot);
    assert.ok(tool.governance?.actions.desktop_revert);
    assert.equal(tool.governance.actions.desktop_revert.rollbackRequired, true);
  });

  it('executes desktop_status through tool adapter', async () => {
    const res = await tool.execute({
      operation: 'desktop_status',
      args: {},
      risk: 'low',
      mutatesState: false
    });

    assert.equal(res.ok, true);
    assert.ok(res.output.status);
  });

  it('executes desktop_start and returns sideEffects metadata', async () => {
    const res = await tool.execute({
      operation: 'desktop_start',
      args: {},
      risk: 'medium',
      mutatesState: true
    });

    assert.equal(res.ok, true);
    assert.ok(res.sideEffects && res.sideEffects.length > 0);
    assert.equal(res.sideEffects[0].type, 'process');
  });

  it('executes desktop_click and desktop_type through tool adapter', async () => {
    await manager.startSandbox();

    const clickRes = await tool.execute({
      operation: 'desktop_click',
      args: { x: 120, y: 240, button: 1 },
      risk: 'medium',
      mutatesState: true
    });
    assert.equal(clickRes.ok, true);

    const typeRes = await tool.execute({
      operation: 'desktop_type',
      args: { text: 'npm test' },
      risk: 'medium',
      mutatesState: true
    });
    assert.equal(typeRes.ok, true);
  });

  it('executes desktop_capture_burst and returns frame sample & SHA-256 digest', async () => {
    await manager.startSandbox();

    const burstRes = await tool.execute({
      operation: 'desktop_capture_burst',
      args: { durationMs: 500, fps: 6 },
      risk: 'low',
      mutatesState: false
    });

    assert.equal(burstRes.ok, true);
    assert.ok(burstRes.output.captureId);
    assert.ok(burstRes.output.digestSha256);
    assert.ok(Array.isArray(burstRes.output.frameSample));
  });

  it('executes snapshot and revert workflow through tool adapter', async () => {
    await manager.startSandbox();

    const snapRes = await tool.execute({
      operation: 'desktop_snapshot',
      args: { name: 'Adapter Test Snapshot' },
      risk: 'medium',
      mutatesState: true
    });
    assert.equal(snapRes.ok, true);
    const snapId = (snapRes.output.snapshot as any).id;

    const revertRes = await tool.execute({
      operation: 'desktop_revert',
      args: { snapshotId: snapId },
      risk: 'high',
      mutatesState: true
    });
    assert.equal(revertRes.ok, true);
  });

  it('handles unknown operations gracefully with ok: false', async () => {
    const res = await tool.execute({
      operation: 'non_existent_op',
      args: {},
      risk: 'low',
      mutatesState: false
    });
    assert.equal(res.ok, false);
    assert.ok(String(res.output.error).includes('Unknown desktop_control operation'));
  });
});
