// ================================================================
// APP.JS — Lógica Universal, Agrupación de Tomos y Modal de Detalle
// Portal Biblioteca Central USM
// Versión Optimizada para Alto Rendimiento (High Performance / INP < 16ms)
// ================================================================

import { db } from "./firebase-config.js";
import {
    collection,
    getDocs,
    onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ----------------------------------------------------------------
// 0. CONSTANTES DE RENDIMIENTO
// ----------------------------------------------------------------
const DEBOUNCE_MS         = 350;          // ms de espera tras la última tecla antes de buscar
const MAX_RENDER          = 50;           // límite estricto de tarjetas por página en DOM
const STAGGER_CAP         = 20;           // máximo de tarjetas con animación escalonada
const SNAPSHOT_THROTTLE   = 2000;         // ms mínimos entre actualizaciones en tiempo real
const SESSION_CACHE_KEY   = "usm-catalogo-cache-v4";
const SESSION_CACHE_TS    = "usm-catalogo-ts-v4";
const SESSION_CACHE_COL   = "usm-catalogo-col-v4";
const SESSION_CACHE_TTL   = 5 * 60 * 1000; // 5 minutos de vigencia del caché en sessionStorage
const NORM_CACHE_MAX      = 10000;        // capacidad máxima de caché de normalización (evicción FIFO)

// ----------------------------------------------------------------
// 1. REFERENCIAS AL DOM
// ----------------------------------------------------------------
const selectFiltro = document.getElementById("select-filtro");
const searchInput = document.getElementById("search-input");
const searchForm = document.getElementById("search-form");
const resultsEmpty = document.getElementById("results-empty");
const resultsLoading = document.getElementById("results-loading");
const resultsNoResults = document.getElementById("results-no-results");
const resultsGrid = document.getElementById("results-grid");

// Modal Institucional (Biblioteca Central)
const btnBibliografia = document.getElementById("btn-bibliografia");
const modalOverlay = document.getElementById("modal-overlay");
const modalClose = document.getElementById("modal-close");

// Modal de Detalle de Libro y Tomos
const modalBookOverlay = document.getElementById("modal-book-overlay");
const modalBookDetail = document.getElementById("modal-book-detail");
const modalBookClose = document.getElementById("modal-book-close");
const modalBookCategory = document.getElementById("modal-book-category");
const modalBookTitle = document.getElementById("modal-book-title");
const modalBookAuthor = document.getElementById("modal-book-author");
const modalBookMeta = document.getElementById("modal-book-meta");
const modalBookTomosCount = document.getElementById("modal-book-tomos-count");
const modalTomosList = document.getElementById("modal-tomos-list");

// Tema Claro / Oscuro
const btnThemeToggle = document.getElementById("btn-theme-toggle");
const themeIconMoon = document.querySelector(".theme-icon--moon");
const themeIconSun = document.querySelector(".theme-icon--sun");

// ----------------------------------------------------------------
// 2. PLACEHOLDERS DINÁMICOS
// ----------------------------------------------------------------
const placeholderMap = {
    general: "Buscar en el catálogo general...",
    titulo: "Buscar en el catálogo por título...",
    autor: "Buscar en el catálogo por autor...",
    cota: "Buscar en el catálogo por cota (ej. QA303, F2341)..."
};

if (selectFiltro) {
    selectFiltro.addEventListener("change", () => {
        const filtro = selectFiltro.value;
        searchInput.placeholder = placeholderMap[filtro] || placeholderMap.general;
        searchInput.focus();
        // Si ya hay un término escrito, relanzar búsqueda con el nuevo filtro
        if (searchInput.value.trim()) {
            _busquedaConDebounce.cancel();
            ejecutarBusqueda();
        }
    });
}

// ----------------------------------------------------------------
// 3. NORMALIZADOR UNIVERSAL DE TEXTO (con caché de evicción FIFO)
// Elimina tildes, mayúsculas, espacios extra y signos.
// La caché evita recomputar el mismo string durante cada búsqueda.
// En lugar de limpiar todo el mapa (.clear()), se descarta la entrada
// más antigua en O(1) cuando se llega al límite, evitando Cache Thrashing.
// ----------------------------------------------------------------
const _normCache = new Map();

function normalizar(texto) {
    if (texto === null || texto === undefined) return "";
    const key = String(texto);
    const cached = _normCache.get(key);
    if (cached !== undefined) return cached;

    const result = key
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\w\s]/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

    // Evicción FIFO: mantener los textos calientes en memoria
    if (_normCache.size >= NORM_CACHE_MAX) {
        const oldestKey = _normCache.keys().next().value;
        _normCache.delete(oldestKey);
    }
    _normCache.set(key, result);
    return result;
}

// Helper para ceder el hilo principal (Non-blocking Cooperative Scheduling)
function cederHilo() {
    return new Promise(resolve => {
        setTimeout(resolve, 0);
    });
}

// ----------------------------------------------------------------
// 4. DETECCIÓN ROBUSTA DE TOMOS / VOLÚMENES EN TÍTULOS
// Separa el título base de la obra de la especificación del tomo
// ----------------------------------------------------------------
function parsearTituloYTomo(rawTitulo) {
    let titulo = String(rawTitulo || "").trim();
    if (!titulo) return { tituloBase: "Sin título", etiquetaTomo: "" };

    let tomoDetectado = "";
    const ordinales = "primero|segundo|tercero|cuarto|quinto|sexto|septimo|octavo|noveno|decimo|primer|1er|2do|3er|4to|5to";

    // 1. Patrón con separador (: - . / , ( [) antes del tomo o al final
    const regex1 = new RegExp(
        `(?:[\\:\\-\\–\\—\\/\\,\\.\\|\\s]+|\\s*[\\[\\(])\\s*(?:TOMO|VOLUMEN|VOL\\.?|PARTE|FASC[ÍI]CULO|T\\.?|LIBRO|EJEMPLAR|EJ\\.?|V\\.?)\\s*([0-9IVXLCDMivxlcdm]+|${ordinales}|[A-Za-z])(?:[\\s\\:\\-\\–\\—\\/\\,\\.\\|].*|[\\]\\)]\\s*.*)?$`,
        "i"
    );

    // 2. Patrón entre paréntesis o corchetes: "(TOMO I)", "[VOL. 1]"
    const regex2 = new RegExp(
        `[\\[\\(]\\s*(?:TOMO|VOLUMEN|VOL\\.?|PARTE|T\\.?)\\s*([0-9IVXLCDMivxlcdm]+|${ordinales}|[A-Za-z])\\s*[\\]\\)]`,
        "i"
    );

    // 3. Patrón directo: "TOMO I", "TOMO 1", "VOLUMEN 2"
    const regex3 = new RegExp(
        `\\b(?:TOMO|VOLUMEN|VOL\\.?|PARTE|T\\.?)\\s*([0-9IVXLCDMivxlcdm]+|${ordinales})\\b`,
        "i"
    );

    let match = titulo.match(regex1);
    if (match) {
        tomoDetectado = match[0].replace(/^[\\:\-\–\—\/\,\.\|\s\(\[]+/, '').replace(/[\)\]\s]+$/, '').trim();
        let tituloBase = titulo.substring(0, match.index).trim();
        tituloBase = tituloBase.replace(/[\:\-\–\—\/\,\.\|\s]+$/, '').trim();
        if (tituloBase.length > 2) {
            return { tituloBase, etiquetaTomo: formatearEtiquetaTomo(tomoDetectado) };
        }
    }

    match = titulo.match(regex2);
    if (match) {
        tomoDetectado = match[0].replace(/[\(\)\[\]]/g, '').trim();
        let tituloBase = (titulo.substring(0, match.index) + " " + titulo.substring(match.index + match[0].length)).trim();
        tituloBase = tituloBase.replace(/\s{2,}/g, ' ').replace(/[\:\-\–\—\/\,\.\|\s]+$/, '').trim();
        if (tituloBase.length > 2) {
            return { tituloBase, etiquetaTomo: formatearEtiquetaTomo(tomoDetectado) };
        }
    }

    match = titulo.match(regex3);
    if (match) {
        tomoDetectado = match[0].trim();
        let tituloBase = (titulo.substring(0, match.index) + " " + titulo.substring(match.index + match[0].length)).trim();
        tituloBase = tituloBase.replace(/\s{2,}/g, ' ').replace(/[\:\-\–\—\/\,\.\|\s]+$/, '').trim();
        if (tituloBase.length > 2) {
            return { tituloBase, etiquetaTomo: formatearEtiquetaTomo(tomoDetectado) };
        }
    }

    return {
        tituloBase: titulo,
        etiquetaTomo: ""
    };
}

