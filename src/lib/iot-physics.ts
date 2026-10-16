/**
 * Single source of truth for IoT physical telemetry.
 * Both actuate + appliances routes MUST import from here (ChiefDebugger structural fix).
 */

export function fanTelemetry(speed: number): {
  fanSpeed: number;
  powerState: "ON" | "OFF";
  airRpm: number;
  airflowCfm: number;
  activeWattage: number;
  targetValue: number;
} {
  const fanSpeed = Math.max(0, Math.min(4, Math.round(speed)));
  if (fanSpeed === 0) {
    return {
      fanSpeed: 0,
      powerState: "OFF",
      airRpm: 0,
      airflowCfm: 0,
      activeWattage: 0,
      targetValue: 0,
    };
  }
  return {
    fanSpeed,
    powerState: "ON",
    airRpm: Math.round(420 + fanSpeed * 260),
    airflowCfm: Math.round(130 + fanSpeed * 75),
    activeWattage: Math.round(12 + fanSpeed * 11),
    targetValue: fanSpeed,
  };
}

export function acTelemetry(
  powerOn: boolean,
  temperature: number
): {
  powerState: "ON" | "OFF";
  temperature: number;
  targetValue: number;
  activeWattage: number;
  fanSpeed: number;
  airRpm: number;
  airflowCfm: number;
} {
  const temp = Math.max(18, Math.min(26, Number(temperature) || 22));
  const targetVal = Math.round(temp);
  if (!powerOn) {
    return {
      powerState: "OFF",
      temperature: temp,
      targetValue: targetVal,
      activeWattage: 0,
      fanSpeed: 0,
      airRpm: 0,
      airflowCfm: 0,
    };
  }
  return {
    powerState: "ON",
    temperature: temp,
    targetValue: targetVal,
    activeWattage: Math.round(1000 + (26 - temp) * 120),
    fanSpeed: 3,
    airRpm: 1250,
    airflowCfm: 410,
  };
}

export function lampTelemetry(
  powerOn: boolean,
  brightness = 80
): {
  powerState: "ON" | "OFF";
  brightness: number;
  activeWattage: number;
  targetValue: number;
} {
  if (!powerOn) {
    return { powerState: "OFF", brightness: 0, activeWattage: 0, targetValue: 0 };
  }
  const b = Math.round(Math.max(10, Math.min(100, Number(brightness) || 80)));
  return {
    powerState: "ON",
    brightness: b,
    activeWattage: Math.round((b / 100) * 12 * 10) / 10,
    targetValue: b,
  };
}

export function heaterTelemetry(powerOn: boolean): {
  powerState: "ON" | "OFF";
  activeWattage: number;
  targetValue: number;
} {
  return powerOn
    ? { powerState: "ON", activeWattage: 2000, targetValue: 2000 }
    : { powerState: "OFF", activeWattage: 0, targetValue: 0 };
}

export function geyserTelemetry(powerOn: boolean, temperature = 65): {
  powerState: "ON" | "OFF";
  temperature: number;
  activeWattage: number;
  targetValue: number;
} {
  const rawTemp = Number(temperature) || 65;
  const activeTemp = rawTemp >= 45 ? rawTemp : 65;
  const targetInt = Math.round(activeTemp);
  return powerOn
    ? {
        powerState: "ON",
        temperature: activeTemp,
        activeWattage: 3000,
        targetValue: targetInt,
      }
    : {
        powerState: "OFF",
        temperature: 38.5,
        activeWattage: 0,
        targetValue: 0,
      };
}

export function zeroPowerTelemetry(): {
  activeWattage: number;
  fanSpeed: number;
  airRpm: number;
  airflowCfm: number;
} {
  return { activeWattage: 0, fanSpeed: 0, airRpm: 0, airflowCfm: 0 };
}
