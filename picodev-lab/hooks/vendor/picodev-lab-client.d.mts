export declare const DEFAULT_URL = "https://lab.picodev.fr/mcp";
export declare const MAX_FILES = 8;
export declare const MAX_FILES_BYTES: number;
export declare const MAX_PROGRAM: number;
export declare const MAX_COMPONENTS = 40;
export declare const MAX_WIRES = 120;
export declare const MAX_FIGURES = 3;
export declare const MAX_FIGURE_BYTES: number;
export declare const MAX_FIGURES_BYTES: number;
export type Mode = "free" | "challenge";
export type Visibility = "private" | "link" | "public";
export interface Session {
    session: string;
    agent_token: string;
    open_url: string;
}
export interface File {
    name: string;
    content: string;
}
export interface Setup {
    id: string;
    title?: string;
    summary?: string;
    modes: Mode[];
    /** available: open_session works; soon: listed, cannot be opened yet. */
    status?: "available" | "soon";
    /** status open: offered; soon: announced, not offered yet (counts 0). */
    benches: {
        kind: string;
        benches: number;
        free: number;
        waiting: number;
        status?: "open" | "soon";
    }[];
    /** title and summary are French; a non-French client takes i18n.en field by field (contract 0.9.1). */
    i18n?: {
        en?: {
            title?: string;
            summary?: string;
        };
    };
}
export interface Simulation {
    state: Record<string, any> | null;
    compile: {
        ok: boolean;
        log: string;
        origin?: "agent" | "cloud";
    } | null;
    events: {
        t: number;
        k: "pin" | "pwm" | "servo" | "serial";
        pin?: number;
        v: any;
    }[];
    challenge?: {
        level: number | null;
        brief: {
            id: string;
            title: string;
            brief: string;
            hints: string[];
        } | null;
        results: any;
    };
    /** The last state's circuit differs from the sheet's (not positions, colours or wire ids); null when either is unknown. */
    circuit_modified: boolean | null;
    /** The editor's last refusal of a pushed circuit, returned once. */
    circuit_error: string | null;
}
/** A circuit in the sheet's shape (hub.py `clean_circuit`); the board is not a component, wires name it by board.kind. */
export interface CircuitComponent {
    type: string;
    id: string;
    properties?: Record<string, string | number | boolean>;
    x?: number;
    y?: number;
}
export interface WireEnd {
    componentId: string;
    pinName: string;
}
export interface Wire {
    id: string;
    start: WireEnd;
    end: WireEnd;
    color?: string;
}
export interface Circuit {
    components: CircuitComponent[];
    wires: Wire[];
}
/** An MCP `image` content: data in base 64. */
export interface ToolImage {
    mimeType: string;
    data: string;
}
/** The served setup sheet; `images`: schema.png when it exists. */
export interface SetupSheet {
    schema: number;
    id: string;
    title: string;
    summary: string;
    board: {
        kind: string;
        fqbn: string;
    };
    files: File[];
    libraries: string[];
    circuit: Circuit;
    probes: {
        pin: number;
        label: string;
        kind: "scope" | "logic";
    }[];
    levels: Record<string, any>[];
    i18n?: Record<string, any>;
    images?: ToolImage[];
    [key: string]: unknown;
}
export interface QueueStatus {
    state: "none" | "waiting" | "turn";
    kind?: string;
    position?: number;
    waiting?: number;
    eta_s?: number;
    bench?: string;
    ends_at?: number;
}
export interface SessionStatus {
    setup: string;
    mode: Mode;
    owner: boolean;
    visibility: Visibility;
    viewer_url: string | null;
    viewers: number;
    created_at: number;
    expires_at: number;
    run: number;
    level: number | null;
    levels: number | null;
    capture: CaptureRef | null;
    /** The session's place in the bench queue, as queue_status gives it (contract 0.20). */
    queue: QueueStatus;
    /** The signed share link, `/p/<share>` (contract 0.20). */
    share?: string;
}
/** The session's capture in session_status (hub v0.6.1): read it with read_capture once, when state turns ready. */
export interface CaptureRef {
    id: string;
    kind: "logic" | "analog";
    state: "recording" | "ready" | "failed";
}
/** @deprecated Since 0.3.0 status() is session_status: use SessionStatus. */
export type Status = SessionStatus;
/** Pulses of one level: the levels between two edges (the first and last, cut by the window, are not). */
export interface Pulses {
    count: number;
    min_ms: number | null;
    max_ms: number | null;
}
/** Measures of one pin (hub.py `channel`); period_ms and duty only when the signal is periodic. */
export interface CaptureChannel {
    pin: number;
    label: string;
    edges: number;
    initial: 0 | 1;
    high_ms: number;
    low_ms: number;
    period_ms?: number;
    duty?: number;
    pulses: {
        high: Pulses;
        low: Pulses;
    };
}
/** Measures of one analog channel (hub.py `analog_channel`), in volts; null without samples. */
export interface AnalogChannel {
    pin: number;
    label: string;
    min_v: number | null;
    max_v: number | null;
    mean_v: number | null;
    period_ms?: number;
}
interface CaptureBase {
    capture: string;
    state: "recording" | "ready" | "failed";
    detail?: string;
    duration_ms: number;
    next: number | null;
    /** format "png": the chart, once ready. */
    images?: ToolImage[];
}
/** edges [t_us, pin, v], absent with format "png". */
export interface LogicCapture extends CaptureBase {
    kind: "logic";
    channels: CaptureChannel[];
    edges?: [number, number, 0 | 1][];
    truncated: boolean;
    /** A triggered capture (contract 0.20); at_us null when no edge came within wait_ms (the whole capture is kept). */
    trigger?: Trigger & {
        at_us: number | null;
    };
}
export interface Trigger {
    pin: number;
    edge: "rising" | "falling" | "any";
}
/** decode_capture's arguments (contract 0.20): a ready logic capture of the session, channels are its pins. */
export type DecodeArgs = {
    capture: string;
    offset?: number;
} & ({
    protocol: "uart";
    channels: {
        rx: number;
    };
    options?: {
        baud?: number;
        bits?: number;
        parity?: "none" | "even" | "odd";
        stop?: 1 | 2;
        invert?: boolean;
    };
} | {
    protocol: "spi";
    channels: {
        sck: number;
        mosi?: number;
        miso?: number;
        cs?: number;
    };
    options?: {
        mode?: 0 | 1 | 2 | 3;
        bit_order?: "msb" | "lsb";
        bits?: number;
    };
} | {
    protocol: "i2c";
    channels: {
        scl: number;
        sda: number;
    };
});
export interface UartFrame {
    t_us: number;
    value: number;
    error?: "framing" | "parity";
}
export interface SpiFrame {
    t_us: number;
    mosi?: number;
    miso?: number;
}
export interface I2cFrame {
    t_us: number;
    kind: "start" | "restart" | "address" | "data" | "stop";
    value?: number;
    rw?: "read" | "write";
    ack?: boolean;
}
/** 2000 frames per page from offset; problems: what makes the decoding doubtful. uart: text, the page's printable bytes. */
export type Decoded = {
    capture: string;
    next: number | null;
    problems: string[];
} & ({
    protocol: "uart";
    frames: UartFrame[];
    text: string;
} | {
    protocol: "spi";
    frames: SpiFrame[];
} | {
    protocol: "i2c";
    frames: I2cFrame[];
});
/** samples: rows of millivolts in the order of pins, row k at k / rate_hz; absent with format "png". */
export interface AnalogCapture extends CaptureBase {
    kind: "analog";
    rate_hz: number;
    channels: AnalogChannel[];
    samples?: number[][];
}
export type Capture = LogicCapture | AnalogCapture;
export interface Contact {
    name: string;
    email: string;
    company?: string;
    phone?: string;
}
export type Availabilities = {
    from: string;
    to: string;
}[] | {
    text: string;
};
/** The host's send: one POST, the whole answer as text. Default: fetch; in a Claude Code mod, $.http.fetch. */
export type Post = (url: string, body: string, headers: Record<string, string>) => Promise<{
    status: number;
    text: string;
    headers?: Record<string, string>;
}>;
/**
 * gone: unknown or ended session (the held one is forgotten); no_browser: no owner connected;
 * limit: refused locally, no call; hub: any other hub error; transport: no readable JSON-RPC answer.
 */
