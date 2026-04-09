// Embedded mode detection
if (new URLSearchParams(window.location.search).get('embedded') === 'true') {
  document.body.classList.add('embedded');
}
const mapCanvas = document.getElementById("mapCanvas");
const sonarCanvas = document.getElementById("sonarCanvas");
const mapCtx = mapCanvas.getContext("2d");
const sonarCtx = sonarCanvas.getContext("2d");

const buoyCountEl = document.getElementById("buoyCount");
const linkedCountEl = document.getElementById("linkedCount");
const trackQualityEl = document.getElementById("trackQuality");
const heloReadoutEl = document.getElementById("heloReadout");
const rangeReadoutEl = document.getElementById("rangeReadout");
const positionReadoutEl = document.getElementById("positionReadout");
const estimateReadoutEl = document.getElementById("estimateReadout");
const clockReadoutEl = document.getElementById("clockReadout");
const contactAgeReadoutEl = document.getElementById("contactAgeReadout");
const messageLogEl = document.getElementById("messageLog");
const simRateEl = document.getElementById("simRate");
const returnsReadoutEl = document.getElementById("returnsReadout");
const declareReadoutEl = document.getElementById("declareReadout");
const confidenceReadoutEl = document.getElementById("confidenceReadout");
const confidenceHintEl = document.getElementById("confidenceHint");
const actionReadoutEl = document.getElementById("actionReadout");

const dropBuoyBtn = document.getElementById("dropBuoyBtn");
const declareBtn = document.getElementById("declareBtn");
const restartBtn = document.getElementById("restartBtn");
const startScreenEl = document.getElementById("startScreen");
const winScreenEl = document.getElementById("winScreen");
const winSubtitleEl = document.getElementById("winSubtitle");
const winStatsEl = document.getElementById("winStats");
const winReplayBtn = document.getElementById("winReplay");

const isEmbedded = new URLSearchParams(window.location.search).get('embedded') === 'true';

const WORLD = {
  width: 36,
  height: 24,
};

const DIFFICULTY = {
  easy: {
    label: "Easy",
    buoyCount: 20,
    guaranteedDetection: true,
    mapPingRequiresLink: false,
  },
  medium: {
    label: "Medium",
    buoyCount: 14,
    guaranteedDetection: true,
    mapPingRequiresLink: false,
  },
  hard: {
    label: "Hard",
    buoyCount: 10,
    guaranteedDetection: true,
    mapPingRequiresLink: true,
  },
};

let currentDifficulty = null;

const CONFIG = {
  sim: {
    rate: 8,
  },
  helo: {
    minSpeed: 0,
    maxSpeed: 125,
    accel: 40,
    turnRate: 58,
    linkRadius: 8,
  },
  sub: {
    minSpeed: 3,
    maxSpeed: 9,
  },
  buoy: {
    count: 20,
    sonarRadius: 4.4,
    linkRadius: 8,
    pingInterval: 6.2,
    guaranteedDetectionInBasket: true,
    mapPingRequiresLink: false,
  },
  solution: {
    freshness: 55,
    successThreshold: 1.1,
    minDeclareConfidence: 0.52,
  },
  physics: {
    soundSpeedNmPerSec: 0.82,
  },
};

function applyDifficulty(key) {
  const preset = DIFFICULTY[key];
  currentDifficulty = preset;
  CONFIG.buoy.count = preset.buoyCount;
  CONFIG.buoy.guaranteedDetectionInBasket = preset.guaranteedDetection;
  CONFIG.buoy.mapPingRequiresLink = preset.mapPingRequiresLink;
}

let state;

function resetGame() {
  const entrySide = pick(["north", "south", "east", "west"]);
  const sub = createSubmarine(entrySide);

  state = {
    time: 0,
    realTime: 0,
    missionEnded: false,
    result: null,
    buoysRemaining: CONFIG.buoy.count,
    buoyId: 1,
    helo: {
      x: WORLD.width * 0.18,
      y: WORLD.height * 0.5,
      heading: degToRad(18),
      speed: 65,
      trail: [],
    },
    sub,
    buoys: [],
    pingAnimations: [],
    estimate: null,
    keys: new Set(),
    messages: [],
    lastAction: "Search",
    lastFrame: performance.now(),
  };

  pushMessage("brief", `Mission start (${currentDifficulty.label}). A diesel-electric submarine is somewhere in the area. ${CONFIG.buoy.count} buoys loaded.`);
  if (CONFIG.buoy.mapPingRequiresLink) {
    pushMessage("hint", "Datalink required: only linked buoys show pings and returns on both the map and the PPI.");
  } else {
    pushMessage("hint", "The mission map shows all buoy pings and returns. The PPI only shows buoys within datalink range.");
  }
  resizeCanvases();
  updateReadouts();
  render();
}

