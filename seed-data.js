// ================================================================
// SEED-DATA.JS — Script para poblar Firestore con libros de prueba
// Portal Biblioteca Central USM
// ================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDgDx7_6SEgR-s0J3ZcN6jnytQmS07oeEw",
    authDomain: "sistema-biblioteca-usm.firebaseapp.com",
    projectId: "sistema-biblioteca-usm",
    storageBucket: "sistema-biblioteca-usm.firebasestorage.app",
    messagingSenderId: "1017689286626",
    appId: "1:1017689286626:web:953b6d449475178f19fbbb",
    measurementId: "G-87T0JCTW7X"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ----------------------------------------------------------------
// DATOS DE PRUEBA: Libros individuales y obras multivolumen
// ----------------------------------------------------------------
const librosDePrueba = [
    // --- Obra Multivolumen: Caracas en el Centenario del Libertador ---
    {
        titulo: "CARACAS EN EL CENTENARIO DEL LIBERTADOR: TOMO I",
        autor: "Comité Ejecutivo del Centenario",
        cota: "F2341 .C28 1983 T.1",
        materia: "Historia de Venezuela / Acervo Histórico",
        sede: "Biblioteca Central",
        anio: 1983,
        editorial: "Ediciones de la Presidencia de la República",
        disponible: true,
        ejemplares: 2,
        palabrasClave: ["caracas", "centenario", "libertador", "bolivar", "historia", "venezuela"]
    },
    {
        titulo: "CARACAS EN EL CENTENARIO DEL LIBERTADOR: TOMO II",
        autor: "Comité Ejecutivo del Centenario",
        cota: "F2341 .C28 1983 T.2",
        materia: "Historia de Venezuela / Acervo Histórico",
        sede: "Biblioteca Central",
        anio: 1983,
        editorial: "Ediciones de la Presidencia de la República",
        disponible: true,
        ejemplares: 2,
        palabrasClave: ["caracas", "centenario", "libertador", "bolivar", "historia", "venezuela"]
    },
    {
        titulo: "CARACAS EN EL CENTENARIO DEL LIBERTADOR: TOMO III",
        autor: "Comité Ejecutivo del Centenario",
        cota: "F2341 .C28 1983 T.3",
        materia: "Historia de Venezuela / Acervo Histórico",
        sede: "Biblioteca Central",
        anio: 1983,
        editorial: "Ediciones de la Presidencia de la República",
        disponible: false,
        ejemplares: 0,
        palabrasClave: ["caracas", "centenario", "libertador", "bolivar", "historia", "venezuela"]
    },

    // --- Libros individuales regulares ---
    {
        titulo: "Cálculo con Geometría Analítica",
        autor: "Dennis G. Zill",
        cota: "QA303 .Z55 2015",
        materia: "Matemáticas / Ingeniería",
        sede: "Biblioteca Central",
        anio: 2015,
        editorial: "McGraw-Hill",
        disponible: true,
        ejemplares: 4,
        palabrasClave: ["calculo", "geometria", "analitica", "zill", "matematicas", "derivadas", "integrales"]
    },
    {
        titulo: "Introducción al Derecho",
        autor: "Agustín Squella Narducci",
        cota: "K230 .S68 2014",
        materia: "Derecho / Ciencias Jurídicas",
        sede: "Biblioteca Central",
        anio: 2014,
        editorial: "Editorial Jurídica de Chile",
        disponible: true,
        ejemplares: 2,
        palabrasClave: ["derecho", "introduccion", "squella", "juridico", "leyes", "normas"]
    },
    {
        titulo: "Farmacología Básica y Clínica",
        autor: "Bertram G. Katzung",
        cota: "RM300 .K38 2019",
        materia: "Farmacia / Ciencias de la Salud",
        sede: "Biblioteca Central",
        anio: 2019,
        editorial: "McGraw-Hill / Lange",
        disponible: false,
        ejemplares: 0,
        palabrasClave: ["farmacologia", "katzung", "farmacia", "medicamentos", "clinica", "salud"]
    },
    {
        titulo: "Fundamentos de Programación con Java",
        autor: "Herbert Schildt",
        cota: "QA76.73 .J38 2021",
        materia: "Ingeniería de Sistemas / Informática",
        sede: "Biblioteca Central",
        anio: 2021,
        editorial: "Oracle Press",
        disponible: true,
        ejemplares: 3,
        palabrasClave: ["java", "programacion", "schildt", "informatica", "sistemas", "codigo", "software"]
    },
    {
        titulo: "Principios de Economía",
        autor: "N. Gregory Mankiw",
        cota: "HB171 .M36 2020",
        materia: "Ciencias Económicas y Sociales",
        sede: "Biblioteca Central",
        anio: 2020,
        editorial: "Cengage Learning",
        disponible: true,
        ejemplares: 5,
        palabrasClave: ["economia", "mankiw", "microeconomia", "macroeconomia", "mercados", "oferta", "demanda"]
    }
];

// ----------------------------------------------------------------
// FUNCIÓN DE CARGA: Inserta cada libro en la colección "libros"
// ----------------------------------------------------------------
async function cargarDatosDePrueba() {
    console.log("📚 Iniciando carga de datos de prueba...\n");

    const librosRef = collection(db, "libros");

    for (const libro of librosDePrueba) {
        try {
            const docRef = await addDoc(librosRef, libro);
            console.log(`✅ Libro añadido: "${libro.titulo}" (ID: ${docRef.id})`);
        } catch (error) {
            console.error(`❌ Error al añadir "${libro.titulo}":`, error);
        }
    }

    console.log("\n🎉 ¡Carga de datos de prueba completada!");
    console.log("Ahora puedes buscar estos libros en el portal.");
}

// Ejecutar la carga automáticamente
cargarDatosDePrueba();