// ----------------------------------------------------------------
// 4.1. FORMATEADOR DE RANGO DE COTAS (PARA OBRAS AGRUPADAS)
// ----------------------------------------------------------------
function formatearRangoCotas(cotas, cotaFallback) {
    const cotasValidas = [...new Set((cotas || []).filter(c => c && c !== "—" && String(c).trim() !== ""))];
    if (cotasValidas.length === 0) {
        return (cotaFallback && cotaFallback !== "—") ? String(cotaFallback).trim() : "—";
    }
    if (cotasValidas.length === 1) {
        return cotasValidas[0];
    }

    // Detectar si comparten una base común y varían en tomo/volumen
    const regexTomo = /\s*(?:TOMO|VOL|VOLUMEN|T\.?|V\.?|EJ\.?)\s*([0-9IVXLCDMivxlcdm]+)$/i;
    const matches = cotasValidas.map(c => {
        const m = c.match(regexTomo);
        if (m) {
            return { base: c.substring(0, m.index).trim(), tomo: m[1].toUpperCase() };
        }
        return { base: c.trim(), tomo: null };
    });

    const primeraBase = matches[0].base;
    const todosMismaBase = matches.every(m => m.base === primeraBase && m.tomo !== null);

    if (todosMismaBase && matches.length > 1) {
        const primerTomo = matches[0].tomo;
        const ultimoTomo = matches[matches.length - 1].tomo;
        return `${primeraBase} (T.${primerTomo} – T.${ultimoTomo})`;
    }

    if (cotasValidas.length === 2) {
        return `${cotasValidas[0]} / ${cotasValidas[1]}`;
    }

    return `${cotasValidas[0]} – ${cotasValidas[cotasValidas.length - 1]}`;
}

// Valida si un valor de tomo/volumen es real y no un marcador nulo o vacío
function esValorTomoValido(valor) {
    if (valor === undefined || valor === null) return false;
    const str = String(valor).trim();
    if (str === "") return false;
    if (/^(null|undefined|n\/a|na|\-|\—|none|0|sin tomo|no aplica|no tiene)$/i.test(str)) return false;
    const norm = normalizar(str);
    if (norm === "" || norm === "tomo unico" || norm === "tomo unico ejemplar general" || norm === "ejemplar general") return false;
    return true;
}

// Determina si una obra o documento posee un tomo/volumen válido asignado
function tienePropiedadTomoValida(obra) {
    if (!obra) return false;

    // 1. Obra con múltiples tomos consolidados
    if (obra.totalTomos > 1) return true;

    // 2. Tomos únicos con etiqueta específica válida
    if (Array.isArray(obra.tomos) && obra.tomos.length > 0) {
        const tieneTomoEspecifico = obra.tomos.some(t => t && esValorTomoValido(t.etiquetaTomo));
        if (tieneTomoEspecifico) return true;
    }

    // 3. Documentos crudos originales de Firestore
    if (Array.isArray(obra.itemsCrudos) && obra.itemsCrudos.length > 0) {
        const tieneCrudoConTomo = obra.itemsCrudos.some(crudo => {
            if (crudo.etiquetaTomo && esValorTomoValido(crudo.etiquetaTomo)) return true;
            const raw = crudo.raw || {};
            const campos = [
                raw.tomo, raw.volumen, raw.vol, raw.volume, raw.parte,
                raw.numero_tomo, raw.numeroTomo, raw.num_tomo, raw.numTomo,
                raw.nro_tomo, raw.nroTomo, raw.tomo_nro, raw.tomoNumero
            ];
            return campos.some(v => esValorTomoValido(v));
        });
        if (tieneCrudoConTomo) return true;
    }

    // 4. Verificación directa de propiedades en el objeto
    if (obra.tomo && esValorTomoValido(obra.tomo)) return true;
    if (obra.raw) {
        const raw = obra.raw;
        const campos = [
            raw.tomo, raw.volumen, raw.vol, raw.volume, raw.parte,
            raw.numero_tomo, raw.numeroTomo, raw.num_tomo, raw.numTomo,
            raw.nro_tomo, raw.nroTomo, raw.tomo_nro, raw.tomoNumero
        ];
        return campos.some(v => esValorTomoValido(v));
    }

    return false;
}

// Normaliza el texto de la etiqueta
function formatearEtiquetaTomo(str) {
    if (!str && str !== 0) return "";
    let clean = String(str).trim().replace(/^[\:\-\–\—\/\,\.\|\s]+/, '').replace(/[\:\-\–\—\/\,\.\|\s]+$/, '');
    if (!clean || /^(null|undefined|n\/a|na|\-|\—|none)$/i.test(clean)) return "";
    
    // Si viene solo como número arábigo o romano, anteponer "Tomo "
    if (/^[0-9]+$/i.test(clean) || /^[IVXLCDMivxlcdm]+$/i.test(clean)) {
        clean = `Tomo ${clean}`;
    }

    // Si viene como "T.1", "T. 1", "T-1", "T1", normalizar a "Tomo 1"
    clean = clean.replace(/^T[\.\-\s]*([0-9IVXLCDMivxlcdm]+)$/i, 'Tomo $1');
    clean = clean.replace(/^V(?:ol)?[\.\-\s]*([0-9IVXLCDMivxlcdm]+)$/i, 'Vol. $1');

    return clean.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase())
                .replace(/\b(I|Ii|Iii|Iv|V|Vi|Vii|Viii|Ix|X|Xi|Xii)\b/gi, (m) => m.toUpperCase());
}