function createSubmarine(side) {
  const margin = 2.2;
  const lane = randomRange(0.22, 0.78);
  let x = WORLD.width * 0.5;
  let y = WORLD.height * 0.5;
  let heading = 0;

  if (side === "north") {
    x = WORLD.width * lane;
    y = margin;
    heading = degToRad(randomRange(120, 220));
  } else if (side === "south") {
    x = WORLD.width * lane;
    y = WORLD.height - margin;
    heading = degToRad(randomRange(-55, 55));
  } else if (side === "east") {
    x = WORLD.width - margin;
    y = WORLD.height * lane;
    heading = degToRad(randomRange(150, 240));
  } else {
    x = margin;
    y = WORLD.height * lane;
    heading = degToRad(randomRange(-30, 30));
  }

  return {
    x,
    y,
    heading,
    desiredHeading: heading,
    speed: randomRange(CONFIG.sub.minSpeed, CONFIG.sub.maxSpeed),
    nextManeuverAt: randomRange(22, 36),
  };
}

function resizeCanvases() {
  resizeCanvas(mapCanvas, 1500, 1000);
  resizeCanvas(sonarCanvas, 900, 900);
}

function resizeCanvas(canvas, baseWidth, baseHeight) {
  const dpr = Math.max(window.devicePixelRatio || 1, 1);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(Math.floor(rect.width * dpr), Math.floor(baseWidth * 0.4));
  const height = Math.max(Math.floor(rect.height * dpr), Math.floor(baseHeight * 0.4));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

let gameRunning = false;

function gameLoop(now) {
  if (!gameRunning) {
    return;
  }
  const dt = Math.min((now - state.lastFrame) / 1000, 0.05);
  state.lastFrame = now;
  update(dt);
  render();
  requestAnimationFrame(gameLoop);
}

function update(dt) {
  if (!state || state.missionEnded) {
    syncMessageLog();
    return;
  }

  const simDt = dt * CONFIG.sim.rate;

  state.time += simDt;
  state.realTime += dt;
  updateHelo(dt, simDt);
  updateSub(simDt);
  updateBuoys(simDt);
  updatePingAnimations(simDt);
  updateEstimate();
  updateTrail();
  updateReadouts();
}

function updateHelo(inputDt, simDt) {
  const { helo, keys } = state;
  if (keys.has("KeyA")) {
    helo.heading -= degToRad(CONFIG.helo.turnRate) * inputDt;
  }
  if (keys.has("KeyD")) {
    helo.heading += degToRad(CONFIG.helo.turnRate) * inputDt;
  }
  if (keys.has("KeyW")) {
    helo.speed = clamp(helo.speed + CONFIG.helo.accel * inputDt, CONFIG.helo.minSpeed, CONFIG.helo.maxSpeed);
  }
  if (keys.has("KeyS")) {
    helo.speed = clamp(helo.speed - CONFIG.helo.accel * inputDt, CONFIG.helo.minSpeed, CONFIG.helo.maxSpeed);
  }

  const travel = knotsToNmPerSec(helo.speed) * simDt;
  helo.x += Math.cos(helo.heading) * travel;
  helo.y += Math.sin(helo.heading) * travel;

  if (helo.x < 0) {
    helo.x = 0;
    helo.heading = Math.PI - helo.heading;
  }
  if (helo.x > WORLD.width) {
    helo.x = WORLD.width;
    helo.heading = Math.PI - helo.heading;
  }
  if (helo.y < 0) {
    helo.y = 0;
    helo.heading *= -1;
  }
  if (helo.y > WORLD.height) {
    helo.y = WORLD.height;
    helo.heading *= -1;
  }
}

function updateSub(dt) {
  const sub = state.sub;

  if (state.time >= sub.nextManeuverAt) {
    const towardCenter = Math.atan2(WORLD.height * 0.5 - sub.y, WORLD.width * 0.5 - sub.x);
    sub.desiredHeading = towardCenter + degToRad(randomRange(-55, 55));
    sub.speed = randomRange(CONFIG.sub.minSpeed, CONFIG.sub.maxSpeed);
    sub.nextManeuverAt = state.time + randomRange(18, 32);
  }

  if (sub.x < 2 || sub.x > WORLD.width - 2 || sub.y < 2 || sub.y > WORLD.height - 2) {
    sub.desiredHeading = Math.atan2(WORLD.height * 0.5 - sub.y, WORLD.width * 0.5 - sub.x);
  }

  const turnDelta = normalizeAngle(sub.desiredHeading - sub.heading);
  const maxTurn = degToRad(8) * dt;
  sub.heading += clamp(turnDelta, -maxTurn, maxTurn);

  const travel = knotsToNmPerSec(sub.speed) * dt;
  sub.x += Math.cos(sub.heading) * travel;
  sub.y += Math.sin(sub.heading) * travel;
  sub.x = clamp(sub.x, 0.5, WORLD.width - 0.5);
  sub.y = clamp(sub.y, 0.5, WORLD.height - 0.5);
}

function updateBuoys() {
  for (const buoy of state.buoys) {
    buoy.linked = distance(buoy, state.helo) <= CONFIG.helo.linkRadius;

    if (state.time >= buoy.nextPingAt) {
      issuePing(buoy);
      buoy.nextPingAt = state.time + CONFIG.buoy.pingInterval + randomRange(-1.2, 1.5);
    }
  }
}

function issuePing(buoy) {
  const trueRange = distance(buoy, state.sub);
  const inRange = trueRange <= buoy.sonarRadius;
  const ping = {
    buoyId: buoy.id,
    x: buoy.x,
    y: buoy.y,
    startTime: state.time,
    hitTime: null,
    hitResolved: false,
    hitFlashAge: 0,
    returnTime: null,
    ringRadius: buoy.sonarRadius,
    returnRadius: null,
    resolved: false,
    flashAge: 0,
  };

  const probability = clamp(0.9 - trueRange / buoy.sonarRadius * 0.35, 0.22, 0.92);
  const detected = CONFIG.buoy.guaranteedDetectionInBasket
    ? inRange
    : inRange && Math.random() <= probability;

  if (detected) {
    const transit = trueRange / CONFIG.physics.soundSpeedNmPerSec;
    ping.hitTime = state.time + transit;
    ping.returnTime = state.time + transit * 2;
    ping.returnRadius = trueRange;
    ping.trueRange = trueRange;
  }

  state.pingAnimations.push(ping);
}

function updatePingAnimations(dt) {
  const nextAnimations = [];

  for (const ping of state.pingAnimations) {
    if (!ping.hitResolved && ping.hitTime && state.time >= ping.hitTime) {
      ping.hitResolved = true;
      ping.hitFlashAge = 0.45;
    }

    if (!ping.resolved && ping.returnTime && state.time >= ping.returnTime) {
      registerReturn(ping);
      ping.resolved = true;
      ping.flashAge = 1.15;
    }

    if (ping.hitFlashAge > 0) {
      ping.hitFlashAge = Math.max(0, ping.hitFlashAge - dt);
    }

    if (ping.flashAge > 0) {
      ping.flashAge = Math.max(0, ping.flashAge - dt);
    }

    const age = state.time - ping.startTime;
    const currentRadius = age * CONFIG.physics.soundSpeedNmPerSec;
    const keepOutbound = currentRadius <= ping.ringRadius + 0.35;
    const keepHitFlash = ping.hitFlashAge > 0;
    const keepFlash = ping.flashAge > 0;

    if (keepOutbound || keepHitFlash || keepFlash) {
      nextAnimations.push(ping);
    }
  }

  state.pingAnimations = nextAnimations;
}

function registerReturn(ping) {
  const buoy = state.buoys.find((candidate) => candidate.id === ping.buoyId);
  if (!buoy) {
    return;
  }

  const noise = randomGaussian() * 0.09 + randomGaussian() * ping.trueRange * 0.014;
  const measuredRange = clamp(ping.trueRange + noise, 0.2, buoy.sonarRadius + 0.15);
  const quality = clamp(1 - Math.abs(noise) / 0.25, 0.2, 0.98);

  const contact = {
    time: state.time,
    range: measuredRange,
    quality,
  };

  buoy.lastReturn = contact;
  buoy.returns.push(contact);
  buoy.returns = buoy.returns.filter((item) => state.time - item.time <= CONFIG.solution.freshness);

  pushMessage("contact", `${buoy.label} active return: ${measuredRange.toFixed(1)} nm. Quality ${(quality * 100).toFixed(0)}%.`);
}

function updateEstimate() {
  for (const buoy of state.buoys) {
    buoy.solutionContributor = false;
  }

  const observations = state.buoys
    .filter((buoy) => buoy.lastReturn && state.time - buoy.lastReturn.time <= CONFIG.solution.freshness)
    .map((buoy) => ({
      buoyId: buoy.id,
      x: buoy.x,
      y: buoy.y,
      range: buoy.lastReturn.range,
      weight: 0.55 + buoy.lastReturn.quality * 0.8,
      age: state.time - buoy.lastReturn.time,
      label: buoy.label,
    }));

  if (observations.length < 2) {
    state.estimate = null;
    return;
  }

  let best = null;
  let bestCost = Infinity;
  let centerX = average(observations.map((item) => item.x));
  let centerY = average(observations.map((item) => item.y));
  let span = Math.max(WORLD.width, WORLD.height) * 0.35;

  for (let pass = 0; pass < 4; pass += 1) {
    const steps = 26;
    const minX = clamp(centerX - span, 0, WORLD.width);
    const maxX = clamp(centerX + span, 0, WORLD.width);
    const minY = clamp(centerY - span, 0, WORLD.height);
    const maxY = clamp(centerY + span, 0, WORLD.height);

    for (let xi = 0; xi <= steps; xi += 1) {
      for (let yi = 0; yi <= steps; yi += 1) {
        const x = lerp(minX, maxX, xi / steps);
        const y = lerp(minY, maxY, yi / steps);
        let cost = 0;

        for (const item of observations) {
          const agePenalty = 1 + item.age * 0.05;
          const residual = Math.abs(distance({ x, y }, item) - item.range);
          cost += (residual * residual * agePenalty) / item.weight;
        }

        if (cost < bestCost) {
          bestCost = cost;
          best = { x, y };
        }
      }
    }

    centerX = best.x;
    centerY = best.y;
    span *= 0.42;
  }

  const geometrySpread = average(
    observations.map((item) => distance(item, { x: centerX, y: centerY }))
  );
  const residual = Math.sqrt(bestCost / observations.length);
  const confidence = clamp((observations.length - 1) * 0.22 + geometrySpread * 0.04 - residual * 0.7, 0.08, 0.98);
  const fitThreshold = Math.max(0.28, residual * 1.35);
  const fittedObservations = observations.map((item) => ({
    ...item,
    fitError: Math.abs(distance(best, item) - item.range),
  }));

  for (const item of fittedObservations) {
    const buoy = state.buoys.find((candidate) => candidate.id === item.buoyId);
    if (buoy) {
      buoy.solutionContributor = item.fitError <= fitThreshold;
    }
  }

  state.estimate = {
    x: best.x,
    y: best.y,
    residual,
    confidence,
    observations: fittedObservations,
    fitThreshold,
  };
}

function updateTrail() {
  const trail = state.helo.trail;
  const last = trail[trail.length - 1];
  if (!last || distance(last, state.helo) >= 0.18) {
    trail.push({ x: state.helo.x, y: state.helo.y });
  }
  while (trail.length > 80) {
    trail.shift();
  }
}

function updateReadouts() {
  const linked = state.buoys.filter((buoy) => buoy.linked).length;
  const recentReturns = state.buoys.filter(
    (buoy) => buoy.lastReturn && state.time - buoy.lastReturn.time <= CONFIG.solution.freshness
  ).length;
  buoyCountEl.textContent = String(state.buoysRemaining);
  linkedCountEl.textContent = String(linked);
  heloReadoutEl.textContent = `HDG ${formatHeading(state.helo.heading)} / ${Math.round(state.helo.speed)} kt`;
  rangeReadoutEl.textContent = `Link radius ${CONFIG.helo.linkRadius.toFixed(1)} nm`;
  positionReadoutEl.textContent = `${state.helo.x.toFixed(1)} E / ${state.helo.y.toFixed(1)} N`;
  clockReadoutEl.textContent = formatClock(state.realTime);
  simRateEl.textContent = `x${CONFIG.sim.rate}`;
  returnsReadoutEl.textContent = String(recentReturns);
  actionReadoutEl.textContent = state.lastAction;

  const minConf = CONFIG.solution.minDeclareConfidence;
  const minConfPct = Math.round(minConf * 100);

  if (!state.estimate) {
    trackQualityEl.textContent = recentReturns === 1 ? "Single buoy" : "Searching";
    estimateReadoutEl.textContent = recentReturns === 1 ? "Need 1 more return" : "No track";
    confidenceReadoutEl.textContent = "—";
    confidenceHintEl.textContent =
      "Confidence shows once two or more buoys have fresh returns. Space buoys so range rings cross from different directions—not in a single line.";
    contactAgeReadoutEl.textContent = "None";
    declareReadoutEl.textContent = recentReturns === 1 ? "Need 1 more return" : "Need 2 returns";
    declareBtn.disabled = true;
  } else {
    const quality = state.estimate.confidence;
    const pct = Math.round(quality * 100);
    trackQualityEl.textContent =
      quality > 0.72 ? "Weapons tight" :
      quality > minConf ? "Refining" :
      "Probable";
    estimateReadoutEl.textContent = `${state.estimate.x.toFixed(1)} / ${state.estimate.y.toFixed(1)} (${state.estimate.residual.toFixed(2)} nm err)`;
    confidenceReadoutEl.textContent =
      quality >= minConf ? `${pct}% · meets ${minConfPct}% declare floor` : `${pct}% · need ≥${minConfPct}% to declare`;
    const freshest = Math.min(...state.estimate.observations.map((item) => item.age));
    contactAgeReadoutEl.textContent = `${freshest.toFixed(0)} sec`;
    declareReadoutEl.textContent = quality >= minConf ? "Ready to declare" : "Weak solution";
    declareBtn.disabled = false;

    if (quality >= minConf) {
      confidenceHintEl.textContent = `Declare also requires the estimate within ${CONFIG.solution.successThreshold.toFixed(1)} nm of the submarine.`;
    } else {
      const n = state.estimate.observations.length;
      const res = state.estimate.residual;
      const parts = [];
      if (n <= 2) {
        parts.push("add a third+ buoy with a fresh return on target");
      }
      if (res > 0.45) {
        parts.push("tighten geometry so measured ranges agree (buoys bracketing the contact, not collinear)");
      }
      if (freshest > 28) {
        parts.push("refresh stale returns—stay datalinked near the field");
      }
      if (parts.length === 0) {
        parts.push("more high-quality crossings and consistent ring fit raise confidence");
      }
      confidenceHintEl.textContent = `Raise confidence: ${parts.join("; ")}.`;
    }
  }

  syncMessageLog();
}

function render() {
  drawMap();
  drawSonar();
}

function drawMap() {
  const ctx = mapCtx;
  const width = mapCanvas.width;
  const height = mapCanvas.height;
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "#061521";
  ctx.fillRect(0, 0, width, height);

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "rgba(30, 86, 112, 0.17)");
  gradient.addColorStop(1, "rgba(3, 12, 19, 0.06)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  drawGrid(ctx, width, height, 8, "rgba(123, 213, 255, 0.09)");

  const scaleX = width / WORLD.width;
  const scaleY = height / WORLD.height;

  drawTrackTrail(ctx, scaleX, scaleY);

  for (const buoy of state.buoys) {
    const px = buoy.x * scaleX;
    const py = buoy.y * scaleY;

    ctx.strokeStyle = buoy.linked ? "rgba(124, 230, 212, 0.28)" : "rgba(135, 170, 186, 0.12)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(px, py, buoy.sonarRadius * scaleX, 0, Math.PI * 2);
    ctx.stroke();

    const showReturn = buoy.lastReturn && state.time - buoy.lastReturn.time <= CONFIG.solution.freshness;
    if (showReturn && (!CONFIG.buoy.mapPingRequiresLink || buoy.linked)) {
      ctx.strokeStyle = buoy.solutionContributor ? "rgba(246, 185, 95, 0.78)" : "rgba(246, 185, 95, 0.34)";
      ctx.lineWidth = buoy.solutionContributor ? 2.8 : 1.8;
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.arc(px, py, buoy.lastReturn.range * scaleX, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = buoy.linked ? "#7ce6d4" : "#5a7280";
    ctx.beginPath();
    ctx.arc(px, py, buoy.solutionContributor ? 7.5 : buoy.linked ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(217, 238, 248, 0.9)";
    ctx.font = `${Math.max(11, scaleX * 0.45)}px Bahnschrift, Trebuchet MS, sans-serif`;
    ctx.fillText(buoy.label, px + 10, py - 10);
  }

  drawPingEffects(ctx, scaleX, scaleY);
  drawEstimate(ctx, scaleX, scaleY);
  drawHelo(ctx, scaleX, scaleY);

  if (state.missionEnded && state.result === "success") {
    drawSubReveal(ctx, scaleX, scaleY);
  }

  drawMapFrame(ctx, width, height);
}

function drawTrackTrail(ctx, scaleX, scaleY) {
  const trail = state.helo.trail;
  if (trail.length < 2) {
    return;
  }

  ctx.strokeStyle = "rgba(217, 238, 248, 0.22)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  trail.forEach((point, index) => {
    const x = point.x * scaleX;
    const y = point.y * scaleY;
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
}

function drawPingEffects(ctx, scaleX, scaleY) {
  for (const ping of state.pingAnimations) {
    const buoy = state.buoys.find((b) => b.id === ping.buoyId);
    if (CONFIG.buoy.mapPingRequiresLink && (!buoy || !buoy.linked)) {
      continue;
    }

    const elapsed = state.time - ping.startTime;
    const radius = elapsed * CONFIG.physics.soundSpeedNmPerSec;
    const px = ping.x * scaleX;
    const py = ping.y * scaleY;

    if (radius <= ping.ringRadius + 0.35) {
      ctx.strokeStyle = "rgba(124, 230, 212, 0.38)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, radius * scaleX, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (ping.hitFlashAge > 0 && ping.returnRadius) {
      ctx.strokeStyle = `rgba(124, 230, 212, ${0.22 + ping.hitFlashAge * 1.15})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(px, py, ping.returnRadius * scaleX, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (ping.flashAge > 0 && ping.returnRadius) {
      ctx.strokeStyle = `rgba(246, 185, 95, ${0.2 + ping.flashAge * 0.55})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(px, py, ping.returnRadius * scaleX, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawEstimate(ctx, scaleX, scaleY) {
  if (!state.estimate) {
    return;
  }

  const px = state.estimate.x * scaleX;
  const py = state.estimate.y * scaleY;
  const ring = Math.max(12, state.estimate.residual * scaleX * 2.2);

  ctx.strokeStyle = "rgba(125, 227, 255, 0.68)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px, py, ring, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(px - 12, py);
  ctx.lineTo(px + 12, py);
  ctx.moveTo(px, py - 12);
  ctx.lineTo(px, py + 12);
  ctx.stroke();
}

function drawHelo(ctx, scaleX, scaleY) {
  const px = state.helo.x * scaleX;
  const py = state.helo.y * scaleY;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(state.helo.heading);

  ctx.fillStyle = "#d9eef8";
  ctx.beginPath();
  ctx.moveTo(16, 0);
  ctx.lineTo(-10, -8);
  ctx.lineTo(-2, 0);
  ctx.lineTo(-10, 8);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(217, 238, 248, 0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-6, -12);
  ctx.lineTo(-6, 12);
  ctx.moveTo(-14, 0);
  ctx.lineTo(12, 0);
  ctx.stroke();
  ctx.restore();
}

function drawSubReveal(ctx, scaleX, scaleY) {
  const px = state.sub.x * scaleX;
  const py = state.sub.y * scaleY;

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(state.sub.heading);
  ctx.fillStyle = "rgba(255, 118, 118, 0.9)";
  ctx.beginPath();
  ctx.ellipse(0, 0, 20, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-10, -3, 10, 6);
  ctx.restore();
}

function drawMapFrame(ctx, width, height) {
  ctx.strokeStyle = "rgba(127, 205, 255, 0.12)";
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, width - 3, height - 3);
}

function drawSonar() {
  const ctx = sonarCtx;
  const width = sonarCanvas.width;
  const height = sonarCanvas.height;
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "#04121a";
  ctx.fillRect(0, 0, width, height);

  const center = { x: width / 2, y: height / 2 };
  const scopeRadius = Math.min(width, height) * 0.42;
  const pixelsPerNm = scopeRadius / CONFIG.helo.linkRadius;

  ctx.strokeStyle = "rgba(124, 230, 212, 0.16)";
  ctx.lineWidth = 1.5;
  for (let r = 1; r <= 4; r += 1) {
    ctx.beginPath();
    ctx.arc(center.x, center.y, (scopeRadius / 4) * r, 0, Math.PI * 2);
    ctx.stroke();
  }

  for (let i = 0; i < 12; i += 1) {
    const angle = (Math.PI * 2 * i) / 12;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(center.x + Math.cos(angle) * scopeRadius, center.y + Math.sin(angle) * scopeRadius);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(124, 230, 212, 0.3)";
  ctx.font = `${Math.round(width * 0.022)}px Bahnschrift, Trebuchet MS, sans-serif`;
  ctx.fillText("0 nm", center.x + 8, center.y - 8);
  ctx.fillText(`${(CONFIG.helo.linkRadius / 2).toFixed(1)} nm`, center.x + scopeRadius / 2 + 6, center.y - 8);
  ctx.fillText(`${CONFIG.helo.linkRadius.toFixed(1)} nm`, center.x + scopeRadius + 8, center.y - 8);

  const linkedBuoys = state.buoys.filter((buoy) => buoy.linked);

  for (const buoy of linkedBuoys) {
    const dx = (buoy.x - state.helo.x) * pixelsPerNm;
    const dy = (buoy.y - state.helo.y) * pixelsPerNm;
    const px = center.x + dx;
    const py = center.y + dy;

    ctx.strokeStyle = "rgba(124, 230, 212, 0.22)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(px, py, buoy.sonarRadius * pixelsPerNm, 0, Math.PI * 2);
    ctx.stroke();

    if (buoy.lastReturn && state.time - buoy.lastReturn.time <= CONFIG.solution.freshness) {
      ctx.strokeStyle = buoy.solutionContributor ? "rgba(246, 185, 95, 0.86)" : "rgba(246, 185, 95, 0.5)";
      ctx.lineWidth = buoy.solutionContributor ? 3.2 : 2.2;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.arc(px, py, buoy.lastReturn.range * pixelsPerNm, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = "#7ce6d4";
    ctx.beginPath();
    ctx.arc(px, py, buoy.solutionContributor ? 8.5 : 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#d9eef8";
    ctx.fillText(buoy.label, px + 10, py - 10);
  }

  for (const ping of state.pingAnimations) {
    const buoy = state.buoys.find((candidate) => candidate.id === ping.buoyId);
    if (!buoy || !buoy.linked) {
      continue;
    }

    const dx = (buoy.x - state.helo.x) * pixelsPerNm;
    const dy = (buoy.y - state.helo.y) * pixelsPerNm;
    const px = center.x + dx;
    const py = center.y + dy;
    const radius = Math.max(0, (state.time - ping.startTime) * CONFIG.physics.soundSpeedNmPerSec * pixelsPerNm);

    if (radius <= buoy.sonarRadius * pixelsPerNm + 2) {
      ctx.strokeStyle = "rgba(124, 230, 212, 0.42)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (ping.hitFlashAge > 0 && ping.returnRadius) {
      ctx.strokeStyle = `rgba(124, 230, 212, ${0.2 + ping.hitFlashAge * 1.2})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(px, py, ping.returnRadius * pixelsPerNm, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (ping.flashAge > 0 && ping.returnRadius) {
      ctx.strokeStyle = `rgba(246, 185, 95, ${0.18 + ping.flashAge * 0.65})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(px, py, ping.returnRadius * pixelsPerNm, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.strokeStyle = "rgba(217, 238, 248, 0.88)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(center.x - 14, center.y);
  ctx.lineTo(center.x + 14, center.y);
  ctx.moveTo(center.x, center.y - 14);
  ctx.lineTo(center.x, center.y + 14);
  ctx.stroke();

  ctx.fillStyle = "#d9eef8";
  ctx.beginPath();
  ctx.arc(center.x, center.y, 5, 0, Math.PI * 2);
  ctx.fill();
}

function drawGrid(ctx, width, height, divisions, stroke) {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  for (let i = 1; i < divisions; i += 1) {
    const x = (width / divisions) * i;
    const y = (height / divisions) * i;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function dropBuoy() {
  if (!state || state.missionEnded) {
    return;
  }
  if (state.buoysRemaining <= 0) {
    pushMessage("warning", "No buoys remaining in the launcher.");
    return;
  }

  const label = `B${state.buoyId}`;
  state.buoyId += 1;
  state.buoysRemaining -= 1;
  state.buoys.push({
    id: makeId(),
    label,
    x: state.helo.x,
    y: state.helo.y,
    linked: true,
    sonarRadius: CONFIG.buoy.sonarRadius,
    returns: [],
    lastReturn: null,
    nextPingAt: state.time + randomRange(2.4, 4.2),
  });

  pushMessage("deploy", `${label} splashed. Active sonar basket ${CONFIG.buoy.sonarRadius.toFixed(1)} nm.`);
}

function declareContact() {
  if (!state || state.missionEnded) {
    return;
  }

  if (!state.estimate) {
    state.lastAction = "Need more returns";
    pushMessage("warning", "No solution to declare. Get at least two recent buoy returns.");
    updateReadouts();
    return;
  }

  const error = distance(state.estimate, state.sub);
  const withinRange = error <= CONFIG.solution.successThreshold;
  const confidentEnough = state.estimate.confidence >= CONFIG.solution.minDeclareConfidence;

  if (withinRange && confidentEnough) {
    state.missionEnded = true;
    state.result = "success";
    state.lastAction = "Contact declared";
    pushMessage("success", `Contact declared. Error ${error.toFixed(2)} nm. Datum confirmed and submarine revealed on the plot.`);
    updateReadouts();
    showWinScreen(error);
  } else if (!confidentEnough && withinRange) {
    const pct = (state.estimate.confidence * 100).toFixed(0);
    const need = Math.round(CONFIG.solution.minDeclareConfidence * 100);
    state.lastAction = "Rejected: weak track";
    pushMessage(
      "warning",
      `Solution rejected. Estimate was ${error.toFixed(2)} nm from the submarine but track confidence is too low (${pct}%, need ${need}%+). See Plot Notes for how to raise confidence.`
    );
    updateReadouts();
  } else {
    state.lastAction = `Missed by ${error.toFixed(1)} nm`;
    pushMessage("warning", `Solution rejected. Contact declaration was ${error.toFixed(2)} nm off. Tighten the buoy geometry and try again.`);
    updateReadouts();
  }
}

function pushMessage(kind, text) {
  const prefix =
    kind === "contact" ? "RETURN" :
    kind === "deploy" ? "DEPLOY" :
    kind === "warning" ? "WARN" :
    kind === "success" ? "HIT" :
    kind === "hint" ? "TIP" :
    "OPS";

  state.messages.unshift({
    id: makeId(),
    prefix,
    text,
    time: state ? state.time : 0,
  });
  state.messages = state.messages.slice(0, 8);
}

function syncMessageLog() {
  messageLogEl.innerHTML = state.messages
    .map((entry) => `<li><strong>${formatClock(entry.time)} ${entry.prefix}</strong> ${entry.text}</li>`)
    .join("");
}

function formatClock(time) {
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatHeading(radians) {
  const degrees = (radToDeg(radians) + 360) % 360;
  return String(Math.round(degrees)).padStart(3, "0");
}

function knotsToNmPerSec(knots) {
  return knots / 3600;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function degToRad(degrees) {
  return (degrees * Math.PI) / 180;
}

function radToDeg(radians) {
  return (radians * 180) / Math.PI;
}

function normalizeAngle(angle) {
  let result = angle;
  while (result > Math.PI) {
    result -= Math.PI * 2;
  }
  while (result < -Math.PI) {
    result += Math.PI * 2;
  }
  return result;
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function pick(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function randomGaussian() {
  let u = 0;
  let v = 0;
  while (u === 0) {
    u = Math.random();
  }
  while (v === 0) {
    v = Math.random();
  }
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function makeId() {
  return `id-${Math.floor(performance.now() * 1000)}-${Math.floor(Math.random() * 1e9)}`;
}

function handleKeyDown(event) {
  if (event.repeat || !gameRunning) {
    return;
  }

  if (event.code === "Space" || event.key === " ") {
    event.preventDefault();
    dropBuoy();
    return;
  }
  if (event.key === "Enter" || event.code === "Enter" || event.code === "NumpadEnter") {
    event.preventDefault();
    declareContact();
    return;
  }
  if (event.key === "r" || event.key === "R" || event.code === "KeyR") {
    showStartScreen();
    return;
  }
  if (state) {
    state.keys.add(event.code);
  }
}

function handleKeyUp(event) {
  if (!state) {
    return;
  }
  state.keys.delete(event.code);
}

function showWinScreen(error) {
  const time = formatClock(state.realTime);
  const buoysUsed = CONFIG.buoy.count - state.buoysRemaining;

  winSubtitleEl.textContent = `Submarine localized on ${currentDifficulty.label} difficulty.`;
  winStatsEl.innerHTML = `
    <div class="win-stat"><span>Mission Time</span><strong>${time}</strong></div>
    <div class="win-stat"><span>Buoys Used</span><strong>${buoysUsed} / ${CONFIG.buoy.count}</strong></div>
    <div class="win-stat"><span>Accuracy</span><strong>${error.toFixed(2)} nm</strong></div>
  `;
  winScreenEl.classList.remove("hidden");
}

function showStartScreen() {
  gameRunning = false;
  if (state) {
    state.keys.clear();
  }
  startScreenEl.classList.remove("hidden");
  winScreenEl.classList.add("hidden");
}

function startGame(difficultyKey) {
  applyDifficulty(difficultyKey);
  startScreenEl.classList.add("hidden");
  winScreenEl.classList.add("hidden");
  gameRunning = true;
  resetGame();
  requestAnimationFrame(gameLoop);
}

function bindTouchFlightControls() {
  document.querySelectorAll(".fly-btn").forEach((btn) => {
    const code = btn.dataset.keycode;
    if (!code) {
      return;
    }

    const release = (e) => {
      if (state) {
        state.keys.delete(code);
      }
      if (e.pointerId != null) {
        try {
          btn.releasePointerCapture(e.pointerId);
        } catch (_) {
          /* ignore */
        }
      }
    };

    btn.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) {
        return;
      }
      e.preventDefault();
      if (!gameRunning || !state) {
        return;
      }
      state.keys.add(code);
      try {
        btn.setPointerCapture(e.pointerId);
      } catch (_) {
        /* ignore */
      }
    });

    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointercancel", release);
    btn.addEventListener("lostpointercapture", release);
  });
}

window.addEventListener("blur", () => {
  if (state) {
    state.keys.clear();
  }
});

document.addEventListener("keydown", handleKeyDown, true);
window.addEventListener("keyup", handleKeyUp);

window.addEventListener("resize", resizeCanvases);
dropBuoyBtn.addEventListener("click", dropBuoy);
declareBtn.addEventListener("click", declareContact);
restartBtn.addEventListener("click", () => {
  showStartScreen();
});
winReplayBtn.addEventListener("click", () => {
  showStartScreen();
});

document.querySelectorAll(".difficulty-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    startGame(btn.dataset.difficulty);
  });
});

bindTouchFlightControls();
resizeCanvases();
