import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry";
import GUI from "lil-gui"; // Usa lil-gui o dat.GUI según la librería que uséis, cambia este import si en clase usáis dat.GUI tradicional

let scene, renderer, camera, camcontrols;
let mapa, mapsx, mapsy;
const scale = 5;

let datosEstadios = {};
let partidosPorFecha = {};
let distanciasEquipos = {};
let viajesActivos = [];

let fechaSimulacion;
let velocidadSimulacion = 1;
const velocidadViaje = 0.01;

const minlon = -21.84, maxlon = 6.99;
const minlat = 27.74, maxlat = 43.98;

let fechaTexto, fuenteGlobal;
let pausa = false;
let partidosLanzados = new Set();

let lineasPartidos = [];

const coloresEquipos = {
  "Real Madrid": 0xffffff,
  "Barcelona": 0x0a3a87,
  "Las Palmas": 0xfff000,
  "Ath Madrid": 0xeb1d1d,
  "Ath Bilbao": 0xeb1d1d,
  "Getafe": 0x1b57b6,
  "Valladolid": 0x4b186d,
  "Valencia": 0xffffff,
  "Villarreal": 0xffe800,
  "Leganes": 0x47adcc,
  "Sevilla": 0xffffff,
  "Betis": 0x008f30,
  "Sociedad": 0x389be1,
  "Osasuna": 0xce2029,
  "Mallorca": 0xe40521,
  "Espanol": 0x0082e6,
  "Celta": 0xb3d5fc,
  "Vallecano": 0xffffff,
  "Girona": 0xed1c24,
  "Alaves": 0x0e357f
};

let statsCanvas, statsTexture, statsPlane;
let posicionStatsX = -2.4;
let posicionStatsY = -1.25;

// Control variables para GUI
const controlSim = {
  pausa: false,
  velocidadSimulacion: 1,
  fecha: "",
  avanzar: () => { avanzarDia(); },
  retroceder: () => { retrocederDia(); },
  reset: () => { resetSimulacion(); }
};

init();
createGui();
animate();

function init() {
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.z = 6;

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  camcontrols = new OrbitControls(camera, renderer.domElement);

  const loaderFont = new FontLoader();
  loaderFont.load(
    "https://threejs.org/examples/fonts/helvetiker_regular.typeface.json",
    font => {
      fuenteGlobal = font;
      fechaTexto = crearTexto3D("Fecha:", font, 0.15, 0x000000);
      fechaTexto.position.set(-2.4, 2.2, 0.2);
      scene.add(fechaTexto);

      crearStatsCanvas();
      actualizarStatsCanvas([]);
    }
  );

  const loader = new THREE.TextureLoader();
  loader.load("src/mapa.png", texture => {
    const aspect = texture.image.width / texture.image.height;
    mapsy = scale;
    mapsx = mapsy * aspect;
    const geometry = new THREE.PlaneGeometry(mapsx, mapsy);
    const material = new THREE.MeshBasicMaterial({ map: texture });
    mapa = new THREE.Mesh(geometry, material);
    scene.add(mapa);

    cargarDatos();
  });

  window.addEventListener("resize", onWindowResize);
}

function crearStatsCanvas() {
  statsCanvas = document.createElement("canvas");
  statsCanvas.width = 440;
  statsCanvas.height = 520;
  statsTexture = new THREE.CanvasTexture(statsCanvas);

  const mat = new THREE.MeshBasicMaterial({ map: statsTexture, transparent: true });
  const plano = new THREE.PlaneGeometry(2.07, 2.86);
  statsPlane = new THREE.Mesh(plano, mat);
  statsPlane.position.set(posicionStatsX, posicionStatsY + 1.25, 0.2);
  scene.add(statsPlane);
}

function actualizarStatsCanvas(rankingEquipos) {
  const ctx = statsCanvas.getContext("2d");
  ctx.clearRect(0, 0, statsCanvas.width, statsCanvas.height);

  ctx.globalAlpha = 0.80;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, statsCanvas.width, statsCanvas.height);
  ctx.globalAlpha = 1.0;

  ctx.font = "bold 22px Arial";
  ctx.fillStyle = "#000";
  ctx.fillText("Kilómetros recorridos (equipos):", 12, 30);

  ctx.font = "18px Arial";
  rankingEquipos.forEach(({ eq, km, color }, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(15, 43 + i * 23, 18, 18);
    ctx.fillStyle = "#111";
    ctx.fillText(`${eq}: ${Math.round(km)} km`, 42, 57 + i * 23 - 6);
  });

  statsTexture.needsUpdate = true;
}