// ----------------------------------------------------------------
// 5. EXTRACTOR INTELIGENTE DE CAMPOS (ADAPTADOR UNIVERSAL)
// ----------------------------------------------------------------
function mapearLibro(docId, raw) {
    const rawTitulo = raw.titulo || raw.title || raw.nombre || raw.nombre_libro || raw.name || "Sin título";
    const parseado = parsearTituloYTomo(rawTitulo);

    const camposTomo = [
        raw.tomo, raw.volumen, raw.vol, raw.volume, raw.parte,
        raw.numero_tomo, raw.numeroTomo, raw.num_tomo, raw.numTomo,
        raw.nro_tomo, raw.nroTomo, raw.tomo_nro, raw.tomoNumero
    ];
    const rawTomo = camposTomo.find(
        v => v !== undefined && v !== null && String(v).trim() !== "" && !/^(null|undefined|n\/a|na|\-|\—|0)$/i.test(String(v).trim())
    );
    let tomo = rawTomo ? formatearEtiquetaTomo(rawTomo) : (parseado.etiquetaTomo || "");

    if (!tomo && raw.cota) {
        const matchCota = String(raw.cota).match(/(?:[\s\.\-]+(?:T\.?|TOMO|VOL\.?|V\.?)\s*([0-9IVXLCDMivxlcdm]+))\b/i);
        if (matchCota) {
            tomo = formatearEtiquetaTomo(matchCota[0]);
        }
    }

    const tituloBase = parseado.tituloBase || rawTitulo;

    let autor = "Autor no especificado";
    if (raw.autor) autor = raw.autor;
    else if (raw.author) autor = raw.author;
    else if (raw.autores) autor = Array.isArray(raw.autores) ? raw.autores.join(", ") : raw.autores;
    else if (raw.escritor) autor = raw.escritor;

    const cota = raw.cota || raw.codigo || raw.cod || raw.ubicacion || raw.estante || raw.clasificacion || "—";
    const materia = raw.materia || raw.categoria || raw.category || raw.area || raw.carrera || raw.facultad || "General";
    const anio = raw.anio || raw.año || raw.year || raw.fecha || raw.fecha_publicacion || "—";
    const editorial = raw.editorial || raw.publisher || raw.edicion || "";

    let ejemplares = undefined;
    const rawEjemplares = [
        raw.ejemplares_disponibles,
        raw.copias_disponibles,
        raw.stock_disponible,
        raw.ejemplares,
        raw.cantidad,
        raw.stock,
        raw.copias,
        raw.total_ejemplares
    ].find(v => v !== undefined && v !== null && String(v).trim() !== "");

    if (rawEjemplares !== undefined) {
        const num = Number(rawEjemplares);
        if (!isNaN(num)) ejemplares = num;
    }

    const rawFlag = [
        raw.disponible,
        raw.disponibilidad,
        raw.isAvailable,
        raw.is_available,
        raw.activo,
        raw.active
    ].find(v => v !== undefined && v !== null);

    const rawPrestado = [
        raw.prestado,
        raw.enPrestamo,
        raw.en_prestamo,
        raw.borrowed
    ].find(v => v !== undefined && v !== null);

    const estadoRaw = raw.estado !== undefined ? raw.estado : (raw.status !== undefined ? raw.status : (raw.condicion !== undefined ? raw.condicion : ""));
    const textoEstado = normalizar(typeof rawFlag === "string" ? rawFlag : estadoRaw);

    const esExplicitoNo =
        rawFlag === false ||
        rawFlag === 0 ||
        rawPrestado === true ||
        rawPrestado === 1 ||
        String(rawPrestado).trim().toLowerCase() === "true" ||
        String(rawPrestado).trim().toLowerCase() === "si" ||
        textoEstado === "false" ||
        textoEstado === "0" ||
        textoEstado.includes("no disp") ||
        textoEstado.includes("no disponible") ||
        textoEstado.includes("nodisponible") ||
        textoEstado.includes("prest") ||
        textoEstado.includes("agot") ||
        textoEstado.includes("inactiv") ||
        textoEstado.includes("repara") ||
        textoEstado.includes("extrav") ||
        textoEstado === "no";

    const esExplicitoSi =
        (rawFlag === true ||
        rawFlag === 1 ||
        textoEstado === "true" ||
        textoEstado === "1" ||
        textoEstado === "si" ||
        textoEstado === "yes" ||
        textoEstado === "disponible" ||
        textoEstado.includes("en sala") ||
        textoEstado.includes("activo") ||
        (textoEstado.includes("disp") && !textoEstado.includes("no"))) &&
        rawPrestado !== true && rawPrestado !== 1;

    let estaDisponible = false;
    if (ejemplares !== undefined && !isNaN(ejemplares)) {
        if (ejemplares <= 0) {
            estaDisponible = false;
        } else if (esExplicitoNo) {
            estaDisponible = false;
        } else if (esExplicitoSi) {
            estaDisponible = true;
        } else {
            estaDisponible = true;
        }
    } else {
        if (esExplicitoNo) {
            estaDisponible = false;
        } else if (esExplicitoSi) {
            estaDisponible = true;
        } else {
            estaDisponible = true;
        }
    }

    let palabrasClave = [];
    if (Array.isArray(raw.palabrasClave)) palabrasClave = raw.palabrasClave;
    else if (Array.isArray(raw.tags)) palabrasClave = raw.tags;
    else if (Array.isArray(raw.keywords)) palabrasClave = raw.keywords;

    return {
        id: docId,
        tituloOriginal: String(rawTitulo).trim(),
        tituloBase: String(tituloBase).trim(),
        tomo: String(tomo).trim(),
        autor: String(autor).trim(),
        cota: String(cota).trim(),
        materia: String(materia).trim(),
        anio: String(anio).trim(),
        editorial: String(editorial).trim(),
        ejemplares: ejemplares !== undefined && !isNaN(ejemplares) ? ejemplares : null,
        disponible: estaDisponible,
        palabrasClave: palabrasClave,
        raw: raw
    };
}

