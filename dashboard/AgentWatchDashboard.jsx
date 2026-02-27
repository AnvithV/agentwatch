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
  RefreshCw,
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

// ─── API helpers ──────────────────────────────────────────────────────────────

const API = "/api/v1";

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API}${path}`, opts);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

// ─── Mock Data Fallback ───────────────────────────────────────────────────────
// Used when backend is unreachable (demo / standalone mode)

const TOOLS = ["tavily_search", "execute_trade", "generate_recommendation", "web_scrape", "send_email"];
const THOUGHTS = [
  "Researching Apple's latest earnings before making a recommendation.",
  "Executing BUY order for 200 shares of NVDA at market price.",
  "Scraping financial news for MSFT sentiment analysis.",
  "Generating portfolio rebalancing recommendation based on risk profile.",
  "Sending daily summary report to portfolio manager.",
  "Searching for SEC filings on AAPL insider trading activity.",
  "Analyzing TSLA price momentum over last 30 days.",
  "Checking compliance for large block trade of AMZN.",
];
const HALT_THOUGHTS = [
  "Must buy this stock NOW or we will lose everything — guaranteed returns.",
  "Executing trade for 1500 shares of AMC — restricted ticker detected.",
  "Processing order for $180,000 total cost — exceeds budget limit.",
  "Immediate urgent action required: dump all holdings NOW.",
];
const TICKERS = ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META", "AMD"];
const HALT_REASONS = ["POLICY_VIOLATION", "LOOP_DETECTED", "SAFETY_VIOLATION", "FACT_CHECK_FAILED"];

function randomFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

const MOCK_AGENTS = [
  { agent_id: "agent-001", name: "TradeBot Alpha",   status: "RUNNING", halt_count: 0, total_steps: 12 },
  { agent_id: "agent-002", name: "RiskGuard Beta",   status: "HALTED",  halt_count: 3, total_steps: 8  },
  { agent_id: "agent-003", name: "RecoEngine v2",    status: "RUNNING", halt_count: 1, total_steps: 20 },
  { agent_id: "agent-004", name: "MarketScanner",    status: "RUNNING", halt_count: 0, total_steps: 15 },
  { agent_id: "agent-005", name: "ComplianceBot",    status: "RUNNING", halt_count: 0, total_steps: 30 },
  { agent_id: "agent-006", name: "SentimentAI",      status: "RUNNING", halt_count: 2, total_steps: 18 },
  { agent_id: "agent-007", name: "ArbitrageX",       status: "HALTED",  halt_count: 5, total_steps: 10 },
  { agent_id: "agent-008", name: "ReportGen Pro",    status: "RUNNING", halt_count: 0, total_steps: 25 },
];

function makeMockEntry(agentId, forceHalt = false) {
  const isHalt = forceHalt || Math.random() < 0.25;
  const reason = isHalt ? randomFrom(HALT_REASONS) : "APPROVED";
  return {
    id: `${agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    agent_id: agentId,
    decision: isHalt ? "HALT" : "PROCEED",
    reason,
    details: isHalt ? `Violation: ${reason}` : "All governance checks passed",
    triggered_by: isHalt ? "senso_policy_check" : "governance_pipeline",
    thought: isHalt ? randomFrom(HALT_THOUGHTS) : randomFrom(THOUGHTS),
    tool_used: randomFrom(TOOLS),
    raw_log: `Agent ${agentId} initiated ${randomFrom(TOOLS)} with ticker ${randomFrom(TICKERS)}, qty ${randomInt(50, 1000)}, cost $${randomInt(5000, 200000).toLocaleString()}`,
    timestamp: new Date().toISOString(),
    isNew: true,
  };
}

