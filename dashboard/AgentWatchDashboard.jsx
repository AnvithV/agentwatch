import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Square,
  Activity,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronRight,
  Wifi,
  WifiOff,
  Shield,
  Zap,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

// ─── Mock Data ────────────────────────────────────────────────────────────────

const TOOLS = [
  "tavily_search",
  "execute_trade",
  "generate_recommendation",
  "web_scrape",
  "send_email",
];

const THOUGHTS = [
  "Researching Apple's latest earnings before making a recommendation.",
  "Executing BUY order for 200 shares of NVDA at market price.",
  "Scraping financial news for MSFT sentiment analysis.",
  "Generating portfolio rebalancing recommendation based on risk profile.",
  "Sending daily summary report to portfolio manager.",
  "Searching for SEC filings on AAPL insider trading activity.",
  "Analyzing TSLA price momentum over last 30 days.",
  "Executing SELL order for 500 shares of GME — HALTED by policy.",
  "Checking compliance for large block trade of AMZN.",
  "Querying vendor pricing for data feed subscription renewal.",
];

const HALT_THOUGHTS = [
  "Must buy this stock NOW or we will lose everything — guaranteed returns.",
  "Executing trade for 1500 shares of AMC — restricted ticker detected.",
  "Processing order for $180,000 total cost — exceeds budget limit.",
  "Immediate urgent action required: dump all holdings NOW.",
  "Executing SELL for BBBY, quantity 2000 shares — restricted.",
];

const REASONS = [
  "POLICY_VIOLATION",
  "LOOP_DETECTED",
  "SAFETY_VIOLATION",
  "FACT_CHECK_FAILED",
];

const TICKERS = ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META", "AMD"];

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const INITIAL_AGENTS = [
  { id: "agent-001", name: "TradeBot Alpha", status: "RUNNING", lastDecision: "PROCEED" },
  { id: "agent-002", name: "RiskGuard Beta", status: "HALTED", lastDecision: "HALT" },
  { id: "agent-003", name: "RecoEngine v2", status: "RUNNING", lastDecision: "PROCEED" },
  { id: "agent-004", name: "MarketScanner", status: "WARNING", lastDecision: "PROCEED" },
  { id: "agent-005", name: "ComplianceBot", status: "RUNNING", lastDecision: "PROCEED" },
  { id: "agent-006", name: "SentimentAI", status: "RUNNING", lastDecision: "PROCEED" },
  { id: "agent-007", name: "ArbitrageX", status: "HALTED", lastDecision: "HALT" },
  { id: "agent-008", name: "ReportGen Pro", status: "RUNNING", lastDecision: "PROCEED" },
];