// ----------------------------------------------------------------
// 6. AGRUPACIÓN INTELIGENTE DE LIBROS Y CONSOLIDACIÓN DE TOMOS ÚNICOS
// Optimizado a O(1) con índice secundario y procesamiento no bloqueante
// que cede el control al Event Loop cada lote para mantener 60 FPS.
// ----------------------------------------------------------------
async function agruparLibrosPorObra(librosMapeados) {
    const mapaObras = new Map();
    const mapaTitulos = new Map(); // Índice secundario O(1) por título normalizado

    const totalItems = librosMapeados.length;
    for (let i = 0; i < totalItems; i++) {
        const item = librosMapeados[i];
        const claveTitulo = normalizar(item.tituloBase);
        const claveAutor = normalizar(item.autor);

        // Clave unificada por título de la obra
        let clave = claveTitulo;
        if (claveAutor && claveAutor !== "autor no especificado" && claveAutor !== "") {
            clave = `${claveTitulo}___${claveAutor}`;
        }

        // Búsqueda O(1) optimizada sin bucle cuadrático
        let claveExistente = null;
        if (mapaObras.has(clave)) {
            claveExistente = clave;
        } else if (mapaTitulos.has(claveTitulo)) {
            claveExistente = mapaTitulos.get(claveTitulo);
        }

        if (!claveExistente) {
            claveExistente = clave;
            mapaTitulos.set(claveTitulo, claveExistente);
            mapaObras.set(claveExistente, {
                id: item.id,
                titulo: item.tituloBase,
                autor: item.autor,
                materia: item.materia,
                editorial: item.editorial,
                anio: item.anio,
                cota: item.cota,
                ejemplares: item.ejemplares,
                palabrasClave: [...item.palabrasClave],
                _pcSet: new Set(item.palabrasClave),
                itemsCrudos: []
            });
        }

        const obra = mapaObras.get(claveExistente);

        // Completar metadatos generales si estaban vacíos
        if ((!obra.autor || obra.autor === "Autor no especificado") && item.autor && item.autor !== "Autor no especificado") {
            obra.autor = item.autor;
        }
        if ((!obra.editorial || obra.editorial === "—") && item.editorial) obra.editorial = item.editorial;
        if ((!obra.anio || obra.anio === "—") && item.anio && item.anio !== "—") obra.anio = item.anio;
        if ((!obra.materia || obra.materia === "General") && item.materia && item.materia !== "General") obra.materia = item.materia;
        if ((!obra.cota || obra.cota === "—") && item.cota && item.cota !== "—") obra.cota = item.cota;

        // Consolidar palabras clave con Set O(1)
        item.palabrasClave.forEach(palabra => {
            if (!obra._pcSet.has(palabra)) {
                obra._pcSet.add(palabra);
                obra.palabrasClave.push(palabra);
            }
        });

        // Etiqueta del tomo
        let etiquetaTomo = item.tomo;
        if (!etiquetaTomo && item.tituloOriginal !== item.tituloBase) {
            const parseadoTomo = parsearTituloYTomo(item.tituloOriginal);
            etiquetaTomo = parseadoTomo.etiquetaTomo || "";
        }

        obra.itemsCrudos.push({
            id: item.id,
            tituloCompleto: item.tituloOriginal,
            etiquetaTomo: etiquetaTomo,
            cota: item.cota,
            anio: item.anio,
            editorial: item.editorial,
            materia: item.materia,
            ejemplares: item.ejemplares,
            disponible: item.disponible,
            raw: item.raw
        });

        // Ceder el hilo cada 250 elementos para que la UI no sufra lag
        if (i > 0 && i % 250 === 0) {
            await cederHilo();
        }
    }

    // Consolidar tomos únicos dentro de cada obra
    const listaObras = Array.from(mapaObras.values());
    const obrasAgrupadas = [];

    for (let k = 0; k < listaObras.length; k++) {
        const obra = listaObras[k];
        const mapaTomos = new Map();

        obra.itemsCrudos.forEach(crudo => {
            let etiqueta = crudo.etiquetaTomo ? crudo.etiquetaTomo.trim() : "";
            if (!etiqueta) {
                etiqueta = "Tomo Único / Ejemplar General";
            }

            const claveTomo = normalizar(etiqueta);

            if (!mapaTomos.has(claveTomo)) {
                mapaTomos.set(claveTomo, {
                    id: crudo.id,
                    etiquetaTomo: etiqueta,
                    tituloCompleto: crudo.tituloCompleto,
                    cota: crudo.cota,
                    cotas: [crudo.cota].filter(c => c && c !== "—"),
                    anio: crudo.anio,
                    editorial: crudo.editorial,
                    materia: crudo.materia,
                    ejemplares: crudo.ejemplares !== null && !isNaN(crudo.ejemplares) ? crudo.ejemplares : 1,
                    totalCopiasRegistradas: 1,
                    disponible: crudo.disponible
                });
            } else {
                const tomoExistente = mapaTomos.get(claveTomo);
                tomoExistente.totalCopiasRegistradas += 1;

                const cant = crudo.ejemplares !== null && !isNaN(crudo.ejemplares) ? crudo.ejemplares : 1;
                tomoExistente.ejemplares += cant;

                if (crudo.disponible) {
                    tomoExistente.disponible = true;
                }

                if (crudo.cota && crudo.cota !== "—" && !tomoExistente.cotas.includes(crudo.cota)) {
                    tomoExistente.cotas.push(crudo.cota);
                }

                if ((!tomoExistente.anio || tomoExistente.anio === "—") && crudo.anio && crudo.anio !== "—") {
                    tomoExistente.anio = crudo.anio;
                }
                if ((!tomoExistente.editorial || tomoExistente.editorial === "—") && crudo.editorial) {
                    tomoExistente.editorial = crudo.editorial;
                }
            }
        });

        const tomosUnicos = Array.from(mapaTomos.values());

        // Si hay varios tomos y alguno tenía etiqueta genérica, ajustar
        if (tomosUnicos.length > 1) {
            tomosUnicos.forEach((t, idx) => {
                if (t.etiquetaTomo === "Tomo Único / Ejemplar General") {
                    t.etiquetaTomo = `Tomo ${idx + 1}`;
                }
            });
        }

        // Ordenar tomos naturalmente (Tomo I, Tomo II, Tomo III o 1, 2, 3)
        tomosUnicos.sort((a, b) => {
            return a.etiquetaTomo.localeCompare(b.etiquetaTomo, undefined, { numeric: true, sensitivity: 'base' });
        });

        // Calcular total de ejemplares globales de la obra
        let totalEjemplaresObra = 0;
        tomosUnicos.forEach(t => {
            totalEjemplaresObra += (t.ejemplares || 1);
        });

        // Disponibilidad global de la obra
        const estaDisponible = tomosUnicos.some(t => t.disponible);

        // Formatear rango de años
        const anios = [...new Set(tomosUnicos.map(t => t.anio).filter(a => a && a !== "—"))];
        let anioTexto = obra.anio;
        if (anios.length > 1) {
            const aniosNum = anios.map(Number).filter(n => !isNaN(n));
            if (aniosNum.length > 1) {
                anioTexto = `${Math.min(...aniosNum)} – ${Math.max(...aniosNum)}`;
            } else {
                anioTexto = anios.join(", ");
            }
        }

        // Obtener y formatear cotas de la obra y de los tomos
        const todasCotasObra = [...new Set(
            tomosUnicos.flatMap(t => [t.cota, ...(t.cotas || [])]).filter(c => c && c !== "—" && String(c).trim() !== "")
        )];
        const cotaObraFormateada = formatearRangoCotas(todasCotasObra, obra.cota);
        const cotaNorm = normalizar(cotaObraFormateada);
        const cotaCompact = cotaNorm.replace(/\s+/g, "");

        // Precalcular tomo válido una sola vez
        const tieneTomoValido = tienePropiedadTomoValida({
            totalTomos: tomosUnicos.length,
            tomos: tomosUnicos,
            itemsCrudos: obra.itemsCrudos
        });

        // Pre-computar campos normalizados para búsquedas a velocidad de memoria
        const nTitulo = normalizar(obra.titulo);
        const nAutor = normalizar(obra.autor);
        const nMateria = normalizar(obra.materia);
        const nTags = obra.palabrasClave.map(normalizar);
        const nTomoTitulos = tomosUnicos.map(t => normalizar(t.tituloCompleto));
        const nTomoEtiquetas = tomosUnicos
            .filter(t => esValorTomoValido(t.etiquetaTomo))
            .map(t => normalizar(t.etiquetaTomo));
        const nTomoCotasFlat = tomosUnicos
            .flatMap(t => [normalizar(t.cota), ...(t.cotas || []).map(normalizar)])
            .filter(Boolean);
        const nCotasCompactStr = [
            cotaCompact,
            ...tomosUnicos.flatMap(t => [
                normalizar(t.cota).replace(/\s+/g, ""),
                ...(t.cotas || []).map(c => normalizar(c).replace(/\s+/g, ""))
            ])
        ].filter(Boolean).join(" ");

        // String compuesto pre-armado para búsqueda instantánea en catálogo general
        const nSearchString = `${nTitulo} ${nAutor} ${nMateria} ${cotaNorm} ${nTags.join(" ")} ${nTomoTitulos.join(" ")} ${nTomoEtiquetas.join(" ")} ${nTomoCotasFlat.join(" ")}`.trim();

        obrasAgrupadas.push({
            id: obra.id,
            titulo: obra.titulo,
            autor: obra.autor,
            materia: obra.materia,
            editorial: obra.editorial,
            anio: anioTexto,
            cota: cotaObraFormateada,
            cotasLista: todasCotasObra,
            palabrasClave: obra.palabrasClave,
            totalTomos: tomosUnicos.length,
            totalEjemplares: totalEjemplaresObra,
            disponible: estaDisponible,
            tieneTomoValido: tieneTomoValido,
            tomos: tomosUnicos,
            itemsCrudos: obra.itemsCrudos,
            // Campos pre-normalizados
            _nTitulo: nTitulo,
            _nAutor: nAutor,
            _nMateria: nMateria,
            _nCota: cotaNorm,
            _nCotaCompact: cotaCompact,
            _nTags: nTags,
            _nTomoTitulos: nTomoTitulos,
            _nTomoEtiquetas: nTomoEtiquetas,
            _nTomoCotas: tomosUnicos.map(t => [normalizar(t.cota), ...(t.cotas || []).map(normalizar)].filter(Boolean)),
            _nTomoCotasCompact: tomosUnicos.map(t => [normalizar(t.cota).replace(/\s+/g, ""), ...(t.cotas || []).map(c => normalizar(c).replace(/\s+/g, ""))].filter(Boolean)),
            _nTomoCotasFlat: nTomoCotasFlat,
            _nCotasCompactStr: nCotasCompactStr,
            _nSearchString: nSearchString
        });

        // Ceder el hilo cada 200 obras
        if (k > 0 && k % 200 === 0) {
            await cederHilo();
        }
    }

    return obrasAgrupadas;
}

