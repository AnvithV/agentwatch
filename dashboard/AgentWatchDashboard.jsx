import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Square,
  Play,
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
  Settings,
  Plus,
  X,
  DollarSign,
  TrendingUp,
  Lock,
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

function Sidebar({ agents, onStop, onResume, mockMode, selectedAgent, onSelectAgent, haltedAgents }) {
  const total = agents.length;
  const active = agents.filter((a) => a.status === "RUNNING").length;
  const halted = agents.filter((a) => a.status === "HALTED").length;
  const globalStatus = halted > 0 ? "HALTED" : "RUNNING";

  return (
    <div className="w-64 flex-shrink-0 bg-slate-900 border-r border-slate-700/50 flex flex-col h-screen overflow-hidden">
      <div className="px-4 py-4 border-b border-slate-700/50">
        <div className="flex items-center gap-2.5 mb-1">
          <Shield className="w-5 h-5 text-cyan-400" />
          <span className="text-white font-bold tracking-tight text-lg">Argus</span>
          <span className={`ml-auto w-2.5 h-2.5 rounded-full flex-shrink-0 ${globalStatus === "RUNNING" ? "bg-emerald-400 animate-pulse" : "bg-red-500"}`} />
        </div>
        <p className="text-slate-500 text-xs font-mono flex items-center gap-1">
          hundred-eyed oversight
          {mockMode && <span className="text-yellow-500 ml-1">[demo]</span>}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {agents.map((agent) => {
          const isHalted = agent.status === "HALTED" || haltedAgents.has(agent.agent_id);
          return (
            <div
              key={agent.agent_id}
              onClick={() => onSelectAgent && onSelectAgent(agent.agent_id)}
              className={`px-3 py-2.5 mx-2 mb-1 rounded border transition-colors cursor-pointer ${
                selectedAgent === agent.agent_id
                  ? "bg-cyan-950/50 border-cyan-500/60 ring-1 ring-cyan-500/30"
                  : isHalted
                  ? "bg-red-950/40 border-red-700/40 hover:border-red-600/60"
                  : "bg-slate-800/40 border-slate-700/20 hover:border-slate-600/50"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <StatusDot status={isHalted ? "HALTED" : agent.status} />
                <span className="text-slate-200 text-sm font-medium truncate flex-1">{agent.name}</span>
                {isHalted ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); onResume(agent.agent_id); }}
                    title="Resume agent"
                    className="text-slate-500 hover:text-emerald-400 transition-colors p-0.5 rounded hover:bg-emerald-950/50"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); onStop(agent.agent_id); }}
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
          );
        })}
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
  // Only show warnings on PROCEED decisions - warnings on HALT are irrelevant
  const hasWarnings = !isHalt && entry.warnings && entry.warnings.length > 0;

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
          {!isHalt && entry.warnings && entry.warnings.length > 0 && (
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
            <><Wifi className="w-3.5 h-3.5 text-emerald-400" /><span className="text-emerald-400 text-xs font-mono">websocket</span></>
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

  // Combine agent nodes with cross-agent nodes
  const crossAgentNodes = agentGraph.cross_agent_nodes || [];
  const influences = agentGraph.influences || [];
  const hasCrossAgent = crossAgentNodes.length > 0 || influences.length > 0;

  // For cross-agent chains, build a chain-ordered layout
  // Group nodes by agent and determine chain order
  const mainNodes = agentGraph.nodes.slice(0, 6);
  const externalNodes = crossAgentNodes;

  // Build chain order from influences (who influences whom)
  const agentOrder = [];
  const agentSteps = {};

  // Collect all agents and their steps
  agentSteps[selectedAgent] = mainNodes;
  externalNodes.forEach((n) => {
    if (!agentSteps[n.agent_id]) agentSteps[n.agent_id] = [];
    agentSteps[n.agent_id].push(n);
  });

  // Determine chain order based on influences
  if (hasCrossAgent && influences.length > 0) {
    const upstream = new Set();
    const downstream = new Set();

    influences.forEach((inf) => {
      if (inf.target_agent === selectedAgent) {
        upstream.add(inf.source_agent);
      } else if (inf.source_agent === selectedAgent) {
        downstream.add(inf.target_agent);
      } else {
        // Transitive: check if source is upstream of someone upstream
        if ([...upstream].some(u => inf.target_agent === u)) {
          upstream.add(inf.source_agent);
        }
        if ([...downstream].some(d => inf.source_agent === d)) {
          downstream.add(inf.target_agent);
        }
      }
    });

    // Order: upstream agents first, then selected, then downstream
    [...upstream].forEach((a) => agentOrder.push(a));
    agentOrder.push(selectedAgent);
    [...downstream].forEach((a) => agentOrder.push(a));
  } else {
    agentOrder.push(selectedAgent);
  }

  // Position nodes in chain layout (diagonal flow)
  const allGraphNodes = [];
  const chainSpacing = 75;
  const nodeSpacing = 45;

  agentOrder.forEach((agentId, chainIdx) => {
    const steps = agentSteps[agentId] || [];
    const isMain = agentId === selectedAgent;
    const xBase = 50 + chainIdx * chainSpacing;

    steps.slice(0, 3).forEach((node, stepIdx) => {
      allGraphNodes.push({
        id: node.id,
        agent_id: agentId,
        x: xBase,
        y: 40 + chainIdx * 30 + stepIdx * nodeSpacing,
        decision: node.decision,
        thought: node.thought,
        tool: node.tool_used,
        stepNum: isMain ? stepIdx + 1 : agentId.split("-")[0].slice(0, 3).toUpperCase(),
        isExternal: !isMain,
        isMain: isMain,
      });
    });
  });

  // Build lookup
  const nodeById = Object.fromEntries(allGraphNodes.map((n) => [n.id, n]));
  const mainAgentNodes = allGraphNodes.filter((n) => n.isMain);

  // Create NEXT edges (internal flow for main agent)
  const nextEdges = mainAgentNodes.slice(1).map((node, i) => ({
    from: mainAgentNodes[i],
    to: node,
    type: "NEXT",
  }));

  // Create INFLUENCES edges (cross-agent)
  const influenceEdges = influences
    .map((inf) => {
      const from = nodeById[inf.source];
      const to = nodeById[inf.target];
      if (from && to) {
        return { from, to, type: "INFLUENCES" };
      }
      return null;
    })
    .filter(Boolean);

  const allEdges = [...nextEdges, ...influenceEdges];

  const maxY = Math.max(...allGraphNodes.map((n) => n.y), 100);
  const maxX = Math.max(...allGraphNodes.map((n) => n.x), 200);
  const viewHeight = Math.max(280, maxY + 80);
  const viewWidth = Math.max(280, maxX + 80);

  return (
    <div className="relative">
      {hasCrossAgent && (
        <div className="absolute top-0 right-0 text-xs font-mono px-1.5 py-0.5 bg-purple-900/50 text-purple-300 rounded border border-purple-700/50">
          cross-agent
        </div>
      )}
      <svg width="100%" viewBox={`0 0 ${viewWidth} ${viewHeight}`} className="overflow-visible">
        <defs>
          <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
            <polygon points="0 0, 6 2, 0 4" fill="#06b6d4" />
          </marker>
          <marker id="arrowhead-purple" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
            <polygon points="0 0, 6 2, 0 4" fill="#a855f7" />
          </marker>
        </defs>
        {/* Draw edges */}
        {allEdges.map((edge, i) => {
          const isInfluence = edge.type === "INFLUENCES";
          // Calculate line endpoints
          const x1 = edge.from.x;
          const y1 = edge.from.y + 14;
          const x2 = edge.to.x;
          const y2 = edge.to.y - 14;

          if (isInfluence) {
            // Curved line for INFLUENCES edges
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            const controlX = midX + (x2 > x1 ? -30 : 30);
            return (
              <path
                key={`inf-${i}`}
                d={`M ${x1} ${y1} Q ${controlX} ${midY} ${x2} ${y2}`}
                stroke="#a855f7"
                strokeWidth="2"
                strokeDasharray="4 2"
                fill="none"
                markerEnd="url(#arrowhead-purple)"
              />
            );
          } else {
            return (
              <line
                key={`next-${i}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#0e7490"
                strokeWidth="2"
                markerEnd="url(#arrowhead)"
              />
            );
          }
        })}
        {/* Draw nodes */}
        {allGraphNodes.map((node) => {
          const isExternal = node.isExternal;
          const nodeColor = isExternal
            ? { fill: "#4c1d95", stroke: "#a855f7", text: "#c4b5fd" }
            : node.decision === "PROCEED"
            ? { fill: "#064e3b", stroke: "#10b981", text: "#34d399" }
            : { fill: "#450a0a", stroke: "#ef4444", text: "#f87171" };

          return (
            <g
              key={node.id}
              onMouseEnter={() => setTooltip(node)}
              onMouseLeave={() => setTooltip(null)}
              style={{ cursor: "pointer" }}
            >
              {/* Node circle */}
              <circle
                cx={node.x}
                cy={node.y}
                r={isExternal ? 12 : 14}
                fill={nodeColor.fill}
                stroke={nodeColor.stroke}
                strokeWidth="2"
                strokeDasharray={isExternal ? "3 2" : "none"}
              />
              {/* Step number */}
              <text
                x={node.x}
                y={node.y + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={isExternal ? "7" : "9"}
                fontWeight="bold"
                fill={nodeColor.text}
                fontFamily="monospace"
              >
                {node.stepNum}
              </text>
              {/* Tool label */}
              <text
                x={isExternal ? node.x - 20 : node.x + 22}
                y={node.y + 1}
                textAnchor={isExternal ? "end" : "start"}
                dominantBaseline="middle"
                fontSize="7"
                fill={isExternal ? "#a78bfa" : "#94a3b8"}
                fontFamily="monospace"
              >
                {isExternal
                  ? (node.agent_id || "").slice(0, 10)
                  : (node.tool || "").slice(0, 12)}
              </text>
            </g>
          );
        })}
      </svg>
      {/* Tooltip */}
      {tooltip && (
        <div className="absolute bottom-0 left-0 right-0 bg-slate-800 border border-slate-600/50 rounded p-2 text-xs font-mono text-slate-300 leading-snug">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className={`px-1.5 py-0.5 rounded text-xs ${
                tooltip.isExternal
                  ? "bg-purple-900/60 text-purple-300"
                  : tooltip.decision === "PROCEED"
                  ? "bg-emerald-900/60 text-emerald-400"
                  : "bg-red-900/60 text-red-400"
              }`}
            >
              {tooltip.isExternal ? `↗ ${tooltip.agent_id}` : `Step ${tooltip.stepNum}`}
            </span>
            <span className="text-cyan-400">{tooltip.tool}</span>
            {tooltip.isExternal && (
              <span className="text-purple-400 text-xs">INFLUENCES</span>
            )}
          </div>
          {(tooltip.thought || "").slice(0, 100)}
          {tooltip.thought?.length > 100 ? "…" : ""}
        </div>
      )}
      {/* Legend for cross-agent */}
      {hasCrossAgent && (
        <div className="mt-2 flex items-center gap-3 text-xs font-mono text-slate-500 justify-center">
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-cyan-600 inline-block"></span> flow
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-purple-500 inline-block" style={{ borderBottom: "2px dashed #a855f7" }}></span> influences
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Policy Editor ─────────────────────────────────────────────────────────────

function PolicyEditor({ policies, onUpdatePolicies, onAddTicker, onRemoveTicker }) {
  const [newTicker, setNewTicker] = useState("");
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetValue, setBudgetValue] = useState("");
  const [editingPosition, setEditingPosition] = useState(false);
  const [positionValue, setPositionValue] = useState("");

  if (!policies) {
    return (
      <div className="text-slate-500 text-xs font-mono text-center py-4">
        Loading policies...
      </div>
    );
  }

  const handleAddTicker = () => {
    if (newTicker.trim()) {
      onAddTicker(newTicker.trim().toUpperCase());
      setNewTicker("");
    }
  };

  const handleBudgetSave = () => {
    const val = parseInt(budgetValue.replace(/,/g, ""), 10);
    if (!isNaN(val) && val > 0) {
      onUpdatePolicies({ budget_limit: val });
    }
    setEditingBudget(false);
  };

  const handlePositionSave = () => {
    const val = parseInt(positionValue, 10);
    if (!isNaN(val) && val > 0) {
      onUpdatePolicies({ max_position_size: val });
    }
    setEditingPosition(false);
  };

  return (
    <div className="space-y-3">
      {/* Budget Limit */}
      <div className="bg-slate-800/50 rounded p-2.5 border border-slate-700/30">
        <div className="flex items-center gap-2 mb-2">
          <DollarSign className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-medium text-slate-300">Budget Limit</span>
        </div>
        {editingBudget ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={budgetValue}
              onChange={(e) => setBudgetValue(e.target.value)}
              className="flex-1 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm font-mono text-white focus:outline-none focus:border-cyan-500"
              placeholder="100000"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleBudgetSave()}
            />
            <button onClick={handleBudgetSave} className="text-emerald-400 hover:text-emerald-300 text-xs font-mono">Save</button>
            <button onClick={() => setEditingBudget(false)} className="text-slate-500 hover:text-slate-400 text-xs font-mono">Cancel</button>
          </div>
        ) : (
          <div
            onClick={() => { setBudgetValue(policies.budget_limit?.toString() || ""); setEditingBudget(true); }}
            className="text-xl font-bold font-mono text-emerald-400 cursor-pointer hover:text-emerald-300 transition-colors"
          >
            ${(policies.budget_limit || 0).toLocaleString()}
          </div>
        )}
      </div>

      {/* Max Position Size */}
      <div className="bg-slate-800/50 rounded p-2.5 border border-slate-700/30">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-medium text-slate-300">Max Position Size</span>
        </div>
        {editingPosition ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={positionValue}
              onChange={(e) => setPositionValue(e.target.value)}
              className="flex-1 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm font-mono text-white focus:outline-none focus:border-cyan-500"
              placeholder="1000"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handlePositionSave()}
            />
            <button onClick={handlePositionSave} className="text-emerald-400 hover:text-emerald-300 text-xs font-mono">Save</button>
            <button onClick={() => setEditingPosition(false)} className="text-slate-500 hover:text-slate-400 text-xs font-mono">Cancel</button>
          </div>
        ) : (
          <div
            onClick={() => { setPositionValue(policies.max_position_size?.toString() || ""); setEditingPosition(true); }}
            className="text-xl font-bold font-mono text-cyan-400 cursor-pointer hover:text-cyan-300 transition-colors"
          >
            {(policies.max_position_size || 0).toLocaleString()} shares
          </div>
        )}
      </div>

      {/* Restricted Tickers */}
      <div className="bg-slate-800/50 rounded p-2.5 border border-slate-700/30">
        <div className="flex items-center gap-2 mb-2">
          <Lock className="w-4 h-4 text-red-400" />
          <span className="text-xs font-medium text-slate-300">Restricted Tickers</span>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {(policies.restricted_tickers || []).map((ticker) => (
            <span
              key={ticker}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-900/50 text-red-400 text-xs font-mono border border-red-700/50"
            >
              {ticker}
              <button
                onClick={() => onRemoveTicker(ticker)}
                className="hover:text-red-300 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          {(policies.restricted_tickers || []).length === 0 && (
            <span className="text-slate-500 text-xs font-mono">No restrictions</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newTicker}
            onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
            className="flex-1 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
            placeholder="Add ticker (e.g., NVDA)"
            maxLength={5}
            onKeyDown={(e) => e.key === "Enter" && handleAddTicker()}
          />
          <button
            onClick={handleAddTicker}
            disabled={!newTicker.trim()}
            className="p-1 rounded bg-red-900/50 text-red-400 hover:bg-red-900/70 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Right Panel ──────────────────────────────────────────────────────────────

function RightPanel({ logs, stats, agentGraph, selectedAgent, policies, onUpdatePolicies, onAddTicker, onRemoveTicker }) {
  const [activeTab, setActiveTab] = useState("graph"); // "graph" or "policies"

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
      {/* Tab Headers */}
      <div className="flex border-b border-slate-700/50">
        <button
          onClick={() => setActiveTab("graph")}
          className={`flex-1 px-3 py-2.5 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
            activeTab === "graph"
              ? "text-cyan-400 border-b-2 border-cyan-400 bg-slate-800/30"
              : "text-slate-500 hover:text-slate-300"
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          Graph
        </button>
        <button
          onClick={() => setActiveTab("policies")}
          className={`flex-1 px-3 py-2.5 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors ${
            activeTab === "policies"
              ? "text-cyan-400 border-b-2 border-cyan-400 bg-slate-800/30"
              : "text-slate-500 hover:text-slate-300"
          }`}
        >
          <Settings className="w-3.5 h-3.5" />
          Policies
        </button>
      </div>

      {activeTab === "graph" ? (
        <>
          {/* Reasoning Graph */}
          <div className="border-b border-slate-700/50 p-4 flex-1 overflow-hidden flex flex-col">
            <h3 className="text-slate-300 font-medium text-sm mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              Reasoning Graph
              {selectedAgent && <span className="text-cyan-400 text-xs font-mono ml-auto">{selectedAgent}</span>}
            </h3>
            <div className="flex-1 relative overflow-y-auto">
              <ReasoningGraph agentGraph={agentGraph} selectedAgent={selectedAgent} />
            </div>
          </div>

          {/* Violations */}
          <div className="p-4 overflow-y-auto">
            <h3 className="text-slate-300 font-medium text-sm mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-400" />
              {selectedAgent ? "Agent Violations" : "All Violations"}
              {totalViolations > 0 && <span className="ml-auto text-xs font-mono text-slate-500">{totalViolations} total</span>}
            </h3>
            {selectedAgent && agentGraph && agentGraph.nodes ? (
              // Show detailed violations for selected agent
              (() => {
                const haltNodes = agentGraph.nodes.filter((n) => n.decision === "HALT");
                if (haltNodes.length === 0) {
                  return (
                    <div className="text-slate-600 text-xs font-mono text-center py-8 border border-dashed border-slate-700 rounded">
                      <span className="text-emerald-500">✓</span> No violations for this agent
                    </div>
                  );
                }
                return (
                  <div className="space-y-2">
                    {haltNodes.map((node, i) => {
                      const meta = VIOLATION_META[node.reason] || { icon: "❓", color: "text-slate-400", bg: "bg-slate-800", label: node.reason };
                      return (
                        <div key={node.id || i} className={`${meta.bg} rounded p-2.5 border border-slate-700/30`}>
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-base">{meta.icon}</span>
                            <span className={`text-xs font-medium ${meta.color}`}>{meta.label}</span>
                          </div>
                          <p className={`text-xs font-mono leading-relaxed mb-1 ${meta.color}`}>
                            {node.details || node.reason || "Policy violation"}
                          </p>
                          {node.thought && (
                            <p className="text-slate-500 text-xs font-mono">
                              Agent: {node.thought?.slice(0, 60)}{node.thought?.length > 60 ? "..." : ""}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()
            ) : violationList.length > 0 ? (
              // Show summary for all agents
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
                No violations detected
              </div>
            )}
          </div>
        </>
      ) : (
        /* Policy Editor Tab */
        <div className="p-4 flex-1 overflow-y-auto">
          <h3 className="text-slate-300 font-medium text-sm mb-4 flex items-center gap-2">
            <Settings className="w-4 h-4 text-cyan-400" />
            Live Policy Editor
          </h3>
          <PolicyEditor
            policies={policies}
            onUpdatePolicies={onUpdatePolicies}
            onAddTicker={onAddTicker}
            onRemoveTicker={onRemoveTicker}
          />
          <div className="mt-4 p-2 bg-slate-800/30 rounded border border-slate-700/30">
            <p className="text-slate-500 text-xs font-mono leading-relaxed">
              Changes take effect immediately. Try adding NVDA to restricted list and watch it get blocked in the demo.
            </p>
          </div>
        </div>
      )}
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
  const [policies, setPolicies] = useState(null);
  const [haltedAgents, setHaltedAgents] = useState(new Set());
  const [wsConnected, setWsConnected] = useState(false);
  const localHalted = useRef(new Set());
  const seenIds = useRef(new Set());
  const mockIntervalRef = useRef(null);
  const wsRef = useRef(null);

  // ── Bootstrap: try real backend, fall back to mock ──
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        // Try fetching agents + recent decisions + policies
        const [agentsData, recentData, statsData, policiesData, haltedData] = await Promise.all([
          apiFetch("/agents"),
          apiFetch("/recent?limit=30"),
          apiFetch("/stats"),
          apiFetch("/policies"),
          apiFetch("/halted"),
        ]);

        if (cancelled) return;

        // Set halted agents from backend
        setHaltedAgents(new Set(haltedData.halted_agents || []));
        haltedData.halted_agents?.forEach((id) => localHalted.current.add(id));

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
        setPolicies(policiesData.policies || null);
        setConnected(true);
        setMockMode(false);  // Never mock when backend is connected
      } catch {
        if (cancelled) return;
        // Backend unreachable — full mock mode
        setAgents(MOCK_AGENTS);
        setLogs(generateMockLogs());
        setPolicies({
          budget_limit: 100000,
          restricted_tickers: ["GME", "AMC", "BBBY"],
          max_position_size: 1000,
          allowed_actions: ["BUY", "SELL", "HOLD", "RESEARCH"],
        });
        setConnected(false);
        setMockMode(true);
      }
    }

    bootstrap();
    return () => { cancelled = true; };
  }, []);

  // ── Fallback polling: only when WebSocket is NOT connected ──
  // WebSocket is preferred for real-time updates; polling is backup only
  useEffect(() => {
    if (mockMode || wsConnected) return; // WebSocket handles updates when connected

    const interval = setInterval(async () => {
      if (wsConnected) return; // Double-check WebSocket isn't connected

      try {
        const [recentData, statsData, agentsData] = await Promise.all([
          apiFetch("/recent?limit=30"),
          apiFetch("/stats"),
          apiFetch("/agents"),
        ]);

        setConnected(true);
        setStats(statsData);

        // Update agents from backend (always update, even if empty after reset)
        const backendAgents = (agentsData.agents || []).map((a) => ({
          ...a,
          name: AGENT_NAMES[a.agent_id] || a.agent_id,
          status: localHalted.current.has(a.agent_id) ? "HALTED" : (a.halt_count > 2 ? "WARNING" : "RUNNING"),
          lastDecision: a.halt_count > 0 ? "HALT" : "PROCEED",
        }));
        setAgents(backendAgents);

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
    }, 2000);  // Poll every 2 seconds as fallback

    return () => clearInterval(interval);
  }, [mockMode, wsConnected]);

  // ── WebSocket connection for real-time updates ──
  useEffect(() => {
    if (mockMode) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    function connectWebSocket() {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[WebSocket] Connected");
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === "decision") {
            const decision = msg.data;
            const uid = decision.id || `${decision.agent_id}-${decision.step_id}`;

            // Deduplicate - only process if we haven't seen this decision
            if (seenIds.current.has(uid)) {
              return; // Skip duplicate
            }
            seenIds.current.add(uid);

            // Add to logs
            setLogs((prev) => {
              const updated = [{ ...decision, isNew: true }, ...prev].slice(0, 100);
              setTimeout(() => {
                setLogs((l) => l.map((e) => (e.id === uid || e.id === decision.id) ? { ...e, isNew: false } : e));
              }, 1000);
              return updated;
            });

            // Update stats (only for non-duplicates)
            setStats((prev) => {
              if (!prev) prev = { total_steps: 0, halt_count: 0, proceed_count: 0, violations_by_type: {} };
              const updated = { ...prev };
              updated.total_steps = (updated.total_steps || 0) + 1;
              if (decision.decision === "HALT") {
                updated.halt_count = (updated.halt_count || 0) + 1;
                const reason = decision.reason || "UNKNOWN";
                updated.violations_by_type = { ...updated.violations_by_type };
                updated.violations_by_type[reason] = (updated.violations_by_type[reason] || 0) + 1;
              } else {
                updated.proceed_count = (updated.proceed_count || 0) + 1;
              }
              return updated;
            });

            // Update or add agent (only for non-duplicates)
            setAgents((prev) => {
              const agentId = decision.agent_id;
              const existing = prev.find((a) => a.agent_id === agentId);
              if (existing) {
                return prev.map((a) => a.agent_id === agentId ? {
                  ...a,
                  total_steps: (a.total_steps || 0) + 1,
                  halt_count: decision.decision === "HALT" ? (a.halt_count || 0) + 1 : a.halt_count,
                  lastDecision: decision.decision,
                } : a);
              } else {
                return [...prev, {
                  agent_id: agentId,
                  name: AGENT_NAMES[agentId] || agentId,
                  total_steps: 1,
                  halt_count: decision.decision === "HALT" ? 1 : 0,
                  status: "RUNNING",
                  lastDecision: decision.decision,
                }];
              }
            });
          } else if (msg.type === "policy_update") {
            setPolicies(msg.data.policies);
          } else if (msg.type === "agent_status") {
            setHaltedAgents(new Set(msg.data.halted_agents || []));
            msg.data.halted_agents?.forEach((id) => localHalted.current.add(id));
            if (msg.data.status === "resumed") {
              localHalted.current.delete(msg.data.agent_id);
            }
          } else if (msg.type === "reset") {
            // Clear everything for fresh start
            setAgents([]);
            setLogs([]);
            setStats({ total_steps: 0, halt_count: 0, proceed_count: 0, violations_by_type: {} });
            setSelectedAgent(null);
            setAgentGraph(null);
            setHaltedAgents(new Set());
            localHalted.current.clear();
            seenIds.current.clear();
            console.log("[WebSocket] Reset received - dashboard cleared");
          }
        } catch (err) {
          console.error("[WebSocket] Parse error:", err);
        }
      };

      ws.onclose = () => {
        console.log("[WebSocket] Disconnected, reconnecting in 2s...");
        setWsConnected(false);
        setTimeout(connectWebSocket, 2000);
      };

      ws.onerror = (err) => {
        console.error("[WebSocket] Error:", err);
        ws.close();
      };
    }

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
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

  // ── Policy update handlers ──
  const handleUpdatePolicies = useCallback(async (update) => {
    try {
      const res = await fetch(`${API}/policies`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      if (res.ok) {
        const data = await res.json();
        setPolicies(data.current_policies);
      }
    } catch (err) {
      console.error("Failed to update policies:", err);
    }
  }, []);

  const handleAddTicker = useCallback(async (ticker) => {
    try {
      const res = await fetch(`${API}/policies/restricted-tickers/${ticker}`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setPolicies((prev) => prev ? { ...prev, restricted_tickers: data.restricted_tickers } : prev);
      }
    } catch (err) {
      console.error("Failed to add ticker:", err);
    }
  }, []);

  const handleRemoveTicker = useCallback(async (ticker) => {
    try {
      const res = await fetch(`${API}/policies/restricted-tickers/${ticker}`, { method: "DELETE" });
      if (res.ok) {
        const data = await res.json();
        setPolicies((prev) => prev ? { ...prev, restricted_tickers: data.restricted_tickers } : prev);
      }
    } catch (err) {
      console.error("Failed to remove ticker:", err);
    }
  }, []);

  // ── Stop handler ──
  const handleStop = useCallback(async (agentId) => {
    localHalted.current.add(agentId);
    setHaltedAgents((prev) => new Set([...prev, agentId]));

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
      thought: `Manual stop issued for ${agentId} via Argus dashboard.`,
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

  // ── Resume handler ──
  const handleResume = useCallback(async (agentId) => {
    localHalted.current.delete(agentId);
    setHaltedAgents((prev) => {
      const next = new Set(prev);
      next.delete(agentId);
      return next;
    });

    setAgents((prev) =>
      prev.map((a) => a.agent_id === agentId ? { ...a, status: "RUNNING" } : a)
    );

    try {
      await fetch(`${API}/agent/${agentId}/resume`, { method: "POST" });
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
          agent_id: agentId,
          thought: l.thought,
          tool_used: l.tool_used,
          decision: l.decision,
        })),
        edges: [],
        cross_agent_nodes: [],
        influences: [],
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
        <Sidebar
          agents={agents}
          onStop={handleStop}
          onResume={handleResume}
          mockMode={mockMode}
          selectedAgent={selectedAgent}
          onSelectAgent={handleSelectAgent}
          haltedAgents={haltedAgents}
        />
        <CenterPanel logs={logs} connected={connected || wsConnected} stats={stats} />
        <RightPanel
          logs={logs}
          stats={stats}
          agentGraph={agentGraph}
          selectedAgent={selectedAgent}
          policies={policies}
          onUpdatePolicies={handleUpdatePolicies}
          onAddTicker={handleAddTicker}
          onRemoveTicker={handleRemoveTicker}
        />
      </div>
    </>
  );
}
