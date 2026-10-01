import { useState } from "react";
import type { BoardClient } from "@kanban/client";

/**
 * O8: make optimistic updates and rollback visible by hand.
 * Latency is simulated inside this tab's client (both directions); the reject/drop switches
 * are honoured by the server only in dev mode and apply to the next intent on this board.
 */
export function DevPanel({ client }: { client: BoardClient }) {
  const [latency, setLatency] = useState(0);
  const [armed, setArmed] = useState<string | null>(null);

  const arm = (label: string, action: () => void) => {
    action();
    setArmed(label);
    setTimeout(() => setArmed(null), 2500);
  };

  return (
    <details className="dev">
      <summary>Dev panel</summary>
      <div className="dev-body">
        <label htmlFor="dev-latency">
          Network delay (this tab) <span className="mono">{latency} ms</span>
        </label>
        <input
          id="dev-latency"
          type="range"
          min={0}
          max={3000}
          step={100}
          value={latency}
          onChange={(e) => {
            const ms = Number(e.target.value);
            setLatency(ms);
            client.setLatency(ms);
          }}
        />
        <div className="dev-row">
          <button type="button" onClick={() => arm("Next change will be rejected", () => client.devRejectNext())}>
            Reject next change
          </button>
          <button
            type="button"
            onClick={() => arm("Next reply will be dropped (resend in 10 s)", () => client.devDropNextReply())}
          >
            Drop next reply
          </button>
        </div>
        {armed && <p className="mono">{armed}</p>}
        <p className="dev-outbox mono">
          Outbox: {client.getOutbox().length === 0 ? "empty" : client.getOutbox().map((i) => i.name).join(", ")}
        </p>
      </div>
    </details>
  );
}