// ----------------------------------------------------------------
// 7. CACHÉ EN MEMORIA, sessionStorage Y CONSULTA NO BLOQUEANTE
// ----------------------------------------------------------------
let catalogoCache = null;
let _cargandoPromise = null;         // Mutex real basado en Promise
let _desuscribirTiempoReal = null;    // Listener onSnapshot de Firebase
let _snapshotThrottleTimer = null;    // Throttle para onSnapshot
let _coleccionActiva = null;
const COLECCIONES_A_PROBAR = ["libros", "catalogo", "books", "biblioteca", "inventario"];

// --- Persistencia ligera en sessionStorage ---
function guardarCacheEnSession(datos, nombreColeccion) {
    try {
        const ligero = datos.map(obra => {
            const { tomos, itemsCrudos, _pcSet, ...resto } = obra;
            const tomosLigeros = (tomos || []).map(t => {
                const { raw, ...tResto } = t;
                return tResto;
            });
            return { ...resto, tomos: tomosLigeros };
        });
        sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(ligero));
        sessionStorage.setItem(SESSION_CACHE_TS, String(Date.now()));
        if (nombreColeccion) {
            sessionStorage.setItem(SESSION_CACHE_COL, nombreColeccion);
        }
    } catch (_e) {
        // sessionStorage lleno o deshabilitado — silencioso
    }
}

function cargarCacheDeSession() {
    try {
        const ts = Number(sessionStorage.getItem(SESSION_CACHE_TS) || 0);
        if (Date.now() - ts > SESSION_CACHE_TTL) return null;
        const raw = sessionStorage.getItem(SESSION_CACHE_KEY);
        if (!raw) return null;
        const datos = JSON.parse(raw);
        if (!Array.isArray(datos) || datos.length === 0) return null;
        _coleccionActiva = sessionStorage.getItem(SESSION_CACHE_COL);
        console.log(`⚡ Catálogo restaurado desde sessionStorage (${datos.length} obras, ${((Date.now() - ts) / 1000).toFixed(0)}s de antigüedad).`);
        return datos;
    } catch (_e) {
        return null;
    }
}

// --- Suscripción en tiempo real (throttled) ---
function iniciarListenerTiempoReal(nombreColeccion) {
    if (_desuscribirTiempoReal || !nombreColeccion) return;
    try {
        const colRef = collection(db, nombreColeccion);
        let primeraVez = true;
        _desuscribirTiempoReal = onSnapshot(colRef, (snapshot) => {
            if (primeraVez) { primeraVez = false; return; }

            if (_snapshotThrottleTimer) return;
            _snapshotThrottleTimer = setTimeout(async () => {
                _snapshotThrottleTimer = null;
                const lista = [];
                const docs = snapshot.docs;
                for (let i = 0; i < docs.length; i++) {
                    lista.push(mapearLibro(docs[i].id, docs[i].data()));
                    if (i > 0 && i % 250 === 0) await cederHilo();
                }
                catalogoCache = await agruparLibrosPorObra(lista);
                guardarCacheEnSession(catalogoCache, nombreColeccion);
                console.log(`🔄 [Tiempo Real] Catálogo sincronizado (${snapshot.size} docs en "${nombreColeccion}")`);

                // Si hay una búsqueda activa visible en pantalla, refrescarla en vivo
                const termino = searchInput ? searchInput.value.trim() : "";
                if (termino && resultsGrid && !resultsGrid.classList.contains("hidden")) {
                    _ultimoTerminoBuscado = null; // Forzar re-filtrado
                    ejecutarBusqueda();
                }
            }, SNAPSHOT_THROTTLE);
        }, (err) => {
            console.warn("⚠️ No se pudo suscribir a actualizaciones en tiempo real:", err);
        });
    } catch (e) {
        console.warn("⚠️ No se pudo inicializar onSnapshot:", e);
    }
}

async function obtenerTodosLosLibros(forzarRecarga = false) {
    if (catalogoCache && !forzarRecarga) return catalogoCache;

    // Intentar caché rápido de sessionStorage
    if (!forzarRecarga) {
        const desdeSesion = cargarCacheDeSession();
        if (desdeSesion) {
            catalogoCache = desdeSesion;
            if (_coleccionActiva) {
                iniciarListenerTiempoReal(_coleccionActiva);
            }
            return catalogoCache;
        }
    }

    // Si ya hay una carga en curso, esperar la misma promesa (sin polling)
    if (_cargandoPromise) return _cargandoPromise;

    _cargandoPromise = (async () => {
        try {
            console.log("⚡ Sondeando colecciones de Firestore (secuencial no bloqueante)...");

            for (const nombreColeccion of COLECCIONES_A_PROBAR) {
                try {
                    const colRef = collection(db, nombreColeccion);
                    const snapshot = await getDocs(colRef);
                    if (!snapshot.empty) {
                        const lista = [];
                        const docs = snapshot.docs;
                        for (let i = 0; i < docs.length; i++) {
                            lista.push(mapearLibro(docs[i].id, docs[i].data()));
                            if (i > 0 && i % 200 === 0) {
                                await cederHilo();
                            }
                        }

                        const obrasConsolidadas = await agruparLibrosPorObra(lista);
                        catalogoCache = obrasConsolidadas;
                        _coleccionActiva = nombreColeccion;
                        guardarCacheEnSession(catalogoCache, nombreColeccion);
                        console.log(`✅ Colección "${nombreColeccion}": ${lista.length} registros → ${catalogoCache.length} obras únicas.`);
                        
                        iniciarListenerTiempoReal(nombreColeccion);
                        return catalogoCache;
                    }
                } catch (_e) {
                    // Continuar con la siguiente colección
                }
            }

            catalogoCache = [];
            console.warn("⚠️ No se encontraron documentos en las colecciones de Firestore.");
        } catch (error) {
            console.error("❌ Error al conectar con Firestore:", error);
            catalogoCache = [];
        } finally {
            _cargandoPromise = null;
        }
        return catalogoCache;
    })();

    return _cargandoPromise;
}