function cargarDatos() {
  fetch("src/coordenadasEstadios.csv")
    .then(r => r.text())
    .then(text => {
      procesarCSVEstadios(text);
      return fetch("src/season-2425.csv");
    })
    .then(r => r.text())
    .then(text => {
      procesarCSVPartidos(text);
      inicializarSimulacion();
    })
    .catch(err => console.error("Error cargando datos:", err));
}

function procesarCSVEstadios(texto) {
  const limpio = texto.replace(/"/g, "").replace(/\r/g, "").trim();
  const filas = limpio.split("\n");
  const encabezado = filas[0].split(",");

  const idx = {
    team: encabezado.findIndex(h => h.trim().toLowerCase() === "equipo"),
    lat: encabezado.findIndex(h => h.trim().toLowerCase() === "lat"),
    lon: encabezado.findIndex(h => h.trim().toLowerCase() === "lon")
  };

  if (idx.team === -1 || idx.lat === -1 || idx.lon === -1) {
    console.error("❌ Columnas incorrectas en coordenadasEstadios.csv");
    return;
  }

  for (let i = 1; i < filas.length; i++) {
    const cols = filas[i].split(",");
    if (cols.length < 4) continue;
    const team = cols[idx.team].trim();
    const lat = parseFloat(cols[idx.lat]);
    const lon = parseFloat(cols[idx.lon]);
    if (!isNaN(lat) && !isNaN(lon)) {
      datosEstadios[team] = { lat, lon };
      distanciasEquipos[team] = 0;
    }
  }
}

function procesarCSVPartidos(texto) {
  const filas = texto.split("\n");
  const encabezado = filas[0].split(",");
  const idx = {
    date: encabezado.findIndex(h => h.trim().toLowerCase() === "date"),
    home: encabezado.findIndex(h => h.trim().toLowerCase() === "hometeam"),
    away: encabezado.findIndex(h => h.trim().toLowerCase() === "awayteam")
  };

  if (idx.date === -1 || idx.home === -1 || idx.away === -1) {
    console.error("❌ Columnas incorrectas en season-2425.csv");
    return;
  }

  for (let i = 1; i < filas.length; i++) {
    const cols = filas[i].split(",");
    if (cols.length < 3) continue;
    const dateStr = cols[idx.date].trim();
    const home = cols[idx.home] ? cols[idx.home].trim() : "";
    const away = cols[idx.away] ? cols[idx.away].trim() : "";
    const fecha = parsearFecha(dateStr);
    if (!fecha.dateObj || !home || !away) continue;
    if (!partidosPorFecha[fecha.key]) partidosPorFecha[fecha.key] = [];
    partidosPorFecha[fecha.key].push({ date: fecha.dateObj, home, away });
  }
}

function inicializarSimulacion() {
  const fechas = Object.keys(partidosPorFecha).sort();
  if (fechas.length === 0) {
    console.error("No se encontraron fechas en el calendario de partidos");
    return;
  }
  let primerFecha = parsearFechaKey(fechas[0]);
  primerFecha.setDate(primerFecha.getDate() - 1);
  fechaSimulacion = new Date(primerFecha);
}

function resetSimulacion() {
  inicializarSimulacion();
  reconstruirEstadoHasta(fechaSimulacion);
  actualizarSimulacion(true);
}

function createGui() {
  const gui = new GUI();
  gui.add(controlSim, "pausa").name("Pausar/Reanudar").onChange(v => {
    pausa = v;
  });
  gui.add(controlSim, "fecha").name("Fecha actual").listen();
  gui.add(controlSim, "avanzar").name("⏩ Avanzar día");
  gui.add(controlSim, "retroceder").name("⏪ Retroceder día");
  gui.add(controlSim, "reset").name("🔄 Reiniciar");
}

function animate() {
  requestAnimationFrame(animate);
  if (!pausa) {
    actualizarSimulacion();
  }
  renderer.render(scene, camera);
}

function limpiarLineasYViajes() {
  // Elimina todas las esferas y líneas del mapa
  viajesActivos.forEach(v => scene.remove(v.esfera));
  viajesActivos = [];
  lineasPartidos.forEach(l => scene.remove(l));
  lineasPartidos = [];
  // Reinicia los kilómetros
  for (let eq in distanciasEquipos) distanciasEquipos[eq] = 0;
}

function reconstruirEstadoHasta(fechaLimite) {
  limpiarLineasYViajes();
  partidosLanzados.clear();

  const fechas = Object.keys(partidosPorFecha).sort();
  fechas.forEach(fechaKey => {
    const estaFecha = parsearFechaKey(fechaKey);
    if (estaFecha > fechaLimite) return;
    partidosPorFecha[fechaKey].forEach(p => {
      // Simula el viaje completo y dibuja directamente la línea
      const eHome = datosEstadios[p.home];
      const eAway = datosEstadios[p.away];
      if (!eHome || !eAway) return;
      const colorEquipo = coloresEquipos[p.away] || 0xffa500;
      const xHome = Map2Range(eHome.lon, minlon, maxlon, -mapsx / 2, mapsx / 2);
      const yHome = Map2Range(eHome.lat, minlat, maxlat, -mapsy / 2, mapsy / 2);
      const xAway = Map2Range(eAway.lon, minlon, maxlon, -mapsx / 2, mapsx / 2);
      const yAway = Map2Range(eAway.lat, minlat, maxlat, -mapsy / 2, mapsy / 2);
      // Dibuja la línea del viaje
      const points = [new THREE.Vector3(xAway, yAway, 0.1), new THREE.Vector3(xHome, yHome, 0.1)];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: colorEquipo, opacity: 0.7, transparent: true }));
      scene.add(line); lineasPartidos.push(line);
      // Suma los kilómetros recorridos
      distanciasEquipos[p.away] += haversineDistance(eHome, eAway);
    });
  });
  actualizarStatsTexto();
}

