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

// ─── API ──────────────────────────────────────────────────────────────────────

const API = "/api/v1";

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API}${path}`, opts);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr) {
  const secs = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusDot({ status }) {
  const colors = { RUNNING: "bg-emerald-400", HALTED: "bg-red-500", WARNING: "bg-yellow-400" };
  return (
    <span className={`inline-block rounded-full w-2 h-2 flex-shrink-0 ${colors[status] || "bg-gray-500"} ${status === "RUNNING" ? "animate-pulse" : ""}`} />
  );
}

function DecisionBadge({ decision }) {
  return decision === "PROCEED" ? (
    <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-400 border border-emerald-700/50">PROCEED</span>
  ) : (
    <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-red-900/60 text-red-400 border border-red-700/50">HALT</span>
  );
}

// ─── Left Sidebar ─────────────────────────────────────────────────────────────

function Sidebar({ agents, onStop, connected }) {
  const total = agents.length;
  const active = agents.filter((a) => a.status === "RUNNING").length;
  const halted = agents.filter((a) => a.status === "HALTED").length;
  const globalStatus = halted > 0 ? "HALTED" : "RUNNING";

  return (
    <div className="w-64 flex-shrink-0 bg-slate-900 border-r border-slate-700/50 flex flex-col h-screen overflow-hidden">
      <div className="px-4 py-4 border-b border-slate-700/50">
        <div className="flex items-center gap-2.5 mb-1">
          <Shield className="w-5 h-5 text-cyan-400" />
          <span className="text-white font-bold tracking-tight text-lg">AgentWatch</span>
          <span className={`ml-auto w-2.5 h-2.5 rounded-full flex-shrink-0 ${globalStatus === "RUNNING" && connected ? "bg-emerald-400 animate-pulse" : "bg-red-500"}`} />
        </div>
        <p className="text-slate-500 text-xs font-mono">governance pipeline</p>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {agents.length === 0 ? (
          <div className="px-4 py-8 text-center text-slate-600 text-xs font-mono">
            {connected ? "waiting for agents..." : "backend offline"}
          </div>
        ) : (
          agents.map((agent) => (
            <div
              key={agent.agent_id}
              className={`px-3 py-2.5 mx-2 mb-1 rounded border transition-colors ${
                agent.status === "HALTED"
                  ? "bg-red-950/40 border-red-700/40"
                  : "bg-slate-800/40 border-slate-700/20 hover:border-slate-600/50"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <StatusDot status={agent.status} />
                <span className="text-slate-200 text-sm font-medium truncate flex-1">{agent.agent_id}</span>
                {agent.status !== "HALTED" && (
                  <button
                    onClick={() => onStop(agent.agent_id)}
                    title="Stop agent"
                    className="text-slate-500 hover:text-red-400 transition-colors p-0.5 rounded hover:bg-red-950/50"
                  >
                    <Square className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600 text-xs font-mono">
                  {agent.total_steps} steps · {agent.halt_count} halts
                </span>
                <DecisionBadge decision={agent.halt_count > 0 ? "HALT" : "PROCEED"} />
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-slate-700/50 px-4 py-3 grid grid-cols-3 gap-2">
        {[
          { label: "Total",  value: total,  color: "text-slate-300"  },
          { label: "Active", value: active, color: "text-emerald-400" },
          { label: "Halted", value: halted, color: "text-red-400"     },
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
      className={`log-entry rounded border mb-2 overflow-hidden cursor-pointer transition-all duration-200
        ${isHalt ? "border-red-700/50 bg-red-950/20 hover:bg-red-950/30" : "border-slate-700/40 bg-slate-800/30 hover:bg-slate-800/50"}
        ${entry.isNew && isHalt ? "halt-flash" : ""}
        ${entry.isNew ? "slide-in" : ""}
      `}
      onClick={() => setExpanded((e) => !e)}
    >
      <div className={`flex items-start gap-3 px-3 py-2.5 border-l-2 ${isHalt ? "border-l-red-500" : "border-l-emerald-500"}`}>
        <div className="mt-0.5 flex-shrink-0">
          {isHalt ? <XCircle className="w-4 h-4 text-red-400" /> : <CheckCircle className="w-4 h-4 text-emerald-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <DecisionBadge decision={entry.decision} />
            <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-slate-700/60 text-cyan-400 border border-slate-600/40">
              {entry.agent_id}
            </span>
            {entry.tool_used && entry.tool_used !== "—" && (
              <span className="text-xs font-mono text-slate-500 px-1.5 py-0.5 rounded bg-slate-800/60 border border-slate-700/30">
                {entry.tool_used}
              </span>
            )}
            <span className="text-xs text-slate-500 ml-auto flex-shrink-0">{timeAgo(entry.timestamp)}</span>
          </div>
          <p className="text-slate-300 text-sm leading-snug mb-1 font-mono">{entry.thought}</p>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 text-xs">triggered by</span>
            <span className="text-xs font-mono text-slate-400">{entry.triggered_by}</span>
            <span className="ml-auto text-slate-600">
              {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </span>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="px-4 py-3 border-t border-slate-700/40 bg-slate-900/40 text-xs font-mono space-y-2">
          {entry.raw_log && (
            <div><span className="text-slate-500">raw_log: </span><span className="text-slate-300">{entry.raw_log}</span></div>
          )}
          {entry.details && (
            <div>
              <span className="text-slate-500">details: </span>
              <span className={isHalt ? "text-red-400" : "text-emerald-400"}>{entry.details}</span>
            </div>
          )}
          <div><span className="text-slate-500">reason: </span><span className="text-cyan-400">{entry.reason}</span></div>
        </div>
      )}
    </div>
  );
}

// ─── Center Panel ─────────────────────────────────────────────────────────────

function CenterPanel({ logs, connected, stats }) {
  const total = stats?.total_steps ?? 0;
  const halts = stats?.halt_count ?? 0;
  const proceeds = stats?.proceed_count ?? 0;
  const violationRate = total > 0 ? ((halts / total) * 100).toFixed(1) : "0.0";

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden min-w-0">
      <div className="grid grid-cols-4 gap-3 p-4 border-b border-slate-700/50 bg-slate-900/50">
        {[
          { label: "Total Steps",    value: total,            color: "text-slate-200",   icon: <Activity className="w-4 h-4 text-cyan-400" />       },
          { label: "HALTs",          value: halts,            color: "text-red-400",     icon: <XCircle className="w-4 h-4 text-red-400" />          },
          { label: "Proceeds",       value: proceeds,         color: "text-emerald-400", icon: <CheckCircle className="w-4 h-4 text-emerald-400" />  },
          { label: "Violation Rate", value: `${violationRate}%`, color: "text-yellow-400", icon: <AlertTriangle className="w-4 h-4 text-yellow-400" /> },
        ].map(({ label, value, color, icon }) => (
          <div key={label} className="bg-slate-800/60 border border-slate-700/40 rounded p-3">
            <div className="flex items-center gap-1.5 mb-1.5">{icon}<span className="text-slate-400 text-xs">{label}</span></div>
            <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-slate-700/50 bg-slate-900/30">
        <Zap className="w-4 h-4 text-cyan-400" />
        <span className="text-slate-200 font-medium text-sm">Live Feed</span>
        <div className="flex items-center gap-1.5 ml-1">
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-red-500"}`} />
          {connected ? (
            <><Wifi className="w-3.5 h-3.5 text-emerald-400" /><span className="text-emerald-400 text-xs font-mono">live</span></>
          ) : (
            <><WifiOff className="w-3.5 h-3.5 text-red-400" /><span className="text-red-400 text-xs font-mono">backend offline</span></>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-600 font-mono text-sm gap-2">
            <Zap className="w-8 h-8 text-slate-700" />
            {connected
              ? <span>waiting for agent telemetry...</span>
              : <span>backend offline — start uvicorn to connect</span>
            }
          </div>
        ) : (
          logs.map((entry) => (
            <LogCard key={entry.id || `${entry.agent_id}-${entry.step_id}-${entry.timestamp}`} entry={entry} />
          ))
        )}
      </div>
    </div>
  );
}

// ─── SVG Reasoning Graph ──────────────────────────────────────────────────────

function ReasoningGraph({ logs }) {
  const [tooltip, setTooltip] = useState(null);
  const nodes = logs.slice(0, 12).map((entry, i) => ({
    id: entry.id || i,
    x: 40 + (i % 3) * 90,
    y: 30 + Math.floor(i / 3) * 70,
    decision: entry.decision,
    thought: entry.thought,
    agentId: entry.agent_id,
  }));
  const edges = nodes.slice(1).map((node, i) => ({ from: nodes[i], to: node }));

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-700 text-xs font-mono">
        no steps yet
      </div>
    );
  }

  return (
    <div className="relative">
      <svg width="100%" viewBox="0 0 280 320" className="overflow-visible">
        <defs>
          <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
            <polygon points="0 0, 6 2, 0 4" fill="#475569" />
          </marker>
        </defs>
        {edges.map((edge, i) => (
          <line key={i} x1={edge.from.x} y1={edge.from.y} x2={edge.to.x} y2={edge.to.y}
            stroke="#334155" strokeWidth="1.5" markerEnd="url(#arrowhead)" />
        ))}
        {nodes.map((node) => (
          <g key={node.id} onMouseEnter={() => setTooltip(node)} onMouseLeave={() => setTooltip(null)} style={{ cursor: "pointer" }}>
            <circle cx={node.x} cy={node.y} r={12}
              fill={node.decision === "PROCEED" ? "#064e3b" : "#450a0a"}
              stroke={node.decision === "PROCEED" ? "#10b981" : "#ef4444"}
              strokeWidth="1.5" />
            <text x={node.x} y={node.y + 1} textAnchor="middle" dominantBaseline="middle"
              fontSize="6" fill={node.decision === "PROCEED" ? "#34d399" : "#f87171"} fontFamily="monospace">
              {(node.agentId || "").slice(0, 6)}
            </text>
          </g>
        ))}
      </svg>
      {tooltip && (
        <div className="absolute bottom-0 left-0 right-0 bg-slate-800 border border-slate-600/50 rounded p-2 text-xs font-mono text-slate-300 leading-snug">
          <span className="text-cyan-400">{tooltip.agentId}: </span>
          {(tooltip.thought || "").slice(0, 100)}{tooltip.thought?.length > 100 ? "…" : ""}
        </div>
      )}
    </div>
  );
}

// ─── Right Panel ──────────────────────────────────────────────────────────────

function RightPanel({ logs, stats }) {
  const violationCounts = stats?.violations_by_type
    ? Object.entries(stats.violations_by_type).map(([name, count]) => ({ name: name.replace(/_/g, " "), count }))
    : [];

  const COLORS = ["#ef4444", "#f59e0b", "#8b5cf6", "#06b6d4"];

  return (
    <div className="w-80 flex-shrink-0 bg-slate-900 border-l border-slate-700/50 flex flex-col h-screen overflow-hidden">
      <div className="border-b border-slate-700/50 p-4 flex-1 overflow-hidden flex flex-col">
        <h3 className="text-slate-300 font-medium text-sm mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          Reasoning Graph
        </h3>
        <div className="flex-1 relative">
          <ReasoningGraph logs={logs} />
        </div>
      </div>

      <div className="p-4">
        <h3 className="text-slate-300 font-medium text-sm mb-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-yellow-400" />
          Violations Breakdown
        </h3>
        {violationCounts.length > 0 ? (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={violationCounts} layout="vertical" margin={{ left: 0, right: 10 }}>
              <XAxis type="number" tick={{ fontSize: 10, fill: "#64748b" }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: "#94a3b8", fontFamily: "monospace" }} width={100} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: "4px", fontSize: "12px", color: "#e2e8f0" }} />
              <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                {violationCounts.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-slate-700 text-xs font-mono text-center py-8">no violations yet</div>
        )}
      </div>
    </div>
  );
}

// ─── CSS Animations ───────────────────────────────────────────────────────────

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
  const [agents, setAgents] = useState([]);
  const [logs, setLogs]     = useState([]);
  const [stats, setStats]   = useState(null);
  const [connected, setConnected] = useState(false);
  const localHalted = useRef(new Set());
  const seenIds     = useRef(new Set());

  function mapAgents(raw) {
    return (raw || []).map((a) => ({
      ...a,
      status: localHalted.current.has(a.agent_id)
        ? "HALTED"
        : a.halt_count > 0
        ? "WARNING"
        : "RUNNING",
    }));
  }

  // ── Poll backend every 3 seconds ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const [recentData, statsData, agentsData] = await Promise.all([
          apiFetch("/recent?limit=50"),
          apiFetch("/stats"),
          apiFetch("/agents"),
        ]);

        if (cancelled) return;

        setConnected(true);
        setStats(statsData);
        setAgents(mapAgents(agentsData.agents));

        // Only add genuinely new entries
        const newEntries = (recentData.decisions || []).filter((d) => {
          const uid = d.id || `${d.agent_id}-${d.step_id}`;
          if (seenIds.current.has(uid)) return false;
          seenIds.current.add(uid);
          return true;
        }).map((d) => ({ ...d, isNew: true }));

        if (newEntries.length > 0) {
          setLogs((prev) => {
            setTimeout(() => {
              setLogs((l) =>
                l.map((e) => newEntries.some((n) => n.id === e.id) ? { ...e, isNew: false } : e)
              );
            }, 1000);
            return [...newEntries, ...prev].slice(0, 100);
          });
        }
      } catch {
        if (!cancelled) setConnected(false);
      }
    }

    poll(); // immediate first fetch
    const interval = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // ── Stop handler ──────────────────────────────────────────────────────────
  const handleStop = useCallback(async (agentId) => {
    localHalted.current.add(agentId);
    setAgents((prev) =>
      prev.map((a) => a.agent_id === agentId ? { ...a, status: "HALTED" } : a)
    );

    const manualEntry = {
      id: `halt-${agentId}-${Date.now()}`,
      agent_id: agentId,
      decision: "HALT",
      reason: "MANUAL_OVERRIDE",
      details: "Agent halted via dashboard",
      triggered_by: "dashboard_user",
      thought: `Manual stop issued for ${agentId} via AgentWatch dashboard.`,
      tool_used: "—",
      raw_log: "",
      timestamp: new Date().toISOString(),
      isNew: true,
    };
    seenIds.current.add(manualEntry.id);
    setLogs((prev) => {
      setTimeout(() => {
        setLogs((l) => l.map((e) => e.id === manualEntry.id ? { ...e, isNew: false } : e));
      }, 1000);
      return [manualEntry, ...prev];
    });

    try {
      await fetch(`${API}/agent/${agentId}/halt`, { method: "POST" });
    } catch { /* backend may restart */ }
  }, []);

  return (
    <>
      <style>{styles}</style>
      <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
        <Sidebar agents={agents} onStop={handleStop} connected={connected} />
        <CenterPanel logs={logs} connected={connected} stats={stats} />
        <RightPanel logs={logs} stats={stats} />
      </div>
    </>
  );
}