export type LabErrorKind = "gone" | "no_browser" | "limit" | "hub" | "transport";
/** An error of the hub (its text, without FastMCP's prefix) or a local refusal made before any call. */
export declare class LabError extends Error {
    readonly kind: LabErrorKind;
    name: string;
    constructor(message: string, kind?: LabErrorKind);
}
/** One section of spec_draft: look_for and questions while it is not filled. */
export interface SpecSection {
    id: string;
    heading: string;
    required: boolean;
    state: "empty" | "thin" | "filled";
    look_for?: string;
    questions?: string[];
}
/** An illustration of the spec (contract 0.16), approved by the visitor: data is the file in base 64. */
export interface SpecFigure {
    section: string;
    caption: string;
    type: "png" | "svg";
    data: string;
}
export interface SpecDraft {
    rules: string[];
    sections: SpecSection[];
    next: string | null;
    ready: boolean;
    filename?: string;
    pdf?: string;
}
export declare class LabClient {
    /** The held session. The host may set it to restore one it kept (e.g. VS Code SecretStorage). */
    session: Session | null;
    readonly url: string;
    private post;
    private id;
    /** name and version are kept for compatibility: without initialize, the hub is never told them. */
    constructor(opts?: {
        url?: string;
        name?: string;
        version?: string;
        post?: Post;
    });
    private rpc;
    /** The tools the hub serves. */
    tools(): Promise<{
        name: string;
        description: string;
    }[]>;
    /** Calls a hub tool by name and returns its result; a hub error is thrown as a LabError with its text. */
    call(name: string, args?: Record<string, unknown>): Promise<any>;
    private held;
    private withSession;
    /** @deprecated Nothing to close since 0.2.0 (one POST per call); kept for the hosts that call it. */
    close(): Promise<void>;
    list_setups(): Promise<Setup[]>;
    open_session(args: {
        setup: string;
        mode: Mode;
    }): Promise<Session>;
    push_to_editor(args: {
        files: File[];
        run?: boolean;
    }): Promise<string>;
    /** A program the agent compiled (Intel HEX text), loaded without compiling; files: its sources, shown read-only. */
    push_program(args: {
        hex: string;
        files?: File[];
        run?: boolean;
    }): Promise<string>;
    read_simulation(args?: {
        since_ms?: number;
    }): Promise<Simulation>;
    set_visibility(args: {
        visibility: Visibility;
    }): Promise<{
        visibility: Visibility;
        viewer_url: string | null;
    }>;
    queue_join(args: {
        kind: string;
    }): Promise<{
        kind: string;
        position: number;
        waiting: number;
        eta_s: number;
    }>;
    queue_status(): Promise<QueueStatus>;
    queue_leave(): Promise<{
        state: "none";
    }>;
    close_session(): Promise<{
        state: "ended";
    }>;
    session_status(): Promise<SessionStatus>;
    /** With a trigger, recording lasts wait_ms + duration_ms; pre_ms (0..wait_ms) kept before the edge (contract 0.20). */
    capture_logic(args?: {
        pins?: number[];
        duration_ms?: number;
        trigger?: Trigger;
        wait_ms?: number;
        pre_ms?: number;
    }): Promise<{
        capture: string;
        state: "recording";
    }>;
    read_capture(args: {
        capture: string;
        offset?: number;
        format?: "json" | "png";
        from_ms?: number;
        to_ms?: number;
    }): Promise<Capture>;
    /** Decodes a ready logic capture of the session: uart, spi or i2c (contract 0.20). */
    decode_capture<A extends DecodeArgs>(args: A): Promise<Extract<Decoded, {
        protocol: A["protocol"];
    }>>;
    capture_analog(args?: {
        pins?: number[];
        duration_ms?: number;
        rate_hz?: number;
    }): Promise<{
        capture: string;
        state: "recording";
    }>;
    read_setup(args: {
        id: string;
    }): Promise<SetupSheet>;
    /** Free mode only; the outcome is read with read_simulation (state.circuit, circuit_error). */
    push_circuit(args: Circuit): Promise<string>;
    /** During the session's turn on a real bench: its photo (image/jpeg). */
    bench_snapshot(): Promise<{
        images: ToolImage[];
    }>;
    /** Challenge mode: the bench's "Next level", only when it would be offered; returns the new level (contract 0.8.3). */
    next_level(): Promise<{
        level: number;
        levels: number;
    }>;
    private optSession;
    /** The spec interview (contract 0.14): rules, sections and what to ask next; pdf: true adds the PDF. Never a session. */
    spec_draft(args?: {
        title?: string;
        sections?: Record<string, string>;
        language?: "fr" | "en";
        pdf?: boolean;
        figures?: SpecFigure[];
    }): Promise<SpecDraft>;
    brief_submit(args: {
        title: string;
        contact?: Contact;
        sections?: Record<string, string>;
        figures?: SpecFigure[];
        nda?: boolean;
        consent?: boolean;
        send?: boolean;
        with_session?: boolean;
        language?: "fr" | "en";
    }): Promise<{
        sent: boolean;
        filename: string;
        pdf?: string;
        missing: string[];
        next: string;
    }>;
    request_meeting(args: {
        contact: Contact;
        context: string;
        availabilities: Availabilities;
        consent: boolean;
        with_session?: boolean;
    }): Promise<{
        sent: boolean;
        next: string;
    }>;
    /** session_status, for a host that polls it (every 2 s at most, only while a session is held). */
    status(): Promise<SessionStatus>;
}
export {};
