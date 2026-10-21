// SPDX-License-Identifier: Apache-2.0
// Inserted into the exact-hash-validated MIT upstream WebServer class.
export const gateMembers = `
	/** Distribution ABI: missing, failed and disposed access gates always deny. */
	get requiredAccessGateVersion() { return "required-access-gate-v1"; }
	requiredAccessGate;
	requiredAccessSockets = new Set();
	registerRequiredAccessGate(gate) {
		if (!gate || typeof gate.http !== "function" || typeof gate.upgrade !== "function") throw new Error("webserver: invalid required access gate");
		if (this.requiredAccessGate !== undefined) throw new Error("webserver: required access gate already registered");
		this.requiredAccessGate = gate;
		return () => {
			if (this.requiredAccessGate !== gate) return;
			this.requiredAccessGate = undefined;
			for (const socket of this.requiredAccessSockets) socket.destroy();
		};
	}
	isRequiredAccessGateActive(gate) { return this.requiredAccessGate === gate; }
	runRequiredAccessGate(kind, req, target) {
		const gate = this.requiredAccessGate;
		if (gate === undefined) {
			if (kind === "http") { target.writeHead(503, { "cache-control": "no-store", "connection": "close" }); target.end("access gate unavailable\\n"); }
			else target.end("HTTP/1.1 503 Service Unavailable\\r\\nConnection: close\\r\\nContent-Length: 0\\r\\n\\r\\n", () => target.destroy());
			return false;
		}
		try {
			const allowed = gate[kind](req, target);
			if (typeof allowed !== "boolean") throw new Error("webserver: required access gate must return boolean synchronously");
			return allowed && this.requiredAccessGate === gate;
		} catch {
			this.requiredAccessGate = undefined;
			for (const socket of this.requiredAccessSockets) socket.destroy();
			this.ctx.logger.error(new Error("webserver: required access gate failed; listener remains denied"));
			return false;
		}
	}
`;

export const gateDeclarations = `
/** Synchronous pre-dispatch admission; false means the gate owns rejection. */
export interface RequiredAccessGate {
    http(request: IncomingMessage, response: ServerResponse): boolean;
    upgrade(request: IncomingMessage, socket: Duplex): boolean;
}
`;
export const gateClassDeclarations = `
    readonly requiredAccessGateVersion: 'required-access-gate-v1';
    registerRequiredAccessGate(gate: RequiredAccessGate): () => void;
    isRequiredAccessGateActive(gate: RequiredAccessGate): boolean;
`;
