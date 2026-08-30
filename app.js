// ================================================================
// APP.JS — Lógica Universal, Agrupación de Tomos y Modal de Detalle
// Portal Biblioteca Central USM
// ================================================================

import { db } from "./firebase-config.js";
import {
    collection,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
    });
}

// ----------------------------------------------------------------
// 3. NORMALIZADOR UNIVERSAL DE TEXTO (con caché en memoria)
// Elimina tildes, mayúsculas, espacios extra y signos.
// La caché evita recomputar el mismo string durante cada búsqueda.
// ----------------------------------------------------------------
const _normCache = new Map();
function normalizar(texto) {
    if (texto === null || texto === undefined) return "";
    const key = String(texto);
    if (_normCache.has(key)) return _normCache.get(key);
    const result = key
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\w\s]/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
    // Limitar tamaño del caché para no crecer indefinidamente
    if (_normCache.size > 2000) _normCache.clear();
    _normCache.set(key, result);
    return result;
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
    // Ej: "F2341 .C28 1983 T.1", "F2341 .C28 1983 T.2", "F2341 .C28 1983 T.3"
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

// Normaliza el texto de la etiqueta (ej. "tomo 1" -> "Tomo 1", "T.1" -> "Tomo 1", "TOMO II" -> "Tomo II")
function formatearEtiquetaTomo(str) {
    if (!str) return "";
    let clean = str.trim().replace(/^[\:\-\–\—\/\,\.\|\s]+/, '').replace(/[\:\-\–\—\/\,\.\|\s]+$/, '');
    
    // Si viene como "T.1", "T. 1" o "T-1", normalizar a "Tomo 1"
    clean = clean.replace(/^T\.?\s*([0-9IVXLCDMivxlcdm]+)$/i, 'Tomo $1');
    clean = clean.replace(/^V\.?\s*([0-9IVXLCDMivxlcdm]+)$/i, 'Vol. $1');

    return clean.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase())
                .replace(/\b(I|Ii|Iii|Iv|V|Vi|Vii|Viii|Ix|X|Xi|Xii)\b/gi, (m) => m.toUpperCase());
}

