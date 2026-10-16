"use client";

import React from "react";
import type { Appliance } from "@/lib/types";
import { APPLIANCE_DEFAULT_GESTURE_LABEL } from "@/lib/default-gesture-map";
import { Power, RefreshCw } from "lucide-react";

/**
 * Interactive Connected Smart-House Simulation Scene.
 * - Fixed SVG fan rotor using exact hub-centered <animateTransform from="0 0 0" to="360 0 0">
 *   (eliminating the CSS transform-box wobble glitch).
 * - Direct Turn ON / Turn OFF controls on every simulated appliance.
 * - Real-time visual state reflection for Lamp, Fan, AC, Blinds, TV, Heater, Geyser, and Deadbolt.
 */
export const LiveHouseScene: React.FC<{
  appliances: Appliance[];
  selectedId?: string | null;
  onSelect?: (a: Appliance) => void;
  onToggleAppliance?: (a: Appliance) => void;
  onStepFanSpeed?: (a: Appliance) => void;
  compact?: boolean;
}> = ({
  appliances,
  selectedId,
  onSelect,
  onToggleAppliance,
  onStepFanSpeed,
  compact,
}) => {
  const get = (id: string) => appliances.find((a) => a.id === id);
  const lamp = get("lamp_desk");
  const fan = get("fan_table");
  const ac = get("ac_living");
  const tv = get("tv_ambient");
  const blinds = get("blinds_window");
  const heater = get("heater_radiant");
  const geyser = get("geyser_bath");
  const bolt = get("door_deadbolt");

  const lampOn = lamp?.powerState === "ON";
  const bright = lampOn ? Math.max(0.2, (lamp?.brightness || 80) / 100) : 0;

  const fanSpeed = fan?.powerState === "ON" ? Math.max(1, fan?.fanSpeed || 2) : 0;
  const fanOn = fan?.powerState === "ON" && fanSpeed > 0;
  const rpm = fanOn ? fan?.airRpm || 420 + fanSpeed * 260 : 0;
  const bladePeriodS = rpm > 0 ? Math.max(0.18, Number((60 / rpm).toFixed(3))) : 0;

  const acOn = ac?.powerState === "ON";
  const acTemp = ac?.temperature ?? 22;
  const acStrength = acOn ? Math.min(1, Math.max(0.25, (26 - acTemp) / 8)) : 0;

  const tvOn = tv?.powerState === "ON";
  const blindsOpen = blinds?.powerState === "ON";

  const heaterOn = heater?.powerState === "ON";
  const heaterGlow = heaterOn ? Math.min(1, (heater?.activeWattage || 2000) / 2000) : 0;

  const geyserOn = geyser?.powerState === "ON";
  const waterT = geyser?.temperature ?? 38.5;
  const locked = bolt ? bolt.powerState === "ON" : true;

  const ambient = 0.1 + bright * 0.5 + (blindsOpen ? 0.15 : 0);

  const handleApplianceClick = (app: Appliance | undefined) => {
    if (!app) return;
    onSelect?.(app);
    onToggleAppliance?.(app);
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="text-xs font-bold text-slate-100 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            Interactive Smart House Simulation (Connected Live Twin)
          </h3>
          <p className="text-[11px] text-slate-400">
            Click any appliance in the house or use the power buttons below to turn it ON/OFF immediately, or hold its default gesture.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-mono text-cyan-300 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
          <span>{appliances.filter((a) => a.powerState === "ON").length} Active</span>
          <span>·</span>
          <span>
            {Math.round(
              appliances.reduce((s, a) => s + (a.powerState === "ON" ? a.activeWattage : 0), 0)
            )}{" "}
            W Total
          </span>
        </div>
      </div>

      <svg
        viewBox="0 0 680 300"
        className={`w-full ${compact ? "max-h-64" : "max-h-80"} rounded-lg border border-slate-800 bg-slate-950`}
        role="img"
        aria-label="Interactive animated smart house"
      >
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

        {/* Room background */}
        <rect x="0" y="0" width="680" height="300" fill="#020617" />
        <rect
          x="10"
          y="10"
          width="660"
          height="280"
          fill="url(#wall)"
          stroke="#334155"
          strokeWidth="2"
        />
        <rect
          x="10"
          y="232"
          width="660"
          height="58"
          fill={`rgba(51,65,85,${0.4 + ambient * 0.35})`}
        />

        {/* ---- WINDOW & MOTORIZED BLINDS ---- */}
        <g
          transform="translate(470, 26)"
          style={{ cursor: "pointer" }}
          onClick={() => handleApplianceClick(blinds)}
        >
          <rect
            x="0"
            y="0"
            width="110"
            height="72"
            fill={blindsOpen ? "#1e3a8a" : "#0f172a"}
            stroke="#475569"
            strokeWidth="2"
          />
          {blindsOpen ? (
            <>
              <rect x="4" y="4" width="102" height="10" fill="#6366f1" opacity="0.8" />
              <line x1="55" y1="0" x2="55" y2="72" stroke="#64748b" />
            </>
          ) : (
            [0, 1, 2, 3, 4].map((i) => (
              <rect
                key={i}
                x="4"
                y={6 + i * 13}
                width="102"
                height="9"
                fill="#334155"
                stroke="#475569"
              />
            ))
          )}
          <text
            x="55"
            y="86"
            textAnchor="middle"
            fontSize="10"
            fill={blindsOpen ? "#a5b4fc" : "#94a3b8"}
            fontFamily="monospace"
          >
            Blinds {blindsOpen ? "OPEN" : "CLOSED"}
          </text>
          {selectedId === "blinds_window" && (
            <rect
              x="-6"
              y="-6"
              width="122"
              height="98"
              fill="none"
              stroke="#22d3ee"
              strokeDasharray="4 3"
            />
          )}
        </g>

        {/* ---- STUDY READING LAMP ---- */}
        <g
          transform="translate(75, 152)"
          style={{ cursor: "pointer" }}
          onClick={() => handleApplianceClick(lamp)}
        >
          {lampOn && <circle cx="0" cy="-28" r={68 + bright * 36} fill="url(#lampGlow)" />}
          <rect x="-4" y="-10" width="8" height="68" fill="#64748b" />
          <ellipse cx="0" cy="60" rx="24" ry="6" fill="#475569" />
          <path
            d="M-32 -10 L32 -10 L20 -48 L-20 -48 Z"
            fill={lampOn ? "#fde68a" : "#334155"}
            stroke="#94a3b8"
          />
          <circle cx="0" cy="-28" r="8" fill={lampOn ? "#fef3c7" : "#1e293b"} />
          <text
            x="0"
            y="84"
            textAnchor="middle"
            fontSize="10"
            fill={lampOn ? "#fde68a" : "#cbd5e1"}
            fontFamily="monospace"
          >
            Lamp {lampOn ? `ON (${lamp?.brightness || 80}%)` : "OFF"}
          </text>
          {selectedId === "lamp_desk" && (
            <rect
              x="-42"
              y="-58"
              width="84"
              height="148"
              fill="none"
              stroke="#22d3ee"
              strokeDasharray="4 3"
            />
          )}
        </g>

        {/* ---- STUDY TURBO BREEZE FAN (Hub-Centered SVG Rotor Fix) ---- */}
        <g
          transform="translate(205, 138)"
          style={{ cursor: "pointer" }}
          onClick={() => handleApplianceClick(fan)}
        >
          {/* Stand & Base */}
          <rect x="-4" y="42" width="8" height="42" fill="#64748b" />
          <ellipse cx="0" cy="86" rx="28" ry="6" fill="#475569" />

          {/* Protective Outer Guard Cage */}
          <circle
            cx="0"
            cy="0"
            r="44"
            fill={fanOn ? "rgba(14, 116, 144, 0.16)" : "rgba(15, 23, 42, 0.5)"}
            stroke={fanOn ? "#38bdf8" : "#475569"}
            strokeWidth="2.5"
          />
          <circle
            cx="0"
            cy="0"
            r="36"
            fill="none"
            stroke="#334155"
            strokeWidth="1"
            strokeDasharray="3 3"
          />

          {/* Centered 4-Blade Rotor — Rotates strictly around (0, 0) */}
          <g>
            {fanOn && bladePeriodS > 0 && (
              <animateTransform
                attributeName="transform"
                attributeType="XML"
                type="rotate"
                from="0 0 0"
                to="360 0 0"
                dur={`${bladePeriodS}s`}
                repeatCount="indefinite"
              />
            )}
            {[0, 90, 180, 270].map((angle) => (
              <g key={angle} transform={`rotate(${angle} 0 0)`}>
                <path
                  d="M 0 -6 C 10 -14, 14 -32, 2 -38 C -8 -36, -10 -18, 0 -6 Z"
                  fill={fanOn ? "#38bdf8" : "#475569"}
                  opacity={fanOn ? "0.92" : "0.75"}
                />
              </g>
            ))}
            <circle cx="0" cy="0" r="8" fill={fanOn ? "#e0f2fe" : "#94a3b8"} stroke="#0f172a" strokeWidth="2" />
          </g>

          {/* Animated Breeze Streamlines when Fan is ON */}
          {fanOn && (
            <g>
              {[-24, -8, 8, 24].map((xPos, idx) => (
                <line
                  key={xPos}
                  x1={xPos}
                  y1="48"
                  x2={xPos}
                  y2="72"
                  stroke="#7dd3fc"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray="5 5"
                >
                  <animate
                    attributeName="stroke-dashoffset"
                    from="10"
                    to="0"
                    dur={`${Math.max(0.25, 0.8 - fanSpeed * 0.12)}s`}
                    begin={`${idx * 0.1}s`}
                    repeatCount="indefinite"
                  />
                </line>
              ))}
            </g>
          )}

          <text
            x="0"
            y="104"
            textAnchor="middle"
            fontSize="10"
            fill={fanOn ? "#38bdf8" : "#cbd5e1"}
            fontFamily="monospace"
            fontWeight={fanOn ? "bold" : "normal"}
          >
            Fan {fanOn ? `ON · Spd ${fanSpeed} (${rpm} RPM)` : "OFF (0 RPM)"}
          </text>
          {selectedId === "fan_table" && (
            <rect
              x="-52"
              y="-52"
              width="104"
              height="162"
              fill="none"
              stroke="#22d3ee"
              strokeDasharray="4 3"
            />
          )}
        </g>

        {/* ---- LIVING ROOM AC ---- */}
        <g
          transform="translate(345, 36)"
          style={{ cursor: "pointer" }}
          onClick={() => handleApplianceClick(ac)}
        >
          <rect
            x="-52"
            y="0"
            width="104"
            height="32"
            rx="6"
            fill={acOn ? "#e2e8f0" : "#94a3b8"}
            stroke="#475569"
          />
          <rect x="-44" y="21" width="88" height="5" fill={acOn ? "#38bdf8" : "#64748b"} />
          <circle cx="40" cy="10" r="3.5" fill={acOn ? "#22c55e" : "#334155"} />
          {acOn && (
            <g>
              {[-32, -16, 0, 16, 32].map((xPos, i) => (
                <line
                  key={i}
                  x1={xPos}
                  y1="36"
                  x2={xPos - 4}
                  y2="74"
                  stroke="#7dd3fc"
                  strokeWidth="2"
                  strokeDasharray="6 6"
                  opacity={0.45 + acStrength * 0.45}
                >
                  <animate
                    attributeName="stroke-dashoffset"
                    from="12"
                    to="0"
                    dur="0.6s"
                    repeatCount="indefinite"
                  />
                </line>
              ))}
            </g>
          )}
          <text
            x="0"
            y="-7"
            textAnchor="middle"
            fontSize="10"
            fill={acOn ? "#7dd3fc" : "#cbd5e1"}
            fontFamily="monospace"
          >
            AC {acOn ? `ON · ${acTemp}°C` : "OFF"}
          </text>
          {selectedId === "ac_living" && (
            <rect
              x="-58"
              y="-18"
              width="116"
              height="96"
              fill="none"
              stroke="#22d3ee"
              strokeDasharray="4 3"
            />
          )}
        </g>

        {/* ---- SMART DISPLAY TV ---- */}
        <g
          transform="translate(345, 152)"
          style={{ cursor: "pointer" }}
          onClick={() => handleApplianceClick(tv)}
        >
          <rect
            x="-46"
            y="-26"
            width="92"
            height="54"
            rx="4"
            fill={tvOn ? "#312e81" : "#0f172a"}
            stroke={tvOn ? "#a855f7" : "#475569"}
            strokeWidth="2"
          />
          {tvOn && (
            <>
              <rect x="-40" y="-20" width="80" height="42" fill="#4c1d95" opacity="0.65" />
              <text x="0" y="4" textAnchor="middle" fontSize="9" fill="#e9d5ff" fontFamily="monospace">
                4K ACTIVE · V{tv?.targetValue || 35}
              </text>
            </>
          )}
          <rect x="-12" y="28" width="24" height="6" fill="#475569" />
          <text
            x="0"
            y="48"
            textAnchor="middle"
            fontSize="10"
            fill={tvOn ? "#d8b4fe" : "#cbd5e1"}
            fontFamily="monospace"
          >
            TV {tvOn ? "ON" : "OFF"}
          </text>
          {selectedId === "tv_ambient" && (
            <rect
              x="-52"
              y="-32"
              width="104"
              height="88"
              fill="none"
              stroke="#22d3ee"
              strokeDasharray="4 3"
            />
          )}
        </g>

        {/* ---- RADIANT HEATER (R2) ---- */}
        <g
          transform="translate(475, 195)"
          style={{ cursor: "pointer" }}
          onClick={() => handleApplianceClick(heater)}
        >
          {heaterOn && <ellipse cx="0" cy="8" rx="60" ry="44" fill="url(#heatGlow)" />}
          <rect x="-36" y="-12" width="72" height="46" rx="4" fill="#1e293b" stroke="#64748b" />
          {[0, 1, 2].map((i) => (
            <rect
              key={i}
              x="-28"
              y={-4 + i * 12}
              width="56"
              height="5"
              rx="2.5"
              fill={heaterOn ? "#f97316" : "#334155"}
            />
          ))}
          <text
            x="0"
            y="50"
            textAnchor="middle"
            fontSize="10"
            fill={heaterOn ? "#fdba74" : "#cbd5e1"}
            fontFamily="monospace"
          >
            Heater {heaterOn ? "ON (2000W)" : "OFF"}
          </text>
          {selectedId === "heater_radiant" && (
            <rect
              x="-44"
              y="-20"
              width="88"
              height="78"
              fill="none"
              stroke="#22d3ee"
              strokeDasharray="4 3"
            />
          )}
        </g>

        {/* ---- WATER GEYSER (R2) ---- */}
        <g
          transform="translate(575, 185)"
          style={{ cursor: "pointer" }}
          onClick={() => handleApplianceClick(geyser)}
        >
          <rect x="-20" y="-36" width="40" height="72" rx="10" fill="#e2e8f0" stroke="#64748b" />
          <rect
            x="-14"
            y="-28"
            width="28"
            height="56"
            rx="5"
            fill={geyserOn ? "#f87171" : "#60a5fa"}
            opacity="0.8"
          />
          <text
            x="0"
            y="52"
            textAnchor="middle"
            fontSize="10"
            fill={geyserOn ? "#fca5a5" : "#cbd5e1"}
            fontFamily="monospace"
          >
            Geyser {geyserOn ? `ON (${waterT.toFixed(0)}°C)` : "OFF"}
          </text>
          {selectedId === "geyser_bath" && (
            <rect
              x="-28"
              y="-44"
              width="56"
              height="104"
              fill="none"
              stroke="#22d3ee"
              strokeDasharray="4 3"
            />
          )}
        </g>

        {/* ---- MAIN ENTRANCE DEADBOLT ---- */}
        <g
          transform="translate(642, 132)"
          style={{ cursor: "pointer" }}
          onClick={() => handleApplianceClick(bolt)}
        >
          <rect x="-14" y="-38" width="28" height="76" rx="3" fill="#3f3f46" stroke="#71717a" />
          <rect
            x={locked ? -10 : -22}
            y="-6"
            width="20"
            height="12"
            rx="2"
            fill={locked ? "#22c55e" : "#f43f5e"}
          />
          <text
            x="0"
            y="54"
            textAnchor="middle"
            fontSize="9"
            fill={locked ? "#86efac" : "#fda4af"}
            fontFamily="monospace"
          >
            {locked ? "LOCKED" : "OPEN"}
          </text>
        </g>

        {/* Ambient Room Readout */}
        <text x="20" y="26" fontSize="10" fill="#94a3b8" fontFamily="monospace">
          Ambient Light {(ambient * 100).toFixed(0)}% · Fan {fanOn ? `${rpm} RPM` : "Stopped"} · Click any appliance to toggle ON/OFF
        </text>
      </svg>

      {/* Interactive Direct Power Control Strip */}
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {appliances.map((app) => {
          const isOn = app.powerState === "ON";
          const isSelected = selectedId === app.id;
          const isFan = app.id === "fan_table";
          const defaultGesture = APPLIANCE_DEFAULT_GESTURE_LABEL[app.id] || "✋ OPEN_PALM";

          return (
            <div
              key={app.id}
              onClick={() => onSelect?.(app)}
              className={`p-2 rounded-lg border text-xs transition-all cursor-pointer flex flex-col justify-between ${
                isSelected
                  ? "border-cyan-500 bg-cyan-950/40"
                  : "border-slate-800 bg-slate-950/80 hover:border-slate-700"
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-1">
                  <span className="font-bold text-slate-200 truncate text-[11px]">
                    {app.name.replace("Study ", "").replace("Living Room ", "").replace("Master ", "")}
                  </span>
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      isOn ? "bg-emerald-400" : "bg-slate-600"
                    }`}
                  />
                </div>
                <span className="text-[9px] text-cyan-400/90 font-mono block truncate mt-0.5">
                  {defaultGesture.split(" (")[0]}
                </span>
              </div>

              <div className="mt-2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleAppliance?.(app);
                  }}
                  className={`flex-1 py-1 px-1.5 rounded text-[10px] font-bold flex items-center justify-center gap-1 transition-colors ${
                    isOn
                      ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                      : "bg-slate-800 hover:bg-slate-700 text-slate-300"
                  }`}
                >
                  <Power className="w-3 h-3" />
                  {isOn ? "ON" : "OFF"}
                </button>
                {isFan && (
                  <button
                    type="button"
                    title="Cycle Fan Speed"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStepFanSpeed?.(app);
                    }}
                    className="py-1 px-1.5 rounded bg-cyan-900/70 hover:bg-cyan-800 text-cyan-200 text-[10px] font-mono"
                  >
                    S{app.fanSpeed || 0}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