function avanzarDia() {
  if (!fechaSimulacion) return;
  fechaSimulacion.setDate(fechaSimulacion.getDate() + 1);
  partidosLanzados.clear(); // Permite relanzar los partidos del día nuevo
  actualizarSimulacion(true);
}

function retrocederDia() {
  if (!fechaSimulacion) return;
  fechaSimulacion.setDate(fechaSimulacion.getDate() - 1);
  reconstruirEstadoHasta(fechaSimulacion);
  actualizarSimulacion(true); // Solo animar los viajes del día actual si quieres
}
function avanzarDia() {
  if (!fechaSimulacion) return;
  fechaSimulacion.setDate(fechaSimulacion.getDate() + 1);
  reconstruirEstadoHasta(fechaSimulacion);
  actualizarSimulacion(true);
}

function limpiarViajesActivos() {
  viajesActivos.forEach(v => scene.remove(v.esfera));
  viajesActivos = [];
}

function actualizarSimulacion(forzado = false) {
  if (!fechaSimulacion || !fuenteGlobal) return;

  if (
    fechaSimulacion.getFullYear() > 2025 ||
    (fechaSimulacion.getFullYear() === 2025 && fechaSimulacion.getMonth() === 8 && fechaSimulacion.getDate() > 30)
  ) {
    return;
  }

  const dia = String(fechaSimulacion.getDate()).padStart(2, "0");
  const mes = String(fechaSimulacion.getMonth() + 1).padStart(2, "0");
  const anio = fechaSimulacion.getFullYear();
  const fechaStr = `Fecha: ${dia}/${mes}/${anio}`;
  actualizarTexto3D(fechaTexto, fechaStr, fuenteGlobal, 0.15);
  controlSim.fecha = fechaStr;

  const fechaKey = dateToKey(fechaSimulacion);
  if (partidosPorFecha[fechaKey]) {
    partidosPorFecha[fechaKey].forEach(p => {
      const clave = `${fechaKey}|${p.home}|${p.away}`;
      if (!partidosLanzados.has(clave)) {
        lanzarViaje(p);
        partidosLanzados.add(clave);
      }
    });
  }

  actualizarViajesActivos();
  actualizarStatsTexto();

  // Solo avanza automáticamente si no está forzado por control manual
  if (!forzado) {
    fechaSimulacion.setDate(fechaSimulacion.getDate() + velocidadSimulacion);
    partidosLanzados.clear();
  }
}