// ----------------------------------------------------------------
// 5. EXTRACTOR INTELIGENTE DE CAMPOS (ADAPTADOR UNIVERSAL)
// ----------------------------------------------------------------
function mapearLibro(docId, raw) {
    const rawTitulo = raw.titulo || raw.title || raw.nombre || raw.nombre_libro || raw.name || "Sin título";
    const parseado = parsearTituloYTomo(rawTitulo);

    // Tomo explícito o derivado del título
    let tomo = raw.tomo || raw.volumen || raw.vol || raw.parte || raw.ejemplar || parseado.etiquetaTomo || "";
    if (tomo) tomo = formatearEtiquetaTomo(String(tomo));
    const tituloBase = parseado.tituloBase || rawTitulo;

    // Autor(es)
    let autor = "Autor no especificado";
    if (raw.autor) autor = raw.autor;
    else if (raw.author) autor = raw.author;
    else if (raw.autores) autor = Array.isArray(raw.autores) ? raw.autores.join(", ") : raw.autores;
    else if (raw.escritor) autor = raw.escritor;

    // Cota / Código de ubicación
    const cota = raw.cota || raw.codigo || raw.cod || raw.ubicacion || raw.estante || raw.clasificacion || "—";

    // Materia / Carrera / Área
    const materia = raw.materia || raw.categoria || raw.category || raw.area || raw.carrera || raw.facultad || "General";

    // Año y Editorial
    const anio = raw.anio || raw.año || raw.year || raw.fecha || raw.fecha_publicacion || "—";
    const editorial = raw.editorial || raw.publisher || raw.edicion || "";

    // Ejemplares
    let ejemplares = undefined;
    if (raw.ejemplares !== undefined) ejemplares = Number(raw.ejemplares);
    else if (raw.cantidad !== undefined) ejemplares = Number(raw.cantidad);
    else if (raw.stock !== undefined) ejemplares = Number(raw.stock);
    else if (raw.copias !== undefined) ejemplares = Number(raw.copias);

    // Disponibilidad
    let estaDisponible = false;
    if (raw.disponible === true || raw.disponibilidad === true || raw.isAvailable === true || raw.activo === true) {
        estaDisponible = true;
    } else if (raw.disponible === false || raw.disponibilidad === false || raw.isAvailable === false || raw.activo === false) {
        estaDisponible = false;
    } else if (ejemplares !== undefined && !isNaN(ejemplares)) {
        estaDisponible = ejemplares > 0;
    } else {
        const estadoTexto = normalizar(raw.disponible || raw.disponibilidad || raw.estado || raw.status || raw.condicion || "");
        if (
            estadoTexto.includes("disp") ||
            estadoTexto.includes("sala") ||
            estadoTexto.includes("activo") ||
            estadoTexto.includes("si") ||
            estadoTexto.includes("yes") ||
            estadoTexto === "1" ||
            estadoTexto === "true"
        ) {
            estaDisponible = true;
        } else if (
            estadoTexto.includes("prest") ||
            estadoTexto.includes("no") ||
            estadoTexto.includes("agot") ||
            estadoTexto.includes("inactiv") ||
            estadoTexto === "0" ||
            estadoTexto === "false"
        ) {
            estaDisponible = false;
        } else {
            estaDisponible = true;
        }
    }

    // Palabras clave
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
// - Catálogo General: Cada obra/libro aparece UNA SOLA VEZ.
// - Modal de Detalle: Cada tomo distinto ("Tomo I", "Tomo II") aparece UNA SOLA VEZ.
// ----------------------------------------------------------------
function agruparLibrosPorObra(librosMapeados) {
    const mapaObras = new Map();

    librosMapeados.forEach(item => {
        const claveTitulo = normalizar(item.tituloBase);
        const claveAutor = normalizar(item.autor);

        // Clave unificada por título de la obra
        let clave = claveTitulo;
        if (claveAutor && claveAutor !== "autor no especificado" && claveAutor !== "") {
            clave = `${claveTitulo}___${claveAutor}`;
        }

        // Buscar si ya existe la obra
        let claveExistente = null;
        if (mapaObras.has(clave)) {
            claveExistente = clave;
        } else {
            for (const k of mapaObras.keys()) {
                if (k === claveTitulo || k.startsWith(`${claveTitulo}___`) || (clave.startsWith(`${claveTitulo}___`) && k === claveTitulo)) {
                    claveExistente = k;
                    break;
                }
            }
        }

        if (!claveExistente) {
            claveExistente = clave;
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
                _pcSet: new Set(item.palabrasClave), // Set para deduplicación O(1)
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

        // Consolidar palabras clave (usando Set para deduplicar en O(1))
        item.palabrasClave.forEach(palabra => {
            if (!obra._pcSet.has(palabra)) {
                obra._pcSet.add(palabra);
                obra.palabrasClave.push(palabra);
            }
        });

        // Etiqueta del tomo
        let etiquetaTomo = item.tomo;
        if (!etiquetaTomo) {
            etiquetaTomo = item.tituloOriginal !== item.tituloBase ? item.tituloOriginal : "";
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
    });

    // Consolidar tomos únicos dentro de cada obra
    const obrasAgrupadas = Array.from(mapaObras.values()).map(obra => {
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

        // Pre-computar campos normalizados para búsqueda rápida
        // (evita re-normalizar en cada keystroke del usuario)
        return {
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
            tomos: tomosUnicos,
            // Campos pre-normalizados (computados una sola vez al cargar)
            _nTitulo: normalizar(obra.titulo),
            _nAutor: normalizar(obra.autor),
            _nMateria: normalizar(obra.materia),
            _nCota: cotaNorm,
            _nCotaCompact: cotaCompact,
            _nTags: obra.palabrasClave.map(normalizar),
            _nTomoTitulos: tomosUnicos.map(t => normalizar(t.tituloCompleto)),
            _nTomoEtiquetas: tomosUnicos.map(t => normalizar(t.etiquetaTomo)),
            _nTomoCotas: tomosUnicos.map(t =>
                [normalizar(t.cota), ...(t.cotas || []).map(normalizar)].filter(Boolean)
            ),
            _nTomoCotasCompact: tomosUnicos.map(t =>
                [normalizar(t.cota).replace(/\s+/g, ""), ...(t.cotas || []).map(c => normalizar(c).replace(/\s+/g, ""))].filter(Boolean)
            )
        };
    });

    return obrasAgrupadas;
}

// ----------------------------------------------------------------
// 7. CACHÉ EN MEMORIA Y CONSULTA A FIRESTORE
// ----------------------------------------------------------------
// 7. CACHÉ EN MEMORIA Y CONSULTA A FIRESTORE
// - Sondeo secuencial de colecciones: evita disparar N lecturas
//   en paralelo cuando sólo una tendrá datos.
// - Mutex con Promise real: elimina el busy-wait con setTimeout.
// ----------------------------------------------------------------
let catalogoCache = null;
let _cargandoPromise = null; // Mutex real basado en Promise
const COLECCIONES_A_PROBAR = ["libros", "catalogo", "books", "biblioteca", "inventario"];

async function obtenerTodosLosLibros(forzarRecarga = false) {
    if (catalogoCache && !forzarRecarga) return catalogoCache;

    // Si ya hay una carga en curso, esperar a que termine (sin polling)
    if (_cargandoPromise) return _cargandoPromise;

    _cargandoPromise = (async () => {
        try {
            console.log("⚡ Sondeando colecciones de Firestore (secuencial)...");

            // Sondeo secuencial: se detiene al encontrar la primera colección con datos.
            // Evita N lecturas de Firestore cuando solo 1 colección existe.
            for (const nombreColeccion of COLECCIONES_A_PROBAR) {
                try {
                    const colRef = collection(db, nombreColeccion);
                    const snapshot = await getDocs(colRef);
                    if (!snapshot.empty) {
                        const lista = [];
                        snapshot.forEach(doc => lista.push(mapearLibro(doc.id, doc.data())));
                        const obrasConsolidadas = agruparLibrosPorObra(lista);
                        catalogoCache = obrasConsolidadas;
                        console.log(`✅ Colección "${nombreColeccion}": ${lista.length} registros → ${catalogoCache.length} obras únicas.`);
                        return catalogoCache;
                    }
                } catch (_e) {
                    // Colección no existe o sin permisos; continuar con la siguiente
                }
            }

            catalogoCache = [];
            console.warn("⚠️ No se encontraron documentos en las colecciones de Firestore.");
        } catch (error) {
            console.error("❌ Error al conectar con Firestore:", error);
            catalogoCache = [];
        } finally {
            _cargandoPromise = null; // Liberar mutex
        }
        return catalogoCache;
    })();

    return _cargandoPromise;
}

// Precargar catálogo en segundo plano
obtenerTodosLosLibros();

// ----------------------------------------------------------------
// 8. MOTOR DE BÚSQUEDA Y FILTRADO
// ----------------------------------------------------------------

// Limpia el grid y reinicia el estado visual antes de cada búsqueda.
// Garantiza que nunca queden resultados anteriores visibles.
function limpiarResultados() {
    resultsGrid.textContent = "";
    _obrasPorId = new Map();
    mostrarEstado("loading");
}

async function ejecutarBusqueda() {
    const termino = searchInput.value.trim();

    if (!termino) {
        mostrarEstado("empty");
        return;
    }

    const terminoNorm = normalizar(termino);
    const terminoCompact = terminoNorm.replace(/\s+/g, "");
    const filtro = selectFiltro.value;

    // Limpiar resultados anteriores ANTES de la consulta async
    limpiarResultados();

    try {
        const todasLasObras = await obtenerTodosLosLibros();

        if (todasLasObras.length === 0) {
            mostrarEstado("no-results");
            return;
        }

        // Usar campos pre-normalizados (_nTitulo, _nAutor, _nCota, etc.) calculados al cargar.
        // Esto evita re-normalizar cada campo en cada pulsación de tecla del usuario.
        const filtrados = todasLasObras.filter(obra => {
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
                    obra._nTomoCotas.some(cotas => cotas.some(c => c.includes(terminoNorm))) ||
                    (terminoCompact.length > 1 && obra._nTomoCotasCompact.some(cotas => cotas.some(c => c.includes(terminoCompact))));
            }
            // Catálogo general (incluye búsqueda por Título, Autor, Materia, Cota, Tags y Tomos)
            return obra._nTitulo.includes(terminoNorm) ||
                obra._nAutor.includes(terminoNorm) ||
                obra._nMateria.includes(terminoNorm) ||
                obra._nCota.includes(terminoNorm) ||
                (terminoCompact.length > 1 && obra._nCotaCompact.includes(terminoCompact)) ||
                obra._nTags.some(t => t.includes(terminoNorm)) ||
                obra._nTomoTitulos.some(t => t.includes(terminoNorm)) ||
                obra._nTomoEtiquetas.some(t => t.includes(terminoNorm)) ||
                obra._nTomoCotas.some(cotas => cotas.some(c => c.includes(terminoNorm))) ||
                (terminoCompact.length > 1 && obra._nTomoCotasCompact.some(cotas => cotas.some(c => c.includes(terminoCompact))));
        });

        if (filtrados.length > 0) {
            renderizarResultados(filtrados);
            mostrarEstado("grid");
        } else {
            mostrarEstado("no-results");
        }

    } catch (error) {
        console.error("Error en la búsqueda:", error);
        mostrarEstado("no-results");
    }
}

// ----------------------------------------------------------------
// 9. RENDERIZADO DE RESULTADOS (CATÁLOGO PRINCIPAL)
// Usa DocumentFragment para insertar todas las tarjetas en una
// sola operación DOM, eliminando N reflows consecutivos.
// Los eventos de clic se delegan al contenedor padre (ver sección 12).
// ----------------------------------------------------------------
function renderizarResultados(obras) {
    // Limpiar contenido anterior sin destruir el nodo raíz
    resultsGrid.textContent = "";

    // Construir todas las tarjetas fuera del DOM vivo
    const fragment = document.createDocumentFragment();

    obras.forEach((obra, index) => {
        const esMultitomo = obra.totalTomos > 1;

        // Filtrar tomos con etiqueta específica
        const tomosValidos = obra.tomos.filter(
            t => t.etiquetaTomo &&
            t.etiquetaTomo !== "Tomo Único / Ejemplar General" &&
            t.etiquetaTomo !== "Tomo Único"
        );

        const card = document.createElement("article");
        card.className = esMultitomo ? "book-card book-card--clickable" : "book-card";
        card.style.cssText = `opacity:0;animation:fadeInUp 0.4s ease-out ${index * 0.05}s forwards`;

        // Marcar tarjetas multi-tomo con data-attribute para delegación de eventos
        if (esMultitomo) {
            card.dataset.obraId = obra.id;
            card.setAttribute("tabindex", "0");
            card.setAttribute("role", "button");
            card.setAttribute("aria-label", `Ver tomos de ${escapeHTML(obra.titulo)}`);
        }

        // Construir HTML de badges de tomos
        let badgesTomosHTML = "";
        if (tomosValidos.length > 0) {
            const listaBadges = tomosValidos.map(t => {
                const cls = t.disponible ? "tomo-badge--available" : "tomo-badge--unavailable";
                return `<span class="tomo-badge ${cls}">${escapeHTML(t.etiquetaTomo)}</span>`;
            }).join("");
            badgesTomosHTML = `
                <div class="book-card__tomos-badges">
                    <span class="book-card__tomos-label">${esMultitomo ? "Tomos disponibles:" : "Tomo disponible:"}</span>
                    <div class="book-card__badges-list">${listaBadges}</div>
                </div>`;
        }

        const statusClass = obra.disponible ? "book-card__status--available" : "book-card__status--unavailable";
        const statusText = obra.disponible ? "Disponible" : "No disponible";
        
        // Detalle de Cota visible en la tarjeta principal
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
    });

    // ✨ Una sola operación de escritura al DOM (un único reflow/repaint)
    resultsGrid.appendChild(fragment);

    // Guardar mapa obra-id → objeto para la delegación de eventos
    _obrasPorId = new Map(obras.filter(o => o.totalTomos > 1).map(o => [o.id, o]));
}

// ----------------------------------------------------------------
// 10. MODAL DE DETALLE: CADA TOMO APARECE EXACTAMENTE UNA VEZ
// Muestra la Cota individual correspondiente a cada tomo o ejemplar desglosado.
// ----------------------------------------------------------------
function abrirModalDetalleLibro(obra) {
    if (!modalBookOverlay) return;

    // 1. Cabecera
    if (modalBookTitle) modalBookTitle.textContent = obra.titulo;
    if (modalBookAuthor) modalBookAuthor.textContent = `por ${obra.autor}`;

    // 2. Conteo de Tomos Únicos
    if (modalBookTomosCount) {
        modalBookTomosCount.textContent = `${obra.tomos.length} ${obra.tomos.length === 1 ? 'Tomo Registrado' : 'Tomos Registrados'}`;
    }

    // 3. Lista de Tomos ÚNICOS (Limpia y directa con Cota individual)
    if (modalTomosList) {
        modalTomosList.innerHTML = "";

        obra.tomos.forEach((tomo, idx) => {
            const tomoStatusClass = tomo.disponible
                ? "tomo-card__status--available"
                : "tomo-card__status--unavailable";

            const tomoStatusText = tomo.disponible ? "Disponible" : "No disponible";

            const cantDisponibles = (tomo.ejemplares !== null && !isNaN(tomo.ejemplares)) 
                ? tomo.ejemplares 
                : (tomo.totalCopiasRegistradas || 1);

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

    // Mostrar modal
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
// Tabla de reemplazo estática: evita crear un elemento DOM en cada llamada.
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

// Función debounce: retrasa la ejecución hasta que el usuario
// deje de escribir por 'delay' milisegundos.
function debounce(fn, delay) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

// ----------------------------------------------------------------
// 12. GESTIÓN DE EVENTOS
// ----------------------------------------------------------------
// Mapa obra id → objeto obra (poblado en renderizarResultados)
let _obrasPorId = new Map();

// Delegación de eventos en el grid: un único listener gestiona
// clics y teclado de TODAS las tarjetas sin listeners individuales.
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

// Envío del formulario (botón lupa o Enter dentro del input vía submit)
searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    ejecutarBusqueda();
});

// Enter explícito dentro del campo de búsqueda
// (refuerzo por si el formulario no captura el evento en todos los contextos)
searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
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

// Inicialización
mostrarEstado("empty");
console.log("✅ Portal Biblioteca Central USM — Desduplicación total de tomos activa.");
