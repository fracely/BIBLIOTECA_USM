// ================================================================
// APP.JS — Lógica Universal e Inteligente (Alta Compatibilidad)
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
const btnBibliografia = document.getElementById("btn-bibliografia");
const modalOverlay = document.getElementById("modal-overlay");
const modalClose = document.getElementById("modal-close");
const btnThemeToggle = document.getElementById("btn-theme-toggle");
const themeIconMoon = document.querySelector(".theme-icon--moon");
const themeIconSun = document.querySelector(".theme-icon--sun");

// ----------------------------------------------------------------
// 2. PLACEHOLDERS DINÁMICOS
// ----------------------------------------------------------------
const placeholderMap = {
    general: "Buscar en el catálogo general...",
    titulo: "Buscar en el catálogo por título...",
    autor: "Buscar en el catálogo por autor..."
};

selectFiltro.addEventListener("change", () => {
    const filtro = selectFiltro.value;
    searchInput.placeholder = placeholderMap[filtro] || placeholderMap.general;
    searchInput.focus();
});

// ----------------------------------------------------------------
// 3. NORMALIZADOR UNIVERSAL DE TEXTO
// Elimina tildes, mayúsculas y caracteres especiales para matching
// ----------------------------------------------------------------
function normalizar(texto) {
    if (texto === null || texto === undefined) return "";
    return String(texto)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}

// ----------------------------------------------------------------
// 4. EXTRACTOR INTELIGENTE DE CAMPOS (ADAPTADOR UNIVERSAL)
// Lee cualquier estructura de datos existente en producción
// ----------------------------------------------------------------
function mapearLibro(docId, raw) {
    // 1. Título
    const titulo = raw.titulo || raw.title || raw.nombre || raw.nombre_libro || raw.name || "Sin título";

    // 2. Autor(es)
    let autor = "Autor no especificado";
    if (raw.autor) autor = raw.autor;
    else if (raw.author) autor = raw.author;
    else if (raw.autores) autor = Array.isArray(raw.autores) ? raw.autores.join(", ") : raw.autores;
    else if (raw.escritor) autor = raw.escritor;

    // 3. Cota / Código de ubicación
    const cota = raw.cota || raw.codigo || raw.cod || raw.ubicacion || raw.estante || raw.clasificacion || "—";

    // 4. Materia / Carrera / Área
    const materia = raw.materia || raw.categoria || raw.category || raw.area || raw.carrera || raw.facultad || "General";

    // 5. Año y Editorial
    const anio = raw.anio || raw.año || raw.year || raw.fecha || raw.fecha_publicacion || "—";
    const editorial = raw.editorial || raw.publisher || raw.edicion || "";

    // 6. Ejemplares
    let ejemplares = undefined;
    if (raw.ejemplares !== undefined) ejemplares = Number(raw.ejemplares);
    else if (raw.cantidad !== undefined) ejemplares = Number(raw.cantidad);
    else if (raw.stock !== undefined) ejemplares = Number(raw.stock);
    else if (raw.copias !== undefined) ejemplares = Number(raw.copias);

    // 7. DISPONIBILIDAD INTELIGENTE (detecta Boolean, Number, String o campos alternos)
    let estaDisponible = false;

    // A. Si existe campo booleano
    if (raw.disponible === true || raw.disponibilidad === true || raw.isAvailable === true || raw.activo === true) {
        estaDisponible = true;
    } 
    // B. Si es booleano false explícito
    else if (raw.disponible === false || raw.disponibilidad === false || raw.isAvailable === false || raw.activo === false) {
        estaDisponible = false;
    }
    // C. Si es número (ejemplares/stock)
    else if (ejemplares !== undefined && !isNaN(ejemplares)) {
        estaDisponible = ejemplares > 0;
    }
    // D. Si es texto (ej: "disponible", "en sala", "prestado", "no disponible", "si", "no")
    else {
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
            // Si el libro está registrado en el inventario y no dice lo contrario, se asume disponible
            estaDisponible = true;
        }
    }

    // 8. Palabras clave para búsqueda libre
    let palabrasClave = [];
    if (Array.isArray(raw.palabrasClave)) palabrasClave = raw.palabrasClave;
    else if (Array.isArray(raw.tags)) palabrasClave = raw.tags;
    else if (Array.isArray(raw.keywords)) palabrasClave = raw.keywords;

    return {
        id: docId,
        titulo: String(titulo),
        autor: String(autor),
        cota: String(cota),
        materia: String(materia),
        anio: String(anio),
        editorial: String(editorial),
        ejemplares: ejemplares !== undefined && !isNaN(ejemplares) ? ejemplares : null,
        disponible: estaDisponible,
        palabrasClave: palabrasClave
    };
}

// ----------------------------------------------------------------
// 5. CACHÉ EN MEMORIA Y CONSULTA ULTRA RÁPIDA A FIRESTORE
// ----------------------------------------------------------------
let catalogoCache = null;
let estaCargandoCatalogo = false;
const COLECCIONES_A_PROBAR = ["libros", "catalogo", "books", "biblioteca", "inventario"];

/**
 * Consulta Firestore en paralelo y guarda en memoria para búsquedas instantáneas
 */
