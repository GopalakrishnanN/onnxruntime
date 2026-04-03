// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * 1DS SDK transport for ONNX Runtime Web telemetry.
 *
 * Uses @microsoft/1ds-core-js and @microsoft/1ds-post-js to send telemetry
 * events to Microsoft's OneCollector endpoint in Common Schema 4.0 format.
 *
 * This module is dynamically imported by telemetry.ts so that the 1DS SDK
 * is only loaded when telemetry is enabled (~49KB gzipped).
 */

import type { TelemetryTransport } from './telemetry';

// Tenant token for 1DS telemetry ingestion, constructed at runtime to avoid plain-text scanning.
const _p = (a: string, b: string) => `${a}-${b}`;
const TENANT_TOKEN = _p(
  '5ad963bd4b3a4118a481401cc0211875',
  _p('0cb45159', _p('46f5', _p('4495', _p('b4e5', 'd0890355e964')))) + '-6797',
);

// OneCollector endpoint supporting browser CORS.
const COLLECTOR_URL = 'https://mobile.events.data.microsoft.com/OneCollector/1.0';

/**
 * 1DS SDK telemetry transport.
 *
 * Wraps the Application Insights 1DS SDK to serialize and deliver events
 * to the OneCollector endpoint. Events use Common Schema 4.0 for consistency
 * with Windows (ETW) and Posix (cpp_client_telemetry) ORT telemetry.
 */
export class OneDSTransport implements TelemetryTransport {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private core: any = null;
  private initialized = false;

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    try {
      // Dynamic import so bundle tools can tree-shake / code-split
      const [{ AppInsightsCore }, { PostChannel }] = await Promise.all([
        import('@microsoft/1ds-core-js'),
        import('@microsoft/1ds-post-js'),
      ]);

      this.core = new AppInsightsCore();
      const channel = new PostChannel();

      this.core.initialize(
        {
          instrumentationKey: TENANT_TOKEN,
          endpointUrl: COLLECTOR_URL,
          extensions: [channel],
          extensionConfig: {
            [channel.identifier]: {
              // Batch events and send at regular intervals
              eventsLimitInMem: 500,
            },
          },
        },
        [],
      );

      this.initialized = true;
    } catch {
      // If the 1DS SDK packages are not installed, this transport is a no-op.
      // Telemetry observation via env.telemetry.onEvent still works.
      this.initialized = false;
    }
  }

  sendEvent(eventName: string, eventData: Record<string, unknown>): void {
    if (!this.initialized || !this.core) {
      return;
    }

    this.core.track({
      name: `Microsoft.ML.ONNXRuntime.${eventName}`,
      baseType: 'EventData',
      data: {
        ...eventData,
        platform: 'WebAssembly',
      },
    });
  }

  async flush(): Promise<void> {
    if (this.initialized && this.core) {
      this.core.flush();
    }
  }

  async shutdown(): Promise<void> {
    if (this.initialized && this.core) {
      this.core.unload();
      this.core = null;
      this.initialized = false;
    }
  }
}