// ----------------------------------------------------------------
// 7.1. INICIALIZACIÓN DIFERIDA (NON-BLOCKING STARTUP)
// Asegura que el hilo principal pinte el DOM inicial al 100%
// antes de comenzar la lectura y procesamiento de Firestore.
// ----------------------------------------------------------------
function iniciarCargaDiferida() {
    const arrancar = () => {
        obtenerTodosLosLibros().catch(err => {
            console.warn("⚠️ Error en precarga diferida:", err);
        });
    };

    if (typeof requestIdleCallback === "function") {
        requestIdleCallback(arrancar, { timeout: 2000 });
    } else {
        setTimeout(arrancar, 0);
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        setTimeout(iniciarCargaDiferida, 0);
    });
} else {
    setTimeout(iniciarCargaDiferida, 0);
}

// ----------------------------------------------------------------
// 8. MOTOR DE BÚSQUEDA Y FILTRADO
// ----------------------------------------------------------------
let _ultimosFiltrados = null;
let _renderOffset = 0;
let _ultimoTerminoBuscado = null;
let _ultimoFiltroBuscado = null;
let _idBusquedaActual = 0; // Token secuencial para cancelar carreras asíncronas

// Limpia el grid y reinicia el estado de resultados
function limpiarResultados() {
    resultsGrid.textContent = "";
    _obrasPorId = new Map();
    _ultimosFiltrados = null;
    _renderOffset = 0;
}

// Función de filtrado pura y de alto rendimiento
function filtrarObras(todasLasObras, terminoNorm, terminoCompact, filtro) {
    if (!todasLasObras || todasLasObras.length === 0) return [];

    // 1. Detectar si la consulta de búsqueda incluye la palabra "tomo" o "tomos"
    const buscaTomo = /\btomos?\b/i.test(terminoNorm);

    // Detectar si se especificó un número o identificador de tomo (ej: "tomo 1", "tomo ii", "tomo a")
    const matchTomoEspecifico = terminoNorm.match(/\btomos?\s+([0-9ivxlcdm]+|[a-z])\b/i);
    const tomoBuscado = matchTomoEspecifico ? matchTomoEspecifico[0] : null;

    // Extraer palabras restantes que no formen parte de la expresión del tomo
    let textoSinTomo = terminoNorm;
    if (tomoBuscado) {
        textoSinTomo = textoSinTomo.replace(tomoBuscado, " ");
    } else {
        textoSinTomo = textoSinTomo.replace(/\btomos?\b/gi, " ");
    }
    const palabrasRestantes = textoSinTomo.split(/\s+/).filter(Boolean);

    return todasLasObras.filter(obra => {
        const tieneTomo = obra.tieneTomoValido !== undefined
            ? obra.tieneTomoValido
            : tienePropiedadTomoValida(obra);

        // Si la consulta incluye la palabra "tomo", EXCLUIR libros sin tomo válido
        if (buscaTomo && !tieneTomo) {
            return false;
        }

        // Búsqueda ultra-rápida con String compuesto precalculado
        const coincideEnObra = (term, termCompact = "") => {
            if (obra._nSearchString && obra._nSearchString.includes(term)) return true;
            if (termCompact.length > 1 && obra._nCotasCompactStr && obra._nCotasCompactStr.includes(termCompact)) return true;
            
            // Fallback directo por campos
            return obra._nTitulo.includes(term) ||
                obra._nAutor.includes(term) ||
                obra._nMateria.includes(term) ||
                obra._nCota.includes(term) ||
                (termCompact.length > 1 && obra._nCotaCompact.includes(termCompact)) ||
                obra._nTags.some(t => t.includes(term)) ||
                obra._nTomoTitulos.some(t => t.includes(term)) ||
                obra._nTomoEtiquetas.some(t => t.includes(term)) ||
                (obra._nTomoCotasFlat && obra._nTomoCotasFlat.some(c => c.includes(term)));
        };

        if (buscaTomo) {
            if (tomoBuscado) {
                const coincideTomoEspecifico =
                    obra._nTomoEtiquetas.some(t => t.includes(tomoBuscado) || t === tomoBuscado.replace(/^tomos?\s+/, "tomo ")) ||
                    obra._nTomoTitulos.some(t => t.includes(tomoBuscado)) ||
                    obra._nTitulo.includes(tomoBuscado);

                if (!coincideTomoEspecifico) {
                    return false;
                }
            }

            if (palabrasRestantes.length > 0) {
                return palabrasRestantes.every(p => coincideEnObra(p));
            }

            return true;
        }

        // Búsqueda por filtro específico
        if (filtro === "titulo") {
            return obra._nTitulo.includes(terminoNorm) ||
                obra._nTomoTitulos.some(t => t.includes(terminoNorm)) ||
                obra._nTomoEtiquetas.some(t => t.includes(terminoNorm));
        }
        if (filtro === "autor") {
            return obra._nAutor.includes(terminoNorm);
        }
        if (filtro === "cota") {
            return obra._nCota.includes(terminoNorm) ||
                (terminoCompact.length > 1 && obra._nCotaCompact.includes(terminoCompact)) ||
                (obra._nTomoCotasFlat && obra._nTomoCotasFlat.some(c => c.includes(terminoNorm))) ||
                (terminoCompact.length > 1 && obra._nCotasCompactStr && obra._nCotasCompactStr.includes(terminoCompact));
        }

        // Catálogo general
        return coincideEnObra(terminoNorm, terminoCompact);
    });
}