function lanzarViaje(partido) {
  const eHome = datosEstadios[partido.home];
  const eAway = datosEstadios[partido.away];
  if (!eHome || !eAway) return;

  const colorEquipo = coloresEquipos[partido.away] !== undefined ? coloresEquipos[partido.away] : 0xffa500;

  const xHome = Map2Range(eHome.lon, minlon, maxlon, -mapsx / 2, mapsx / 2);
  const yHome = Map2Range(eHome.lat, minlat, maxlat, -mapsy / 2, mapsy / 2);
  const xAway = Map2Range(eAway.lon, minlon, maxlon, -mapsx / 2, mapsx / 2);
  const yAway = Map2Range(eAway.lat, minlat, maxlat, -mapsy / 2, mapsy / 2);

  const esfera = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 10, 10),
    new THREE.MeshBasicMaterial({ color: colorEquipo })
  );
  esfera.position.set(xAway, yAway, 0.1);
  scene.add(esfera);

  viajesActivos.push({
    esfera,
    inicio: new THREE.Vector3(xAway, yAway, 0.1),
    fin: new THREE.Vector3(xHome, yHome, 0.1),
    home: partido.home,
    away: partido.away,
    color: colorEquipo,
    progreso: 0
  });
}

function actualizarViajesActivos() {
  for (let i = viajesActivos.length - 1; i >= 0; i--) {
    const viaje = viajesActivos[i];
    viaje.progreso += velocidadViaje;
    if (viaje.progreso < 1) {
      viaje.esfera.position.lerpVectors(viaje.inicio, viaje.fin, viaje.progreso);
    } else {
      const points = [viaje.inicio, viaje.fin];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({
          color: viaje.color,
          opacity: 0.7,
          transparent: true
        })
      );
      scene.add(line);
      lineasPartidos.push(line);

      const eHome = datosEstadios[viaje.home];
      const eAway = datosEstadios[viaje.away];
      const distancia = haversineDistance(eHome, eAway);
      distanciasEquipos[viaje.away] += distancia;

      scene.remove(viaje.esfera);
      viajesActivos.splice(i, 1);
    }
  }
}

function actualizarStatsTexto() {
  const equiposOrdenados = Object.entries(distanciasEquipos)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20);

  const ranking = equiposOrdenados.map(([eq, km]) => {
    const colorNum = coloresEquipos[eq] !== undefined ? coloresEquipos[eq] : 0x000000;
    const hexColor = "#" + colorNum.toString(16).padStart(6, "0");
    return { eq, km, color: hexColor };
  });
  actualizarStatsCanvas(ranking);
}


function crearTexto3D(texto, font, size, color) {
  const geometry = new TextGeometry(texto, { font, size, height: 0 });
  const material = new THREE.MeshBasicMaterial({ color });
  const mesh = new THREE.Mesh(geometry, material);
  const group = new THREE.Group();
  group.add(mesh);
  group.userData = { font, size, color, texto };
  return group;
}

function actualizarTexto3D(grupo, nuevoTexto, font, size) {
  if (!grupo || grupo.userData.texto === nuevoTexto) return;
  grupo.userData.texto = nuevoTexto;
  const old = grupo.children[0];
  grupo.remove(old);
  const geo = new TextGeometry(nuevoTexto, { font, size, height: 0 });
  const mat = new THREE.MeshBasicMaterial({ color: grupo.userData.color });
  const mesh = new THREE.Mesh(geo, mat);
  grupo.add(mesh);
}

function parsearFecha(strFecha) {
  const parts = strFecha.split("/");
  if (parts.length !== 3) return { dateObj: null, key: null };
  let anio = parseInt(parts[2], 10);
  if (anio < 100) anio += 2000;
  const dia = parseInt(parts[0], 10);
  const mes = parseInt(parts[1], 10) - 1;
  const dateObj = new Date(anio, mes, dia);
  const key = dateToKey(dateObj);
  return { dateObj, key };
}

function parsearFechaKey(strKey) {
  const parts = strKey.split("-");
  if (parts.length !== 3) return null;
  const anio = parseInt(parts[0], 10);
  const mes = parseInt(parts[1], 10) - 1;
  const dia = parseInt(parts[2], 10);
  return new Date(anio, mes, dia);
}

function dateToKey(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function haversineDistance(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function Map2Range(val, vmin, vmax, dmin, dmax) {
  let t = 1 - (vmax - val) / (vmax - vmin);
  return dmin + t * (dmax - dmin);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
