"use client";

import React from "react";
import type { Appliance } from "@/lib/types";

/**
 * Animated smart-house scene driven purely by appliance state.
 * Nothing here is hard-coded: glow ∝ brightness, blade period ∝ 1/RPM,
 * AC air ∝ (26 − setpoint), heater coil ∝ wattage, geyser gauge = water temp.
 */
export const LiveHouseScene: React.FC<{
  appliances: Appliance[];
  selectedId?: string | null;
  onSelect?: (a: Appliance) => void;
  compact?: boolean;
}> = ({ appliances, selectedId, onSelect, compact }) => {
  const get = (id: string) => appliances.find((a) => a.id === id);
  const lamp = get("lamp_desk");
  const fan = get("fan_table");
  const ac = get("ac_living");
  const heater = get("heater_radiant");
  const geyser = get("geyser_bath");
  const bolt = get("door_deadbolt");

  const lampOn = lamp?.powerState === "ON";
  const bright = lampOn ? Math.max(0.15, (lamp?.brightness || 80) / 100) : 0;
  const fanOn = fan?.powerState === "ON" && (fan?.fanSpeed || 0) > 0;
  const rpm = fanOn ? fan?.airRpm || 680 : 0;
  const bladePeriodS = rpm > 0 ? Math.max(0.12, 60 / rpm) : 0; // one revolution per 60/rpm seconds
  const acOn = ac?.powerState === "ON";
  const acTemp = ac?.temperature ?? 24;
  const acStrength = acOn ? Math.min(1, Math.max(0.25, (26 - acTemp) / 8)) : 0;
  const heaterOn = heater?.powerState === "ON";
  const heaterGlow = heaterOn ? Math.min(1, (heater?.activeWattage || 2000) / 2000) : 0;
  const geyserOn = geyser?.powerState === "ON";
  const waterT = geyser?.temperature ?? 38;
  const locked = bolt ? bolt.powerState === "ON" : true;

  // room ambient light = lamp + a little from window; darker when off
  const ambient = 0.08 + bright * 0.55;

  const tile = (id: string, label: string, extra: string, on: boolean) => (
    <button
      key={id}
      onClick={() => {
        const a = get(id);
        if (a && onSelect) onSelect(a);
      }}
      className={`text-left px-2 py-1 rounded border text-[10px] font-mono transition-colors ${
        selectedId === id ? "border-cyan-500 bg-cyan-950/50 text-cyan-200" : "border-slate-800 bg-slate-950/70 text-slate-400 hover:border-slate-600"
      }`}
    >
      <span className={on ? "text-emerald-400" : "text-slate-500"}>●</span> {label} <span className="text-slate-500">{extra}</span>
    </button>
  );

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 shadow-lg">
      <style>{`
        @keyframes sg-blade { to { transform: rotate(360deg); } }
        @keyframes sg-air { 0% { transform: translateY(0); opacity: 0; } 20% { opacity: .9; } 100% { transform: translateY(70px); opacity: 0; } }
        @keyframes sg-heat { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
        @keyframes sg-steam { 0% { transform: translateY(0) scale(1); opacity: .0; } 30% { opacity: .7; } 100% { transform: translateY(-34px) scale(1.6); opacity: 0; } }
      `}</style>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-slate-200">Live House — physical state</h3>
        <span className="text-[10px] font-mono text-slate-500">
          {appliances.filter((a) => a.powerState === "ON").length} on ·{" "}
          {Math.round(appliances.reduce((s, a) => s + (a.powerState === "ON" ? a.activeWattage : 0), 0))} W
        </span>
      </div>

      <svg viewBox="0 0 640 300" className={`w-full ${compact ? "max-h-56" : "max-h-80"} rounded-lg border border-slate-800`} role="img" aria-label="Animated smart house">
        <defs>
          <radialGradient id="lampGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fde68a" stopOpacity={0.95 * bright} />
            <stop offset="45%" stopColor="#fbbf24" stopOpacity={0.45 * bright} />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="heatGlow" cx="50%" cy="60%" r="55%">
            <stop offset="0%" stopColor="#fb923c" stopOpacity={0.9 * heaterGlow} />
            <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="wall" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={`rgba(148,163,184,${ambient})`} />
            <stop offset="100%" stopColor={`rgba(30,41,59,${0.6 + ambient * 0.3})`} />
          </linearGradient>
        </defs>

        {/* room */}
        <rect x="0" y="0" width="640" height="300" fill="#020617" />
        <rect x="10" y="10" width="620" height="280" fill="url(#wall)" stroke="#334155" strokeWidth="2" />
        <rect x="10" y="230" width="620" height="60" fill={`rgba(71,85,105,${0.35 + ambient * 0.4})`} />
        {/* window */}
        <rect x="470" y="30" width="120" height="80" fill="#0f172a" stroke="#475569" />
        <line x1="530" y1="30" x2="530" y2="110" stroke="#475569" />
        <line x1="470" y1="70" x2="590" y2="70" stroke="#475569" />

        {/* ---- LAMP ---- */}
        <g transform="translate(90,150)" style={{ cursor: "pointer" }} onClick={() => lamp && onSelect?.(lamp)}>
          {lampOn && <circle cx="0" cy="-30" r={70 + bright * 40} fill="url(#lampGlow)" />}
          <rect x="-4" y="-10" width="8" height="70" fill="#64748b" />
          <ellipse cx="0" cy="62" rx="26" ry="6" fill="#475569" />
          <path d="M-34 -10 L34 -10 L22 -50 L-22 -50 Z" fill={lampOn ? "#fde68a" : "#334155"} stroke="#94a3b8" />
          <circle cx="0" cy="-30" r="8" fill={lampOn ? "#fef3c7" : "#1e293b"} />
          <text x="0" y="86" textAnchor="middle" fontSize="10" fill="#cbd5e1" fontFamily="monospace">
            Lamp {lampOn ? `${lamp?.brightness}%` : "OFF"}
          </text>
          {selectedId === "lamp_desk" && <rect x="-44" y="-62" width="88" height="140" fill="none" stroke="#22d3ee" strokeDasharray="4 3" />}
        </g>

        {/* ---- FAN ---- */}
        <g transform="translate(230,140)" style={{ cursor: "pointer" }} onClick={() => fan && onSelect?.(fan)}>
          <rect x="-4" y="30" width="8" height="50" fill="#64748b" />
          <ellipse cx="0" cy="82" rx="30" ry="6" fill="#475569" />
          <circle cx="0" cy="0" r="46" fill="none" stroke="#475569" strokeWidth="3" strokeDasharray="3 4" />
          <g style={fanOn ? { animation: `sg-blade ${bladePeriodS}s linear infinite`, transformOrigin: "0px 0px", transformBox: "fill-box" } : undefined}>
            {[0, 120, 240].map((a) => (
              <ellipse key={a} cx="0" cy="-22" rx="9" ry="24" fill={fanOn ? "#38bdf8" : "#334155"} opacity="0.9" transform={`rotate(${a})`} />
            ))}
            <circle cx="0" cy="0" r="7" fill="#e2e8f0" />
          </g>
          {fanOn && (
            <g>
              {[0, 1, 2, 3].map((i) => (
                <path key={i} d={`M${-30 + i * 20} 60 q 4 10 0 20`} stroke="#7dd3fc" strokeWidth="2" fill="none" opacity="0.7" style={{ animation: `sg-air ${1.6 - (fan?.fanSpeed || 1) * 0.25}s linear ${i * 0.3}s infinite` }} />
              ))}
            </g>
          )}
          <text x="0" y="104" textAnchor="middle" fontSize="10" fill="#cbd5e1" fontFamily="monospace">
            Fan {fanOn ? `S${fan?.fanSpeed} · ${rpm} rpm · ${fan?.airflowCfm} cfm` : "OFF"}
          </text>
          {selectedId === "fan_table" && <rect x="-54" y="-52" width="108" height="160" fill="none" stroke="#22d3ee" strokeDasharray="4 3" />}
        </g>

        {/* ---- AC ---- */}
        <g transform="translate(400,40)" style={{ cursor: "pointer" }} onClick={() => ac && onSelect?.(ac)}>
          <rect x="-55" y="0" width="110" height="34" rx="6" fill={acOn ? "#e2e8f0" : "#94a3b8"} stroke="#475569" />
          <rect x="-48" y="22" width="96" height="5" fill={acOn ? "#38bdf8" : "#64748b"} />
          <circle cx="44" cy="10" r="3" fill={acOn ? "#22c55e" : "#334155"} />
          {acOn && (
            <g>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <path key={i} d={`M${-40 + i * 16} 36 q -4 12 0 24 q 4 12 0 24`} stroke="#7dd3fc" strokeWidth="2" fill="none" opacity={0.3 + acStrength * 0.6} style={{ animation: `sg-air ${2.2 - acStrength}s linear ${i * 0.25}s infinite` }} />
              ))}
            </g>
          )}
          <text x="0" y="-8" textAnchor="middle" fontSize="10" fill="#cbd5e1" fontFamily="monospace">
            AC {acOn ? `${acTemp}°C · ${Math.round(ac?.activeWattage || 0)} W` : "OFF"}
          </text>
          {selectedId === "ac_living" && <rect x="-62" y="-20" width="124" height="100" fill="none" stroke="#22d3ee" strokeDasharray="4 3" />}
        </g>

        {/* ---- HEATER (R2) ---- */}
        <g transform="translate(400,200)" style={{ cursor: "pointer" }} onClick={() => heater && onSelect?.(heater)}>
          {heaterOn && <ellipse cx="0" cy="10" rx="70" ry="50" fill="url(#heatGlow)" style={{ animation: "sg-heat 1.4s ease-in-out infinite" }} />}
          <rect x="-40" y="-10" width="80" height="50" rx="4" fill="#1e293b" stroke="#64748b" />
          {[0, 1, 2].map((i) => (
            <rect key={i} x="-32" y={-2 + i * 13} width="64" height="6" rx="3" fill={heaterOn ? "#f97316" : "#334155"} style={heaterOn ? { animation: `sg-heat ${1 + i * 0.2}s ease-in-out infinite` } : undefined} />
          ))}
          <text x="0" y="58" textAnchor="middle" fontSize="10" fill={heaterOn ? "#fdba74" : "#cbd5e1"} fontFamily="monospace">
            Heater {heaterOn ? `${heater?.activeWattage} W · R2 ARMED` : "OFF · R2"}
          </text>
          {selectedId === "heater_radiant" && <rect x="-50" y="-20" width="100" height="90" fill="none" stroke="#22d3ee" strokeDasharray="4 3" />}
        </g>

        {/* ---- GEYSER (R2) ---- */}
        <g transform="translate(560,190)" style={{ cursor: "pointer" }} onClick={() => geyser && onSelect?.(geyser)}>
          <rect x="-22" y="-40" width="44" height="80" rx="12" fill="#e2e8f0" stroke="#64748b" />
          <rect x="-16" y={-34 + (1 - Math.min(1, Math.max(0, (waterT - 20) / 50))) * 64} width="32" height={Math.min(1, Math.max(0, (waterT - 20) / 50)) * 64} rx="6" fill={geyserOn ? "#f87171" : "#60a5fa"} opacity="0.75" />
          {geyserOn && [0, 1, 2].map((i) => (
            <circle key={i} cx={-8 + i * 8} cy="-44" r="4" fill="#e2e8f0" style={{ animation: `sg-steam 1.8s ease-out ${i * 0.5}s infinite` }} />
          ))}
          <text x="0" y="56" textAnchor="middle" fontSize="10" fill="#cbd5e1" fontFamily="monospace">
            Geyser {waterT.toFixed(0)}°C {geyserOn ? "HEATING" : ""}
          </text>
          {selectedId === "geyser_bath" && <rect x="-30" y="-50" width="60" height="112" fill="none" stroke="#22d3ee" strokeDasharray="4 3" />}
        </g>

        {/* ---- DEADBOLT (R2) ---- */}
        <g transform="translate(600,130)" style={{ cursor: "pointer" }} onClick={() => bolt && onSelect?.(bolt)}>
          <rect x="-14" y="-40" width="28" height="80" fill="#3f3f46" stroke="#71717a" />
          <rect x={locked ? -10 : -24} y="-6" width="20" height="12" rx="2" fill={locked ? "#22c55e" : "#f43f5e"} style={{ transition: "x .4s" }} />
          <text x="0" y="56" textAnchor="middle" fontSize="10" fill={locked ? "#86efac" : "#fda4af"} fontFamily="monospace">
            {locked ? "LOCKED" : "UNLATCHED"}
          </text>
        </g>

        {/* ambient readout */}
        <text x="20" y="28" fontSize="10" fill="#94a3b8" fontFamily="monospace">
          room light {(ambient * 100).toFixed(0)}% · lux {lampOn ? Math.round(bright * 320) : 0}
        </text>
      </svg>

      <div className="mt-2 grid grid-cols-3 md:grid-cols-6 gap-1">
        {tile("lamp_desk", "Lamp", lampOn ? `${lamp?.brightness}%` : "off", !!lampOn)}
        {tile("fan_table", "Fan", fanOn ? `S${fan?.fanSpeed}` : "off", !!fanOn)}
        {tile("ac_living", "AC", acOn ? `${acTemp}°` : "off", !!acOn)}
        {tile("heater_radiant", "Heater", heaterOn ? "ON" : "off", !!heaterOn)}
        {tile("geyser_bath", "Geyser", `${waterT.toFixed(0)}°`, !!geyserOn)}
        {tile("door_deadbolt", "Bolt", locked ? "locked" : "open", locked)}
      </div>
    </div>
  );
};