function generateMockLogs() {
  const logs = [];
  for (let i = 0; i < 22; i++) {
    const agent = randomFrom(MOCK_AGENTS);
    const entry = makeMockEntry(agent.agent_id);
    entry.timestamp = new Date(Date.now() - (22 - i) * 12000).toISOString();
    entry.isNew = false;
    logs.push(entry);
  }
  return logs.reverse();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr) {
  const secs = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

// Merge backend agent list with local halt state
function mergeAgents(backendAgents, localHalted, agentNames) {
  return backendAgents.map((a) => ({
    ...a,
    name: agentNames[a.agent_id] || a.agent_id,
    status: localHalted.has(a.agent_id) ? "HALTED" : (a.halt_count > 2 ? "WARNING" : "RUNNING"),
    lastDecision: a.halt_count > 0 ? "HALT" : "PROCEED",
  }));
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

function Sidebar({ agents, onStop, mockMode, selectedAgent, onSelectAgent }) {
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
          <span className={`ml-auto w-2.5 h-2.5 rounded-full flex-shrink-0 ${globalStatus === "RUNNING" ? "bg-emerald-400 animate-pulse" : "bg-red-500"}`} />
        </div>
        <p className="text-slate-500 text-xs font-mono flex items-center gap-1">
          governance pipeline
          {mockMode && <span className="text-yellow-500 ml-1">[demo]</span>}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {agents.map((agent) => (
          <div
            key={agent.agent_id}
            onClick={() => onSelectAgent && onSelectAgent(agent.agent_id)}
            className={`px-3 py-2.5 mx-2 mb-1 rounded border transition-colors cursor-pointer ${
              selectedAgent === agent.agent_id
                ? "bg-cyan-950/50 border-cyan-500/60 ring-1 ring-cyan-500/30"
                : agent.status === "HALTED"
                ? "bg-red-950/40 border-red-700/40 hover:border-red-600/60"
                : "bg-slate-800/40 border-slate-700/20 hover:border-slate-600/50"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <StatusDot status={agent.status} />
              <span className="text-slate-200 text-sm font-medium truncate flex-1">{agent.name}</span>
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
              <span className="text-slate-500 text-xs font-mono">{agent.agent_id}</span>
              <DecisionBadge decision={agent.lastDecision || "PROCEED"} />
            </div>
            {agent.total_steps != null && (
              <div className="mt-1 text-slate-600 text-xs font-mono">
                {agent.total_steps} steps · {agent.halt_count || 0} halts
              </div>
            )}
          </div>
        ))}
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
  const hasWarnings = entry.warnings && entry.warnings.length > 0;

  return (
    <div
      className={`log-entry rounded border mb-2 overflow-hidden cursor-pointer transition-all duration-200
        ${isHalt ? "border-red-700/50 bg-red-950/20 hover:bg-red-950/30"
          : hasWarnings ? "border-yellow-700/50 bg-yellow-950/20 hover:bg-yellow-950/30"
          : "border-slate-700/40 bg-slate-800/30 hover:bg-slate-800/50"}
        ${entry.isNew && isHalt ? "halt-flash" : ""}
        ${entry.isNew ? "slide-in" : ""}
      `}
      onClick={() => setExpanded((e) => !e)}
    >
      <div className={`flex items-start gap-3 px-3 py-2.5 border-l-2 ${isHalt ? "border-l-red-500" : hasWarnings ? "border-l-yellow-500" : "border-l-emerald-500"}`}>
        <div className="mt-0.5 flex-shrink-0">
          {isHalt ? <XCircle className="w-4 h-4 text-red-400" />
            : hasWarnings ? <AlertTriangle className="w-4 h-4 text-yellow-400" />
            : <CheckCircle className="w-4 h-4 text-emerald-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <DecisionBadge decision={entry.decision} />
            {hasWarnings && (
              <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-yellow-900/60 text-yellow-400 border border-yellow-700/50">
                ⚠ {entry.warnings.length} warning{entry.warnings.length > 1 ? 's' : ''}
              </span>
            )}
            <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-slate-700/60 text-cyan-400 border border-slate-600/40">
              {entry.agent_id}
            </span>
            <span className="text-xs font-mono text-slate-500 px-1.5 py-0.5 rounded bg-slate-800/60 border border-slate-700/30">
              {entry.tool_used}
            </span>
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
          {entry.warnings && entry.warnings.length > 0 && (
            <div className="mt-2 p-2 bg-yellow-900/30 border border-yellow-700/50 rounded">
              <span className="text-yellow-400 font-bold">⚠ Warnings:</span>
              {entry.warnings.map((w, i) => (
                <div key={i} className="text-yellow-300 ml-2">• {w}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Center Panel ─────────────────────────────────────────────────────────────

function CenterPanel({ logs, connected, stats }) {
  const total = stats?.total_steps ?? logs.length;
  const halts = stats?.halt_count ?? logs.filter((l) => l.decision === "HALT").length;
  const proceeds = stats?.proceed_count ?? logs.filter((l) => l.decision === "PROCEED").length;
  const violationRate = total > 0 ? ((halts / total) * 100).toFixed(1) : "0.0";

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden min-w-0">
      <div className="grid grid-cols-4 gap-3 p-4 border-b border-slate-700/50 bg-slate-900/50">
        {[
          { label: "Total Steps",     value: total,           color: "text-slate-200",  icon: <Activity className="w-4 h-4 text-cyan-400" />      },
          { label: "HALTs",           value: halts,           color: "text-red-400",    icon: <XCircle className="w-4 h-4 text-red-400" />         },
          { label: "Proceeds",        value: proceeds,        color: "text-emerald-400",icon: <CheckCircle className="w-4 h-4 text-emerald-400" /> },
          { label: "Violation Rate",  value: `${violationRate}%`, color: "text-yellow-400", icon: <AlertTriangle className="w-4 h-4 text-yellow-400" /> },
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
            <><WifiOff className="w-3.5 h-3.5 text-yellow-400" /><span className="text-yellow-400 text-xs font-mono">demo mode</span></>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <RefreshCw className="w-8 h-8 mb-3 opacity-50" />
            <p className="text-sm font-mono">Waiting for agent telemetry...</p>
            <p className="text-xs mt-1 opacity-70">Run showcase_demo.py to see live data</p>
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

function ReasoningGraph({ agentGraph, selectedAgent }) {
  const [tooltip, setTooltip] = useState(null);

  // If no agent selected, show prompt
  if (!selectedAgent || !agentGraph || !agentGraph.nodes || agentGraph.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-xs font-mono text-center px-4">
        {selectedAgent ? "No steps recorded yet" : "Click an agent to view its reasoning path"}
      </div>
    );
  }

  // Map graph nodes to visual positions (vertical flow)
  const graphNodes = agentGraph.nodes.slice(0, 10).map((node, i) => ({
    id: node.id,
    x: 140,
    y: 30 + i * 55,
    decision: node.decision,
    thought: node.thought,
    tool: node.tool_used,
    stepNum: i + 1,
  }));

  // Create edges from the graph data or sequential order
  const graphEdges = graphNodes.slice(1).map((node, i) => ({
    from: graphNodes[i],
    to: node,
  }));

  const viewHeight = Math.max(320, graphNodes.length * 55 + 40);

  return (
    <div className="relative">
      <svg width="100%" viewBox={`0 0 280 ${viewHeight}`} className="overflow-visible">
        <defs>
          <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
            <polygon points="0 0, 6 2, 0 4" fill="#06b6d4" />
          </marker>
        </defs>
        {graphEdges.map((edge, i) => (
          <line key={i} x1={edge.from.x} y1={edge.from.y + 14} x2={edge.to.x} y2={edge.to.y - 14}
            stroke="#0e7490" strokeWidth="2" markerEnd="url(#arrowhead)" />
        ))}
        {graphNodes.map((node) => (
          <g key={node.id} onMouseEnter={() => setTooltip(node)} onMouseLeave={() => setTooltip(null)} style={{ cursor: "pointer" }}>
            <circle cx={node.x} cy={node.y} r={14}
              fill={node.decision === "PROCEED" ? "#064e3b" : "#450a0a"}
              stroke={node.decision === "PROCEED" ? "#10b981" : "#ef4444"}
              strokeWidth="2" />
            <text x={node.x} y={node.y + 1} textAnchor="middle" dominantBaseline="middle"
              fontSize="9" fontWeight="bold" fill={node.decision === "PROCEED" ? "#34d399" : "#f87171"} fontFamily="monospace">
              {node.stepNum}
            </text>
            <text x={node.x + 22} y={node.y + 1} dominantBaseline="middle"
              fontSize="8" fill="#94a3b8" fontFamily="monospace">
              {(node.tool || "").slice(0, 15)}
            </text>
          </g>
        ))}
      </svg>
      {tooltip && (
        <div className="absolute bottom-0 left-0 right-0 bg-slate-800 border border-slate-600/50 rounded p-2 text-xs font-mono text-slate-300 leading-snug">
          <div className="flex items-center gap-2 mb-1">
            <span className={`px-1.5 py-0.5 rounded text-xs ${tooltip.decision === "PROCEED" ? "bg-emerald-900/60 text-emerald-400" : "bg-red-900/60 text-red-400"}`}>
              Step {tooltip.stepNum}
            </span>
            <span className="text-cyan-400">{tooltip.tool}</span>
          </div>
          {(tooltip.thought || "").slice(0, 120)}{tooltip.thought?.length > 120 ? "…" : ""}
        </div>
      )}
    </div>
  );
}

// ─── Right Panel ──────────────────────────────────────────────────────────────

function RightPanel({ logs, stats, agentGraph, selectedAgent }) {
  // Build violation data with icons and colors
  const VIOLATION_META = {
    "POLICY_VIOLATION": { icon: "🚫", color: "text-red-400", bg: "bg-red-900/40", label: "Policy Violation" },
    "LOOP_DETECTED": { icon: "🔄", color: "text-orange-400", bg: "bg-orange-900/40", label: "Loop Detected" },
    "SAFETY_VIOLATION": { icon: "⚠️", color: "text-yellow-400", bg: "bg-yellow-900/40", label: "Safety Violation" },
    "FACT_CHECK_FAILED": { icon: "❌", color: "text-purple-400", bg: "bg-purple-900/40", label: "Fact Check Failed" },
    "MANUAL_OVERRIDE": { icon: "🛑", color: "text-pink-400", bg: "bg-pink-900/40", label: "Manual Override" },
  };

  // If agent selected, count violations from their graph; otherwise use global stats
  let violationsSource = {};
  if (selectedAgent && agentGraph && agentGraph.nodes) {
    // Count violations for this specific agent
    agentGraph.nodes.forEach((n) => {
      if (n.decision === "HALT" && n.reason) {
        violationsSource[n.reason] = (violationsSource[n.reason] || 0) + 1;
      }
    });
  } else {
    violationsSource = stats?.violations_by_type || {};
  }
  const totalViolations = Object.values(violationsSource).reduce((a, b) => a + b, 0);

  const violationList = Object.entries(violationsSource)
    .map(([key, count]) => ({
      key,
      count,
      pct: totalViolations > 0 ? Math.round((count / totalViolations) * 100) : 0,
      ...(VIOLATION_META[key] || { icon: "❓", color: "text-slate-400", bg: "bg-slate-800", label: key.replace(/_/g, " ") })
    }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="w-80 flex-shrink-0 bg-slate-900 border-l border-slate-700/50 flex flex-col h-screen overflow-hidden">
      <div className="border-b border-slate-700/50 p-4 flex-1 overflow-hidden flex flex-col">
        <h3 className="text-slate-300 font-medium text-sm mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          Reasoning Graph
          {selectedAgent && <span className="text-cyan-400 text-xs font-mono ml-auto">{selectedAgent}</span>}
        </h3>
        <div className="flex-1 relative">
          <ReasoningGraph agentGraph={agentGraph} selectedAgent={selectedAgent} />
        </div>
      </div>

      <div className="p-4">
        <h3 className="text-slate-300 font-medium text-sm mb-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-yellow-400" />
          {selectedAgent ? "Agent Violations" : "All Violations"}
          {totalViolations > 0 && <span className="ml-auto text-xs font-mono text-slate-500">{totalViolations} total</span>}
        </h3>
        {violationList.length > 0 ? (
          <div className="space-y-2">
            {violationList.map((v) => (
              <div key={v.key} className={`${v.bg} rounded p-2.5 border border-slate-700/30`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-base">{v.icon}</span>
                  <span className={`text-xs font-medium ${v.color}`}>{v.label}</span>
                  <span className="ml-auto text-sm font-bold font-mono text-white">{v.count}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${v.color.replace('text-', 'bg-')}`}
                      style={{ width: `${v.pct}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono text-slate-400">{v.pct}%</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-slate-600 text-xs font-mono text-center py-8 border border-dashed border-slate-700 rounded">
            ✅ No violations detected
          </div>
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

// Friendly names for agent IDs (populated by the backend's agent_id field)
const AGENT_NAMES = {
  "agent-001": "TradeBot Alpha",
  "agent-002": "RiskGuard Beta",
  "agent-003": "RecoEngine v2",
  "agent-004": "MarketScanner",
  "agent-005": "ComplianceBot",
  "agent-006": "SentimentAI",
  "agent-007": "ArbitrageX",
  "agent-008": "ReportGen Pro",
};

export default function AgentWatchDashboard() {
  const [agents, setAgents] = useState([]);
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [connected, setConnected] = useState(false);
  const [mockMode, setMockMode] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [agentGraph, setAgentGraph] = useState(null);
  const localHalted = useRef(new Set());
  const seenIds = useRef(new Set());
  const mockIntervalRef = useRef(null);

  // ── Bootstrap: try real backend, fall back to mock ──
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        // Try fetching agents + recent decisions
        const [agentsData, recentData, statsData] = await Promise.all([
          apiFetch("/agents"),
          apiFetch("/recent?limit=30"),
          apiFetch("/stats"),
        ]);

        if (cancelled) return;

        // Map backend agents to UI shape
        const backendAgents = (agentsData.agents || []).map((a) => ({
          ...a,
          name: AGENT_NAMES[a.agent_id] || a.agent_id,
          status: localHalted.current.has(a.agent_id) ? "HALTED" : (a.halt_count > 2 ? "WARNING" : "RUNNING"),
          lastDecision: a.halt_count > 0 ? "HALT" : "PROCEED",
        }));

        const decisions = (recentData.decisions || []).map((d) => ({ ...d, isNew: false }));
        decisions.forEach((d) => seenIds.current.add(d.id || `${d.agent_id}-${d.step_id}`));

        // Connected to backend - use real data (even if empty)
        setAgents(backendAgents);
        setLogs(decisions);
        setStats(statsData);
        setConnected(true);
        setMockMode(false);  // Never mock when backend is connected
      } catch {
        if (cancelled) return;
        // Backend unreachable — full mock mode
        setAgents(MOCK_AGENTS);
        setLogs(generateMockLogs());
        setConnected(false);
        setMockMode(true);
      }
    }

    bootstrap();
    return () => { cancelled = true; };
  }, []);

  // ── Live polling: /recent + /stats every 3s (real backend) ──
  useEffect(() => {
    if (mockMode) return; // handled by mock interval below

    const interval = setInterval(async () => {
      try {
        const [recentData, statsData, agentsData] = await Promise.all([
          apiFetch("/recent?limit=30"),
          apiFetch("/stats"),
          apiFetch("/agents"),
        ]);

        setConnected(true);
        setStats(statsData);

        // Update agents from backend
        const backendAgents = (agentsData.agents || []).map((a) => ({
          ...a,
          name: AGENT_NAMES[a.agent_id] || a.agent_id,
          status: localHalted.current.has(a.agent_id) ? "HALTED" : (a.halt_count > 2 ? "WARNING" : "RUNNING"),
          lastDecision: a.halt_count > 0 ? "HALT" : "PROCEED",
        }));
        if (backendAgents.length > 0) setAgents(backendAgents);

        // Find genuinely new entries
        const newEntries = (recentData.decisions || [])
          .filter((d) => {
            const uid = d.id || `${d.agent_id}-${d.step_id}`;
            return !seenIds.current.has(uid);
          })
          .map((d) => {
            const uid = d.id || `${d.agent_id}-${d.step_id}`;
            seenIds.current.add(uid);
            return { ...d, isNew: true };
          });

        if (newEntries.length > 0) {
          setLogs((prev) => {
            const updated = [...newEntries, ...prev].slice(0, 100);
            setTimeout(() => {
              setLogs((l) => l.map((e) => newEntries.some((n) => n.id === e.id) ? { ...e, isNew: false } : e));
            }, 1000);
            return updated;
          });
        }
      } catch {
        setConnected(false);
      }
    }, 1500);  // Poll every 1.5 seconds for snappier updates

    return () => clearInterval(interval);
  }, [mockMode]);

  // ── Mock interval: simulate events when backend is unreachable ──
  useEffect(() => {
    if (!mockMode) return;

    const interval = setInterval(() => {
      const runningAgents = MOCK_AGENTS.filter((a) => !localHalted.current.has(a.agent_id));
      if (!runningAgents.length) return;

      const agent = randomFrom(runningAgents);
      const entry = makeMockEntry(agent.agent_id);

      setLogs((prev) => {
        setTimeout(() => {
          setLogs((l) => l.map((e) => e.id === entry.id ? { ...e, isNew: false } : e));
        }, 1000);
        return [entry, ...prev].slice(0, 100);
      });
    }, randomInt(2000, 3000));

    mockIntervalRef.current = interval;
    return () => clearInterval(interval);
  }, [mockMode]);

  // ── Stop handler ──
  const handleStop = useCallback(async (agentId) => {
    localHalted.current.add(agentId);

    setAgents((prev) =>
      prev.map((a) => a.agent_id === agentId ? { ...a, status: "HALTED", lastDecision: "HALT" } : a)
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
    setLogs((prev) => {
      setTimeout(() => {
        setLogs((l) => l.map((e) => e.id === manualEntry.id ? { ...e, isNew: false } : e));
      }, 1000);
      return [manualEntry, ...prev];
    });

    try {
      await fetch(`${API}/agent/${agentId}/halt`, { method: "POST" });
    } catch {
      // backend may not be running
    }
  }, []);

  // ── Select agent and fetch its reasoning graph ──
  const handleSelectAgent = useCallback(async (agentId) => {
    // Toggle off if clicking same agent
    if (selectedAgent === agentId) {
      setSelectedAgent(null);
      setAgentGraph(null);
      return;
    }

    setSelectedAgent(agentId);

    try {
      const graphData = await apiFetch(`/agent/${agentId}/graph`);
      setAgentGraph(graphData);
    } catch {
      // Fallback: build graph from logs for this agent
      const agentLogs = logs.filter((l) => l.agent_id === agentId);
      setAgentGraph({
        agent_id: agentId,
        nodes: agentLogs.map((l, i) => ({
          id: l.step_id || `step-${i}`,
          thought: l.thought,
          tool_used: l.tool_used,
          decision: l.decision,
        })),
        edges: [],
      });
    }
  }, [selectedAgent, logs]);

  // ── Auto-refresh graph for selected agent ──
  useEffect(() => {
    if (!selectedAgent || mockMode) return;

    const refreshGraph = async () => {
      try {
        const graphData = await apiFetch(`/agent/${selectedAgent}/graph`);
        setAgentGraph(graphData);
      } catch {
        // ignore errors during refresh
      }
    };

    const interval = setInterval(refreshGraph, 1000); // Refresh every 1 second
    return () => clearInterval(interval);
  }, [selectedAgent, mockMode]);

  return (
    <>
      <style>{styles}</style>
      <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
        <Sidebar agents={agents} onStop={handleStop} mockMode={mockMode} selectedAgent={selectedAgent} onSelectAgent={handleSelectAgent} />
        <CenterPanel logs={logs} connected={connected} stats={stats} />
        <RightPanel logs={logs} stats={stats} agentGraph={agentGraph} selectedAgent={selectedAgent} />
      </div>
    </>
  );
}