async function obtenerTodosLosLibros(forzarRecarga = false) {
    if (catalogoCache && !forzarRecarga) {
        return catalogoCache;
    }

    if (estaCargandoCatalogo) {
        // Si ya hay una petición en curso, esperar un instante
        await new Promise(r => setTimeout(r, 200));
        if (catalogoCache) return catalogoCache;
    }

    estaCargandoCatalogo = true;

    try {
        console.log("⚡ Consultando Firestore en tiempo real...");

        // Probar las colecciones en paralelo simultáneo (no secuencial)
        const promesas = COLECCIONES_A_PROBAR.map(async (nombreColeccion) => {
            try {
                const colRef = collection(db, nombreColeccion);
                const snapshot = await getDocs(colRef);
                if (!snapshot.empty) {
                    const lista = [];
                    snapshot.forEach(doc => {
                        lista.push(mapearLibro(doc.id, doc.data()));
                    });
                    return { coleccion: nombreColeccion, libros: lista };
                }
            } catch (e) {
                // Posible error de permisos o colección inexistente
                return null;
            }
            return null;
        });

        const resultados = await Promise.all(promesas);
        const exitoso = resultados.find(r => r && r.libros && r.libros.length > 0);

        if (exitoso) {
            catalogoCache = exitoso.libros;
            console.log(`✅ ¡Conectado a colección "${exitoso.coleccion}"! ${catalogoCache.length} libros listos.`);
        } else {
            catalogoCache = [];
            console.warn("⚠️ No se encontraron documentos en las colecciones de Firestore.");
        }
    } catch (error) {
        console.error("❌ Error al conectar con Firestore:", error);
        catalogoCache = [];
    } finally {
        estaCargandoCatalogo = false;
    }

    return catalogoCache;
}

// Precargar el catálogo en segundo plano al abrir la página para velocidad instantánea
obtenerTodosLosLibros();

// ----------------------------------------------------------------
// 6. MOTOR DE BÚSQUEDA Y FILTRADO INSTANTÁNEO
// ----------------------------------------------------------------
async function ejecutarBusqueda() {
    const termino = searchInput.value.trim();

    if (!termino) {
        mostrarEstado("empty");
        return;
    }

    const terminoNorm = normalizar(termino);
    const filtro = selectFiltro.value;

    mostrarEstado("loading");

    try {
        const todosLosLibros = await obtenerTodosLosLibros();

        if (todosLosLibros.length === 0) {
            mostrarEstado("no-results");
            return;
        }

        const filtrados = todosLosLibros.filter(libro => {
            const tituloNorm = normalizar(libro.titulo);
            const autorNorm = normalizar(libro.autor);
            const materiaNorm = normalizar(libro.materia);
            const cotaNorm = normalizar(libro.cota);

            if (filtro === "titulo") {
                return tituloNorm.includes(terminoNorm);
            } else if (filtro === "autor") {
                return autorNorm.includes(terminoNorm);
            } else {
                // Catálogo general (búsqueda global en título, autor, o palabras clave)
                const enTitulo = tituloNorm.includes(terminoNorm);
                const enAutor = autorNorm.includes(terminoNorm);
                const enMateria = materiaNorm.includes(terminoNorm);
                const enCota = cotaNorm.includes(terminoNorm);
                const enTags = libro.palabrasClave.some(tag => normalizar(tag).includes(terminoNorm));
                return enTitulo || enAutor || enMateria || enCota || enTags;
            }
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
// 7. RENDERIZADO DE RESULTADOS
// ----------------------------------------------------------------
function renderizarResultados(libros) {
    resultsGrid.innerHTML = "";

    libros.forEach((libro, index) => {
        const statusClass = libro.disponible
            ? "book-card__status--available"
            : "book-card__status--unavailable";

        const statusText = libro.disponible ? "Disponible" : "No disponible";

        const card = document.createElement("article");
        card.className = "book-card";
        card.style.opacity = "0";
        card.style.animation = `fadeInUp 0.4s ease-out ${index * 0.05}s forwards`;

        card.innerHTML = `
            <h3 class="book-card__title">${escapeHTML(libro.titulo)}</h3>
            <p class="book-card__author">por <span>${escapeHTML(libro.autor)}</span></p>
            <div class="book-card__details">
                <div class="book-card__detail">
                    <span class="book-card__detail-label">Año:</span>
                    <span class="book-card__detail-value">${escapeHTML(libro.anio)}</span>
                </div>
                ${libro.editorial ? `
                <div class="book-card__detail">
                    <span class="book-card__detail-label">Editorial:</span>
                    <span class="book-card__detail-value">${escapeHTML(libro.editorial)}</span>
                </div>` : ""}
                ${libro.ejemplares !== null ? `
                <div class="book-card__detail">
                    <span class="book-card__detail-label">Ejemplares:</span>
                    <span class="book-card__detail-value">${libro.ejemplares}</span>
                </div>` : ""}
            </div>
            <hr class="book-card__divider">
            <span class="book-card__status ${statusClass}">
                <span class="book-card__status-dot"></span>
                ${statusText}
            </span>
        `;

        resultsGrid.appendChild(card);
    });
}

function escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
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

// ----------------------------------------------------------------
// 8. EVENTOS
// ----------------------------------------------------------------
searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    ejecutarBusqueda();
});

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

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modalOverlay.classList.contains("hidden")) {
        modalOverlay.classList.add("hidden");
        document.body.style.overflow = "";
    }
});

// ----------------------------------------------------------------
// 9. CONTROL DE MODO OSCURO / CLARO
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

// Cargar tema guardado en localStorage
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
console.log("✅ Portal Biblioteca Central USM — Modo Universal Activo.");