async function ejecutarBusqueda() {
    const termino = searchInput.value.trim();

    if (!termino) {
        _ultimoTerminoBuscado = "";
        _ultimoFiltroBuscado = "";
        limpiarResultados();
        mostrarEstado("empty");
        return;
    }

    const terminoNorm = normalizar(termino);
    const terminoCompact = terminoNorm.replace(/\s+/g, "");
    const filtro = selectFiltro.value;

    // Evitar cálculos redundantes si el término y el filtro no cambiaron
    if (terminoNorm === _ultimoTerminoBuscado && filtro === _ultimoFiltroBuscado && resultsGrid && !resultsGrid.classList.contains("hidden")) {
        return;
    }

    // Token único para invalidar llamadas asíncronas anteriores (evita Race Conditions)
    const idBusqueda = ++_idBusquedaActual;

    // Mostrar loader solo si la base de datos aún no ha cargado en memoria
    if (!catalogoCache) {
        mostrarEstado("loading");
    }

    try {
        const todasLasObras = await obtenerTodosLosLibros();

        // Si el usuario siguió escribiendo mientras cargaban los datos, descartar este resultado
        if (idBusqueda !== _idBusquedaActual) return;

        if (!todasLasObras || todasLasObras.length === 0) {
            limpiarResultados();
            mostrarEstado("no-results");
            return;
        }

        const filtrados = filtrarObras(todasLasObras, terminoNorm, terminoCompact, filtro);

        // Volver a comprobar que sea la búsqueda más reciente
        if (idBusqueda !== _idBusquedaActual) return;

        _ultimoTerminoBuscado = terminoNorm;
        _ultimoFiltroBuscado = filtro;

        if (filtrados.length > 0) {
            _ultimosFiltrados = filtrados;
            _renderOffset = 0;

            // Renderizar lote inicial respetando estrictamente MAX_RENDER
            renderizarResultados(filtrados.slice(0, MAX_RENDER), 0, false);
            _renderOffset = Math.min(MAX_RENDER, filtrados.length);

            // Botón de paginación progresiva si hay más resultados
            if (filtrados.length > MAX_RENDER) {
                agregarBotonMostrarMas(filtrados.length - MAX_RENDER);
            }
            mostrarEstado("grid");
        } else {
            limpiarResultados();
            mostrarEstado("no-results");
        }

    } catch (error) {
        if (idBusqueda !== _idBusquedaActual) return;
        console.error("Error en la búsqueda:", error);
        limpiarResultados();
        mostrarEstado("no-results");
    }
}

// Botón de paginación progresiva "Mostrar más resultados"
function agregarBotonMostrarMas(restantes) {
    const prevBtn = resultsGrid.querySelector(".btn-mostrar-mas");
    if (prevBtn) prevBtn.remove();

    const btn = document.createElement("button");
    btn.className = "btn-mostrar-mas";
    btn.textContent = `Mostrar más resultados (${restantes} restantes)`;
    btn.addEventListener("click", () => {
        btn.remove();
        if (!_ultimosFiltrados) return;
        const siguienteLote = _ultimosFiltrados.slice(_renderOffset, _renderOffset + MAX_RENDER);
        renderizarResultados(siguienteLote, _renderOffset, true /* append */);
        _renderOffset += siguienteLote.length;
        const nuevosRestantes = _ultimosFiltrados.length - _renderOffset;
        if (nuevosRestantes > 0) {
            agregarBotonMostrarMas(nuevosRestantes);
        }
    });
    resultsGrid.appendChild(btn);
}

// ----------------------------------------------------------------
// 9. RENDERIZADO PAGINADO DE RESULTADOS (CATÁLOGO PRINCIPAL)
// - Respeta estrictamente MAX_RENDER (50) para no saturar el DOM.
// - Usa DocumentFragment para un único reflow/repaint por lote.
// - Limita animaciones con STAGGER_CAP (20) para fluidez visual.
// ----------------------------------------------------------------
function renderizarResultados(obras, baseIndex = 0, append = false) {
    if (!append) {
        resultsGrid.textContent = "";
        _obrasPorId = new Map();
    }

    // Salvaguarda: limitar lote estricto a MAX_RENDER
    const lote = Array.isArray(obras) ? obras.slice(0, MAX_RENDER) : [];
    if (lote.length === 0) return;

    const fragment = document.createDocumentFragment();

    lote.forEach((obra, i) => {
        const esMultitomo = obra.totalTomos > 1;

        const tomosValidos = (obra.tomos || []).filter(
            t => t.etiquetaTomo &&
            t.etiquetaTomo !== "Tomo Único / Ejemplar General" &&
            t.etiquetaTomo !== "Tomo Único"
        );

        const card = document.createElement("article");
        card.className = esMultitomo ? "book-card book-card--clickable" : "book-card";

        if (i < STAGGER_CAP && !append) {
            card.style.cssText = `opacity:0;animation:fadeInUp 0.3s ease-out ${i * 0.03}s forwards`;
        }

        if (esMultitomo) {
            card.dataset.obraId = obra.id;
            card.setAttribute("tabindex", "0");
            card.setAttribute("role", "button");
            card.setAttribute("aria-label", `Ver tomos de ${escapeHTML(obra.titulo)}`);
        }

        let badgesTomosHTML = "";
        if (tomosValidos.length > 0) {
            const listaBadges = tomosValidos.map(t => {
                const cls = t.disponible ? "tomo-badge--available" : "tomo-badge--unavailable";
                return `<span class="tomo-badge ${cls}">${escapeHTML(t.etiquetaTomo)}</span>`;
            }).join("");
            badgesTomosHTML = `
                <div class="book-card__tomos-badges">
                    <span class="book-card__tomos-label">${esMultitomo ? "Tomos:" : "Tomo:"}</span>
                    <div class="book-card__badges-list">${listaBadges}</div>
                </div>`;
        }

        const statusClass = obra.disponible ? "book-card__status--available" : "book-card__status--unavailable";
        const statusText = obra.disponible ? "Disponible" : "No disponible";
        
        const cotaHTML = (obra.cota && obra.cota !== "—")
            ? `<div class="book-card__detail book-card__detail--cota"><span class="book-card__detail-label">Cota:</span><span class="book-card__detail-value book-card__cota-value">${escapeHTML(obra.cota)}</span></div>`
            : "";

        const anioHTML = (obra.anio && obra.anio !== "—")
            ? `<div class="book-card__detail"><span class="book-card__detail-label">Año:</span><span class="book-card__detail-value">${escapeHTML(obra.anio)}</span></div>`
            : "";

        card.innerHTML =
            `<h3 class="book-card__title">${escapeHTML(obra.titulo)}</h3>` +
            `<p class="book-card__author">por <span>${escapeHTML(obra.autor)}</span></p>` +
            `<div class="book-card__details">${cotaHTML}${anioHTML}${badgesTomosHTML}</div>` +
            `<hr class="book-card__divider">` +
            `<span class="book-card__status ${statusClass}"><span class="book-card__status-dot"></span>${statusText}</span>`;

        fragment.appendChild(card);

        if (esMultitomo) {
            _obrasPorId.set(obra.id, obra);
        }
    });

    resultsGrid.appendChild(fragment);
}