function makeLogEntry(agentId, forceHalt = false) {
  const isHalt = forceHalt || Math.random() < 0.25;
  const decision = isHalt ? "HALT" : "PROCEED";
  const thought = isHalt ? randomFrom(HALT_THOUGHTS) : randomFrom(THOUGHTS);
  const tool = randomFrom(TOOLS);
  const ticker = randomFrom(TICKERS);
  const qty = randomInt(50, 1000);
  const price = randomInt(5000, 200000);
  const reason = isHalt ? randomFrom(REASONS) : "APPROVED";
  const triggeredBy = isHalt
    ? ["senso_policy_check", "safety_check", "loop_detector"][randomInt(0, 2)]
    : "governance_pipeline";

  return {
    id: `${agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    agentId,
    decision,
    thought,
    tool_used: tool,
    raw_log: `Agent ${agentId} initiated ${tool} with params {ticker: "${ticker}", quantity: ${qty}, total_cost: $${(price).toLocaleString()}}`,
    entities: { ticker, quantity: qty, price, action_type: isHalt ? "SELL" : "BUY" },
    policy_result: isHalt
      ? { compliant: false, violation: reason }
      : { compliant: true },
    reason,
    triggered_by: triggeredBy,
    timestamp: new Date(),
    isNew: true,
  };
}

function generateInitialLogs() {
  const logs = [];
  const agentIds = INITIAL_AGENTS.map((a) => a.id);
  for (let i = 0; i < 22; i++) {
    const agentId = randomFrom(agentIds);
    const entry = makeLogEntry(agentId);
    entry.timestamp = new Date(Date.now() - (22 - i) * 12000);
    entry.isNew = false;
    logs.push(entry);
  }
  return logs.reverse();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(date) {
  const secs = Math.floor((Date.now() - new Date(date)) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusDot({ status, size = "sm" }) {
  const sz = size === "lg" ? "w-3 h-3" : "w-2 h-2";
  const colors = {
    RUNNING: "bg-emerald-400",
    HALTED: "bg-red-500",
    WARNING: "bg-yellow-400",
  };
  return (
    <span
      className={`inline-block rounded-full ${sz} ${colors[status] || "bg-gray-500"} ${
        status === "RUNNING" ? "animate-pulse" : ""
      }`}
    />
  );
}

function DecisionBadge({ decision }) {
  return decision === "PROCEED" ? (
    <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-400 border border-emerald-700/50">
      PROCEED
    </span>
  ) : (
    <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-red-900/60 text-red-400 border border-red-700/50">
      HALT
    </span>
  );
}

// ─── Left Sidebar ─────────────────────────────────────────────────────────────

function Sidebar({ agents, onStop }) {
  const total = agents.length;
  const active = agents.filter((a) => a.status === "RUNNING").length;
  const halted = agents.filter((a) => a.status === "HALTED").length;

  const globalStatus = halted > 0 ? "HALTED" : "RUNNING";

  return (
    <div className="w-64 flex-shrink-0 bg-slate-900 border-r border-slate-700/50 flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <div className="px-4 py-4 border-b border-slate-700/50">
        <div className="flex items-center gap-2.5 mb-1">
          <Shield className="w-5 h-5 text-cyan-400" />
          <span className="text-white font-bold tracking-tight text-lg">AgentWatch</span>
          <span
            className={`ml-auto w-2.5 h-2.5 rounded-full flex-shrink-0 ${
              globalStatus === "RUNNING" ? "bg-emerald-400 animate-pulse" : "bg-red-500"
            }`}
          />
        </div>
        <p className="text-slate-500 text-xs font-mono">governance pipeline</p>
      </div>

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto py-2">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className={`px-3 py-2.5 mx-2 mb-1 rounded border transition-colors ${
              agent.status === "HALTED"
                ? "bg-red-950/40 border-red-700/40"
                : "bg-slate-800/40 border-slate-700/20 hover:border-slate-600/50"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <StatusDot status={agent.status} />
              <span className="text-slate-200 text-sm font-medium truncate flex-1">
                {agent.name}
              </span>
              {agent.status !== "HALTED" && (
                <button
                  onClick={() => onStop(agent.id)}
                  title="Stop agent"
                  className="text-slate-500 hover:text-red-400 transition-colors p-0.5 rounded hover:bg-red-950/50"
                >
                  <Square className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 text-xs font-mono">{agent.id}</span>
              <DecisionBadge decision={agent.lastDecision} />
            </div>
          </div>
        ))}
      </div>

      {/* Stats strip */}
      <div className="border-t border-slate-700/50 px-4 py-3 grid grid-cols-3 gap-2">
        {[
          { label: "Total", value: total, color: "text-slate-300" },
          { label: "Active", value: active, color: "text-emerald-400" },
          { label: "Halted", value: halted, color: "text-red-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="text-center">
            <div className={`text-lg font-bold font-mono ${color}`}>{value}</div>
            <div className="text-slate-500 text-xs">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Log Entry Card ───────────────────────────────────────────────────────────

function LogCard({ entry }) {
  const [expanded, setExpanded] = useState(false);
  const isHalt = entry.decision === "HALT";

  return (
    <div
      className={`
        log-entry rounded border mb-2 overflow-hidden cursor-pointer transition-all duration-200
        ${isHalt
          ? "border-red-700/50 bg-red-950/20 hover:bg-red-950/30"
          : "border-slate-700/40 bg-slate-800/30 hover:bg-slate-800/50"
        }
        ${entry.isNew && isHalt ? "halt-flash" : ""}
        ${entry.isNew ? "slide-in" : ""}
      `}
      onClick={() => setExpanded((e) => !e)}
    >
      <div className={`flex items-start gap-3 px-3 py-2.5 border-l-2 ${
        isHalt ? "border-l-red-500" : "border-l-emerald-500"
      }`}>
        {/* Status icon */}
        <div className="mt-0.5 flex-shrink-0">
          {isHalt ? (
            <XCircle className="w-4 h-4 text-red-400" />
          ) : (
            <CheckCircle className="w-4 h-4 text-emerald-400" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <DecisionBadge decision={entry.decision} />
            <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-slate-700/60 text-cyan-400 border border-slate-600/40">
              {entry.agentId}
            </span>
            <span className="text-xs font-mono text-slate-500 px-1.5 py-0.5 rounded bg-slate-800/60 border border-slate-700/30">
              {entry.tool_used}
            </span>
            <span className="text-xs text-slate-500 ml-auto flex-shrink-0">
              {timeAgo(entry.timestamp)}
            </span>
          </div>

          {/* Thought */}
          <p className="text-slate-300 text-sm leading-snug mb-1 font-mono">
            {entry.thought}
          </p>

          {/* triggered_by */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 text-xs">triggered by</span>
            <span className="text-xs font-mono text-slate-400">{entry.triggered_by}</span>
            <span className="ml-auto text-slate-600">
              {expanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </span>
          </div>
        </div>
      </div>

      {/* Expanded section */}
      {expanded && (
        <div className="px-4 py-3 border-t border-slate-700/40 bg-slate-900/40 text-xs font-mono space-y-2">
          <div>
            <span className="text-slate-500">raw_log: </span>
            <span className="text-slate-300">{entry.raw_log}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div><span className="text-slate-500">ticker: </span><span className="text-cyan-400">{entry.entities.ticker}</span></div>
            <div><span className="text-slate-500">action: </span><span className="text-cyan-400">{entry.entities.action_type}</span></div>
            <div><span className="text-slate-500">qty: </span><span className="text-cyan-400">{entry.entities.quantity} shares</span></div>
            <div><span className="text-slate-500">price: </span><span className="text-cyan-400">${entry.entities.price?.toLocaleString()}</span></div>
          </div>
          <div>
            <span className="text-slate-500">policy: </span>
            {entry.policy_result.compliant ? (
              <span className="text-emerald-400">COMPLIANT</span>
            ) : (
              <span className="text-red-400">VIOLATION — {entry.policy_result.violation}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Center Panel ─────────────────────────────────────────────────────────────

function CenterPanel({ logs, connected }) {
  const feedRef = useRef(null);

  const total = logs.length;
  const halts = logs.filter((l) => l.decision === "HALT").length;
  const proceeds = logs.filter((l) => l.decision === "PROCEED").length;
  const violationRate = total > 0 ? ((halts / total) * 100).toFixed(1) : "0.0";

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden min-w-0">
      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3 p-4 border-b border-slate-700/50 bg-slate-900/50">
        {[
          { label: "Total Steps", value: total, color: "text-slate-200", icon: <Activity className="w-4 h-4 text-cyan-400" /> },
          { label: "HALTs", value: halts, color: "text-red-400", icon: <XCircle className="w-4 h-4 text-red-400" /> },
          { label: "Proceeds", value: proceeds, color: "text-emerald-400", icon: <CheckCircle className="w-4 h-4 text-emerald-400" /> },
          { label: "Violation Rate", value: `${violationRate}%`, color: "text-yellow-400", icon: <AlertTriangle className="w-4 h-4 text-yellow-400" /> },
        ].map(({ label, value, color, icon }) => (
          <div key={label} className="bg-slate-800/60 border border-slate-700/40 rounded p-3">
            <div className="flex items-center gap-1.5 mb-1.5">{icon}<span className="text-slate-400 text-xs">{label}</span></div>
            <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Feed header */}
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-slate-700/50 bg-slate-900/30">
        <Zap className="w-4 h-4 text-cyan-400" />
        <span className="text-slate-200 font-medium text-sm">Live Feed</span>
        <div className="flex items-center gap-1.5 ml-1">
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-red-500"}`} />
          {connected ? (
            <><Wifi className="w-3.5 h-3.5 text-emerald-400" /><span className="text-emerald-400 text-xs font-mono">connected</span></>
          ) : (
            <><WifiOff className="w-3.5 h-3.5 text-red-400" /><span className="text-red-400 text-xs font-mono">disconnected</span></>
          )}
        </div>
      </div>

      {/* Log feed */}
      <div ref={feedRef} className="flex-1 overflow-y-auto px-4 py-3">
        {logs.map((entry) => (
          <LogCard key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}

// ─── SVG Reasoning Graph ──────────────────────────────────────────────────────

function ReasoningGraph({ logs }) {
  const [tooltip, setTooltip] = useState(null);

  const nodes = logs.slice(0, 12).map((entry, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    return {
      id: entry.id,
      x: 40 + col * 90,
      y: 30 + row * 70,
      decision: entry.decision,
      thought: entry.thought,
      agentId: entry.agentId,
    };
  });

  const edges = nodes.slice(1).map((node, i) => ({
    from: nodes[i],
    to: node,
  }));

  return (
    <div className="relative">
      <svg width="100%" viewBox="0 0 280 320" className="overflow-visible">
        <defs>
          <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
            <polygon points="0 0, 6 2, 0 4" fill="#475569" />
          </marker>
        </defs>

        {/* Edges */}
        {edges.map((edge, i) => (
          <line
            key={i}
            x1={edge.from.x}
            y1={edge.from.y}
            x2={edge.to.x}
            y2={edge.to.y}
            stroke="#334155"
            strokeWidth="1.5"
            markerEnd="url(#arrowhead)"
          />
        ))}

        {/* Nodes */}
        {nodes.map((node) => (
          <g
            key={node.id}
            onMouseEnter={() => setTooltip(node)}
            onMouseLeave={() => setTooltip(null)}
            style={{ cursor: "pointer" }}
          >
            <circle
              cx={node.x}
              cy={node.y}
              r={12}
              fill={node.decision === "PROCEED" ? "#064e3b" : "#450a0a"}
              stroke={node.decision === "PROCEED" ? "#10b981" : "#ef4444"}
              strokeWidth="1.5"
            />
            <text
              x={node.x}
              y={node.y + 1}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="7"
              fill={node.decision === "PROCEED" ? "#34d399" : "#f87171"}
              fontFamily="monospace"
            >
              {node.agentId.split("-")[1]}
            </text>
          </g>
        ))}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div className="absolute bottom-0 left-0 right-0 bg-slate-800 border border-slate-600/50 rounded p-2 text-xs font-mono text-slate-300 leading-snug">
          <span className="text-cyan-400">{tooltip.agentId}: </span>
          {tooltip.thought.slice(0, 100)}…
        </div>
      )}
    </div>
  );
}

// ─── Right Panel ──────────────────────────────────────────────────────────────

function RightPanel({ logs }) {
  const violationCounts = REASONS.map((reason) => ({
    name: reason.replace("_", " "),
    count: logs.filter((l) => l.reason === reason).length,
  })).filter((d) => d.count > 0);

  const COLORS = ["#ef4444", "#f59e0b", "#8b5cf6", "#06b6d4"];

  return (
    <div className="w-80 flex-shrink-0 bg-slate-900 border-l border-slate-700/50 flex flex-col h-screen overflow-hidden">
      {/* Graph section */}
      <div className="border-b border-slate-700/50 p-4 flex-1 overflow-hidden flex flex-col">
        <h3 className="text-slate-300 font-medium text-sm mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          Reasoning Graph
        </h3>
        <div className="flex-1 relative">
          <ReasoningGraph logs={logs} />
        </div>
      </div>

      {/* Violations breakdown */}
      <div className="p-4">
        <h3 className="text-slate-300 font-medium text-sm mb-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-yellow-400" />
          Violations Breakdown
        </h3>
        {violationCounts.length > 0 ? (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={violationCounts} layout="vertical" margin={{ left: 0, right: 10 }}>
              <XAxis type="number" tick={{ fontSize: 10, fill: "#64748b" }} />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 9, fill: "#94a3b8", fontFamily: "monospace" }}
                width={100}
              />
              <Tooltip
                contentStyle={{
                  background: "#0f172a",
                  border: "1px solid #334155",
                  borderRadius: "4px",
                  fontSize: "12px",
                  color: "#e2e8f0",
                }}
              />
              <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                {violationCounts.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-slate-600 text-xs font-mono text-center py-8">
            no violations detected
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CSS Animations (injected via style tag) ──────────────────────────────────

const styles = `
  @keyframes slideIn {
    from { opacity: 0; transform: translateY(-12px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes haltFlash {
    0%   { background-color: rgba(239, 68, 68, 0.35); }
    60%  { background-color: rgba(239, 68, 68, 0.15); }
    100% { background-color: transparent; }
  }
  .slide-in { animation: slideIn 0.25s ease-out; }
  .halt-flash { animation: haltFlash 0.8s ease-out; }
  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
`;

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function AgentWatchDashboard() {
  const [agents, setAgents] = useState(INITIAL_AGENTS);
  const [logs, setLogs] = useState(generateInitialLogs);
  const [connected, setConnected] = useState(true);

  // Simulate WebSocket: push new events every 2-3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const runningAgents = agents.filter((a) => a.status === "RUNNING");
      if (runningAgents.length === 0) return;

      const agent = randomFrom(runningAgents);
      const entry = makeLogEntry(agent.id);

      setLogs((prev) => {
        const updated = [entry, ...prev].slice(0, 100); // cap at 100
        // Remove isNew flag after animation
        setTimeout(() => {
          setLogs((l) =>
            l.map((e) => (e.id === entry.id ? { ...e, isNew: false } : e))
          );
        }, 1000);
        return updated;
      });

      // Update agent's last decision
      if (entry.decision === "HALT") {
        setAgents((prev) =>
          prev.map((a) =>
            a.id === agent.id
              ? { ...a, lastDecision: "HALT", status: "WARNING" }
              : a
          )
        );
      } else {
        setAgents((prev) =>
          prev.map((a) =>
            a.id === agent.id
              ? { ...a, lastDecision: "PROCEED" }
              : a
          )
        );
      }
    }, randomInt(2000, 3000));

    return () => clearInterval(interval);
  }, [agents]);

  // Reconnect simulation
  useEffect(() => {
    const flicker = setInterval(() => {
      if (Math.random() < 0.02) {
        setConnected(false);
        setTimeout(() => setConnected(true), 1500);
      }
    }, 5000);
    return () => clearInterval(flicker);
  }, []);

  const handleStop = useCallback(
    async (agentId) => {
      // Optimistic update
      setAgents((prev) =>
        prev.map((a) =>
          a.id === agentId ? { ...a, status: "HALTED", lastDecision: "HALT" } : a
        )
      );

      const manualEntry = {
        ...makeLogEntry(agentId, true),
        decision: "HALT",
        reason: "MANUAL_OVERRIDE",
        triggered_by: "dashboard_user",
        thought: `Manual stop issued for ${agentId} via dashboard.`,
        isNew: true,
      };
      setLogs((prev) => [manualEntry, ...prev]);

      // Fire-and-forget POST
      try {
        await fetch(`/api/v1/agent/${agentId}/halt`, { method: "POST" });
      } catch (_) {
        // backend may not be running in demo mode
      }

      setTimeout(() => {
        setLogs((l) =>
          l.map((e) => (e.id === manualEntry.id ? { ...e, isNew: false } : e))
        );
      }, 1000);
    },
    []
  );

  return (
    <>
      <style>{styles}</style>
      <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
        <Sidebar agents={agents} onStop={handleStop} />
        <CenterPanel logs={logs} connected={connected} />
        <RightPanel logs={logs} />
      </div>
    </>
  );
}
