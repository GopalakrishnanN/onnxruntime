// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Telemetry bridge for ONNX Runtime Web.
 *
 * Receives structured telemetry events from the C++ WASM layer (via EM_JS)
 * and forwards them to:
 *   1. The 1DS transport (lazy-loaded) for sending to Microsoft's telemetry pipeline
 *   2. The observer callback (env.telemetry.onEvent) for user "listen in" capability
 */

import { env } from 'onnxruntime-common';

import type { OrtWasmModule } from './wasm-types';

/**
 * Interface for telemetry transports that can send events.
 */
export interface TelemetryTransport {
  sendEvent(eventName: string, eventData: Record<string, unknown>): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

let transport: TelemetryTransport | null = null;
let transportInitPromise: Promise<void> | null = null;

/**
 * Initialize the telemetry bridge by registering the callback on the WASM module.
 * Called during WASM/ORT initialization.
 */
export const initTelemetry = (module: OrtWasmModule): void => {
  // Register the callback that C++ WasmTelemetry calls via EM_JS.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (module as any)['__ortTelemetryCallback'] = (eventName: string, eventData: Record<string, unknown>) => {
    if (env.telemetry?.enabled === false) {
      return;
    }

    // Forward to observer callback ("listen in")
    try {
      env.telemetry?.onEvent?.(eventName, eventData);
    } catch {
      // Observer errors must not disrupt the application.
    }

    // Forward to 1DS transport
    if (transport) {
      transport.sendEvent(eventName, eventData);
    }
  };

  // Lazy-load the 1DS transport if telemetry is enabled
  if (env.telemetry?.enabled !== false) {
    transportInitPromise = initTransport();
  }
};

/**
 * Dynamically import and initialize the 1DS transport.
 * This ensures zero bundle cost when telemetry is disabled.
 */
const initTransport = async (): Promise<void> => {
  try {
    const { OneDSTransport } = await import('./telemetry-1ds-transport.js');
    transport = new OneDSTransport();
  } catch {
    // If the 1DS SDK is not available (e.g., custom build without it),
    // telemetry observation via onEvent still works.
  }
};

/**
 * Shutdown the telemetry transport. Called during cleanup.
 */
export const shutdownTelemetry = async (): Promise<void> => {
  if (transportInitPromise) {
    await transportInitPromise;
  }
  if (transport) {
    await transport.flush();
    await transport.shutdown();
    transport = null;
  }
};