// ----------------------------------------------------------------
// 10. MODAL DE DETALLE: CADA TOMO APARECE EXACTAMENTE UNA VEZ
// ----------------------------------------------------------------
function abrirModalDetalleLibro(obra) {
    if (!modalBookOverlay) return;

    if (modalBookTitle) modalBookTitle.textContent = obra.titulo;
    if (modalBookAuthor) modalBookAuthor.textContent = `por ${obra.autor}`;

    if (modalBookTomosCount) {
        modalBookTomosCount.textContent = `${obra.tomos.length} ${obra.tomos.length === 1 ? 'Tomo Registrado' : 'Tomos Registrados'}`;
    }

    if (modalTomosList) {
        modalTomosList.innerHTML = "";

        obra.tomos.forEach((tomo, idx) => {
            const tomoStatusClass = tomo.disponible
                ? "tomo-card__status--available"
                : "tomo-card__status--unavailable";

            const tomoStatusText = tomo.disponible ? "Disponible" : "No disponible";

            const cantDisponibles = tomo.disponible
                ? ((tomo.ejemplares !== null && !isNaN(tomo.ejemplares)) ? tomo.ejemplares : (tomo.totalCopiasRegistradas || 1))
                : 0;

            const cotaTomo = (tomo.cotas && tomo.cotas.length > 0)
                ? tomo.cotas.join(" / ")
                : (tomo.cota && tomo.cota !== "—" ? tomo.cota : "—");

            const cotaTomoHTML = (cotaTomo && cotaTomo !== "—") ? `
                <div class="tomo-card__spec tomo-card__spec--cota">
                    <span class="tomo-card__spec-label">Cota:</span>
                    <span class="tomo-card__spec-val tomo-card__cota-val">${escapeHTML(cotaTomo)}</span>
                </div>
            ` : '';

            const itemCard = document.createElement("div");
            itemCard.className = `tomo-card ${tomo.disponible ? 'tomo-card--available' : 'tomo-card--unavailable'}`;

            itemCard.innerHTML = `
                <div class="tomo-card__header">
                    <div class="tomo-card__title-wrap">
                        <span class="tomo-card__badge-index">${idx + 1}</span>
                        <div>
                            <h4 class="tomo-card__name">${escapeHTML(tomo.etiquetaTomo || `Tomo ${idx + 1}`)}</h4>
                        </div>
                    </div>
                    <span class="tomo-card__status ${tomoStatusClass}">
                        <span class="book-card__status-dot"></span>
                        ${tomoStatusText}
                    </span>
                </div>

                <div class="tomo-card__body">
                    <div class="tomo-card__specs">
                        ${cotaTomoHTML}
                        ${tomo.anio && tomo.anio !== "—" ? `
                            <div class="tomo-card__spec">
                                <span class="tomo-card__spec-label">Año:</span>
                                <span class="tomo-card__spec-val">${escapeHTML(tomo.anio)}</span>
                            </div>
                        ` : ''}
                        <div class="tomo-card__spec">
                            <span class="tomo-card__spec-label">Disponibles:</span>
                            <span class="tomo-card__spec-val">${cantDisponibles}</span>
                        </div>
                    </div>
                </div>
            `;

            modalTomosList.appendChild(itemCard);
        });
    }

    modalBookOverlay.classList.remove("hidden");
    document.body.style.overflow = "hidden";
}

function cerrarModalDetalleLibro() {
    if (modalBookOverlay) {
        modalBookOverlay.classList.add("hidden");
        document.body.style.overflow = "";
    }
}

// ----------------------------------------------------------------
// 11. UTILIDADES Y CONTROL DE ESTADOS
// ----------------------------------------------------------------
const _escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHTML(str) {
    if (!str) return "";
    return String(str).replace(/[&<>"']/g, m => _escapeMap[m]);
}

function mostrarEstado(estado) {
    resultsEmpty.classList.add("hidden");
    resultsLoading.classList.add("hidden");
    resultsNoResults.classList.add("hidden");
    resultsGrid.classList.add("hidden");

    if (estado === "empty") resultsEmpty.classList.remove("hidden");
    if (estado === "loading") resultsLoading.classList.remove("hidden");
    if (estado === "no-results") resultsNoResults.classList.remove("hidden");
    if (estado === "grid") resultsGrid.classList.remove("hidden");
}

// Implementación robusta de Debounce con soporte para .cancel() y .isPending()
function debounce(fn, delay) {
    let timer = null;
    const debounced = function (...args) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            fn.apply(this, args);
        }, delay);
    };
    debounced.cancel = function () {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };
    debounced.isPending = function () {
        return timer !== null;
    };
    return debounced;
}

// ----------------------------------------------------------------
// 12. GESTIÓN DE EVENTOS
// ----------------------------------------------------------------
let _obrasPorId = new Map();

// Delegación de eventos en el grid
resultsGrid.addEventListener("click", (e) => {
    const card = e.target.closest(".book-card--clickable");
    if (!card) return;
    const obra = _obrasPorId.get(card.dataset.obraId);
    if (obra) abrirModalDetalleLibro(obra);
});

resultsGrid.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".book-card--clickable");
    if (!card) return;
    e.preventDefault();
    const obra = _obrasPorId.get(card.dataset.obraId);
    if (obra) abrirModalDetalleLibro(obra);
});

// ---- Búsqueda Reactiva con Debounce (350ms) y Cancelación Inmediata ----
const _busquedaConDebounce = debounce(() => ejecutarBusqueda(), DEBOUNCE_MS);

// Escucha reactiva en el input: si se borra, cancela el debounce de inmediato
searchInput.addEventListener("input", () => {
    const valor = searchInput.value.trim();
    if (!valor) {
        _busquedaConDebounce.cancel();
        _ultimoTerminoBuscado = "";
        _ultimoFiltroBuscado = "";
        limpiarResultados();
        mostrarEstado("empty");
        return;
    }
    _busquedaConDebounce();
});

// Envío del formulario (botón lupa o Enter) — ejecución inmediata cancelando debounce pendiente
searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    _busquedaConDebounce.cancel();
    ejecutarBusqueda();
});

// Enter explícito dentro del campo de búsqueda — ejecución inmediata
searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        _busquedaConDebounce.cancel();
        ejecutarBusqueda();
    }
});

// Eventos Modal Biblioteca Central
btnBibliografia.addEventListener("click", () => {
    modalOverlay.classList.remove("hidden");
    document.body.style.overflow = "hidden";
});

modalClose.addEventListener("click", () => {
    modalOverlay.classList.add("hidden");
    document.body.style.overflow = "";
});

modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) {
        modalOverlay.classList.add("hidden");
        document.body.style.overflow = "";
    }
});

// Eventos Modal Detalle de Libro
if (modalBookClose) {
    modalBookClose.addEventListener("click", cerrarModalDetalleLibro);
}

if (modalBookOverlay) {
    modalBookOverlay.addEventListener("click", (e) => {
        if (e.target === modalBookOverlay) {
            cerrarModalDetalleLibro();
        }
    });
}

// Tecla ESC para cerrar modales
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        if (modalBookOverlay && !modalBookOverlay.classList.contains("hidden")) {
            cerrarModalDetalleLibro();
        } else if (modalOverlay && !modalOverlay.classList.contains("hidden")) {
            modalOverlay.classList.add("hidden");
            document.body.style.overflow = "";
        }
    }
});

// ----------------------------------------------------------------
// 13. MODO OSCURO / CLARO
// ----------------------------------------------------------------
function aplicarTema(tema) {
    if (tema === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
        if (themeIconMoon) themeIconMoon.classList.add("hidden");
        if (themeIconSun) themeIconSun.classList.remove("hidden");
        localStorage.setItem("usm-theme", "dark");
    } else {
        document.documentElement.removeAttribute("data-theme");
        if (themeIconMoon) themeIconMoon.classList.remove("hidden");
        if (themeIconSun) themeIconSun.classList.add("hidden");
        localStorage.setItem("usm-theme", "light");
    }
}

const temaGuardado = localStorage.getItem("usm-theme");
if (temaGuardado === "dark") {
    aplicarTema("dark");
} else {
    aplicarTema("light");
}

if (btnThemeToggle) {
    btnThemeToggle.addEventListener("click", () => {
        const esOscuro = document.documentElement.getAttribute("data-theme") === "dark";
        aplicarTema(esOscuro ? "light" : "dark");
    });
}

// Inicialización de la UI
mostrarEstado("empty");
console.log("✅ Portal Biblioteca Central USM — Optimización de alto rendimiento activa.");
